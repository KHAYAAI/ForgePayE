import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ethers } from 'ethers';
import { EthereumService } from './ethereum.service';
import { NonceService } from './nonce.service';
import { SignRequestDto } from '../sign/dto/sign-request.dto';

export interface PlannedFields {
  chainId: number;
  gasLimit: number;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  /** Worst-case wei per gas the transfer can pay (what balance must cover). */
  maxFeeWei: bigint;
}

const GWEI = 1_000_000_000n;
// Used only when the RPC can't tell us current fees.
const FALLBACK_MAX_FEE = 30n * GWEI;
const FALLBACK_PRIORITY_FEE = 3n * GWEI / 2n;

export function formatEthExact(wei: bigint): string {
  return ethers.formatEther(wei).replace(/\.0$/, '');
}

/**
 * Fills in what a caller may leave out (chain id, gas limit, EIP-1559 fees),
 * estimating from the RPC, and checks the address can pay for the transfer.
 * Anything the caller passes explicitly is used as given.
 */
@Injectable()
export class TransferPlanner {
  private readonly logger = new Logger(TransferPlanner.name);

  constructor(
    private readonly ethereum: EthereumService,
    private readonly nonces: NonceService,
  ) {}

  private async fees(req: SignRequestDto, allowFallback: boolean): Promise<Pick<PlannedFields, 'gasPrice' | 'maxFeePerGas' | 'maxPriorityFeePerGas' | 'maxFeeWei'>> {
    if (req.maxFeePerGas) {
      const maxFee = BigInt(req.maxFeePerGas);
      const prio = req.maxPriorityFeePerGas ? BigInt(req.maxPriorityFeePerGas) : maxFee < FALLBACK_PRIORITY_FEE ? maxFee : FALLBACK_PRIORITY_FEE;
      return { maxFeePerGas: maxFee.toString(), maxPriorityFeePerGas: prio.toString(), maxFeeWei: maxFee };
    }
    if (req.gasPrice) return { gasPrice: req.gasPrice, maxFeeWei: BigInt(req.gasPrice) };

    let maxFee = FALLBACK_MAX_FEE;
    let prio = req.maxPriorityFeePerGas ? BigInt(req.maxPriorityFeePerGas) : FALLBACK_PRIORITY_FEE;
    try {
      const fd = await this.ethereum.getFeeData();
      if (fd.maxFeePerGas != null && fd.maxPriorityFeePerGas != null) {
        maxFee = fd.maxFeePerGas;
        if (!req.maxPriorityFeePerGas) prio = fd.maxPriorityFeePerGas;
      } else if (fd.gasPrice != null) {
        // A chain without EIP-1559: legacy pricing.
        return { gasPrice: fd.gasPrice.toString(), maxFeeWei: fd.gasPrice };
      } else if (!allowFallback) {
        throw new Error('the network returned no fee data');
      }
    } catch (err) {
      if (!allowFallback) throw err;
      this.logger.warn(`fee estimation failed, using fallback fees: ${(err as Error).message}`);
    }
    if (prio > maxFee) maxFee = prio;
    return { maxFeePerGas: maxFee.toString(), maxPriorityFeePerGas: prio.toString(), maxFeeWei: maxFee };
  }

  /**
   * Resolve chain id, gas limit and fees for a transfer from `from`, and check
   * the balance covers value + worst-case fees. `stage` = 'request' (before
   * queuing or signing: the RPC must answer) or 'signing' (the quorum already
   * decided, so an RPC outage falls back to safe defaults instead of failing).
   */
  async plan(from: string, req: SignRequestDto, stage: 'request' | 'signing'): Promise<PlannedFields> {
    const lenient = stage === 'signing';
    let chainId = req.chainId;
    let net: { chainId: number; name: string } | null = null;
    try {
      net = await this.ethereum.getNetworkInfo();
    } catch (err) {
      if (!lenient || chainId == null) {
        throw new ServiceUnavailableException(
          `The network RPC is unreachable (${(err as Error).message}), so the balance and fees can't be checked. Nothing was signed.`,
        );
      }
      this.logger.warn(`RPC unreachable while signing; continuing offline with chain id ${chainId}`);
    }
    if (net) {
      if (chainId != null && chainId !== net.chainId) {
        throw new BadRequestException(`chainId ${chainId} does not match the configured network (${net.name}, chain id ${net.chainId})`);
      }
      chainId = net.chainId;
    }

    const fee = await this.fees(req, lenient);
    const value = BigInt(req.value ?? '0');
    const hasData = !!req.data && req.data !== '0x';

    // Funds available: balance minus what in-flight (signed, unmined) transfers already claim.
    let balance: bigint | null = null;
    let committed = 0n;
    if (net) {
      try {
        const [bal, latest] = await Promise.all([this.ethereum.getBalance(from), this.ethereum.getNonce(from, 'latest')]);
        balance = bal;
        committed = await this.nonces.committedWei(from, chainId!, latest);
      } catch (err) {
        if (!lenient) throw new ServiceUnavailableException(`Could not read the balance from the network RPC (${(err as Error).message}). Nothing was signed.`);
      }
    }
    const assertFunds = (gas: bigint) => {
      if (balance === null) return;
      const need = value + gas * fee.maxFeeWei;
      if (balance - committed < need) {
        const held = committed > 0n ? ` (${formatEthExact(committed)} ETH of it is reserved by transfers still in flight)` : '';
        throw new BadRequestException(
          `balance is ${formatEthExact(balance)} ETH${held}; this transfer needs ${formatEthExact(need)} ETH including fees`,
        );
      }
    };

    let gas: bigint;
    if (req.gasLimit != null) {
      gas = BigInt(req.gasLimit);
    } else {
      // Refuse an obviously unaffordable transfer with the clear message before
      // asking the node to estimate (which would fail with a raw RPC error).
      assertFunds(21000n);
      try {
        const est = await this.ethereum.estimateGas({ from, to: req.to, data: req.data, value: req.value });
        // A plain ETH transfer costs exactly 21000; only pad estimates for contract calls.
        gas = hasData ? (est * 120n) / 100n : est;
      } catch (err) {
        if (hasData || /revert/i.test((err as Error).message)) {
          // A call (or a payment to a contract) the node says would revert would only burn fees on-chain.
          throw new BadRequestException(`gas estimation failed (the transaction would probably revert): ${(err as Error).message}`);
        }
        this.logger.warn(`gas estimation failed for a plain transfer, using 21000: ${(err as Error).message}`);
        gas = 21000n;
      }
    }
    assertFunds(gas);

    return { chainId: chainId!, gasLimit: Number(gas), ...fee };
  }

  /** Node's pending nonce for `from`, or null when the RPC can't answer. */
  async rpcPendingNonce(from: string): Promise<number | null> {
    try {
      return await this.ethereum.getNonce(from, 'pending');
    } catch {
      return null;
    }
  }
}
