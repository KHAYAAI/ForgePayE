import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { TransferPlanner } from './transfer-planner.service';
import { SignRequestDto } from '../sign/dto/sign-request.dto';

const ETH = 10n ** 18n;
const GWEI = 10n ** 9n;

describe('TransferPlanner', () => {
  const FROM = '0x1111111111111111111111111111111111111111';
  const TO = '0x2222222222222222222222222222222222222222';
  let eth: any;
  let nonces: { committedWei: jest.Mock };
  const build = () => new TransferPlanner(eth, nonces as any);
  const req = (over: Partial<SignRequestDto> = {}) => ({ to: TO, value: (25n * ETH).toString(), ...over }) as SignRequestDto;

  beforeEach(() => {
    eth = {
      getNetworkInfo: jest.fn().mockResolvedValue({ chainId: 1337, name: 'Local dev chain (ganache)' }),
      getFeeData: jest.fn().mockResolvedValue({ maxFeePerGas: 10n * GWEI, maxPriorityFeePerGas: 1n * GWEI, gasPrice: 5n * GWEI }),
      getBalance: jest.fn().mockResolvedValue(100n * ETH),
      getNonce: jest.fn().mockResolvedValue(0),
      estimateGas: jest.fn().mockResolvedValue(21000n),
    };
    nonces = { committedWei: jest.fn().mockResolvedValue(0n) };
  });

  it('fills chain id, gas and EIP-1559 fees from the node when the caller gave none', async () => {
    const p = await build().plan(FROM, req(), 'request');
    expect(p).toMatchObject({ chainId: 1337, gasLimit: 21000, maxFeePerGas: (10n * GWEI).toString(), maxPriorityFeePerGas: GWEI.toString() });
    expect(p.gasPrice).toBeUndefined();
  });

  it('uses explicit values exactly as given', async () => {
    const p = await build().plan(FROM, req({ chainId: 1337, gasLimit: 30000, gasPrice: '7000000000' }), 'request');
    expect(p).toMatchObject({ chainId: 1337, gasLimit: 30000, gasPrice: '7000000000' });
    expect(eth.getFeeData).not.toHaveBeenCalled();
    expect(eth.estimateGas).not.toHaveBeenCalled();
  });

  it('rejects a chain id that does not match the network', async () => {
    await expect(build().plan(FROM, req({ chainId: 1 }), 'request')).rejects.toThrow(/does not match the configured network/);
  });

  it('refuses up front with the exact balance message when value + fees exceed the balance', async () => {
    eth.getBalance.mockResolvedValue(1n * ETH);
    eth.estimateGas.mockResolvedValue(21000n);
    await expect(build().plan(FROM, req(), 'request')).rejects.toMatchObject({
      message: 'balance is 1 ETH; this transfer needs 25.00021 ETH including fees',
    });
  });

  it('refuses when the balance covers the value but not the fees', async () => {
    eth.getBalance.mockResolvedValue(25n * ETH);
    const err: any = await build().plan(FROM, req(), 'request').catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/^balance is 25 ETH; this transfer needs 25\.0002\d+ ETH including fees$/);
  });

  it('accepts a transfer that fits exactly', async () => {
    eth.getBalance.mockResolvedValue(25n * ETH + 21000n * 10n * GWEI);
    await expect(build().plan(FROM, req(), 'request')).resolves.toBeDefined();
  });

  it('subtracts funds already claimed by in-flight transfers and says so', async () => {
    eth.getBalance.mockResolvedValue(30n * ETH);
    nonces.committedWei.mockResolvedValue(10n * ETH);
    await expect(build().plan(FROM, req(), 'request')).rejects.toThrow(
      /balance is 30 ETH \(10 ETH of it is reserved by transfers still in flight\); this transfer needs 25\.\d+ ETH including fees/,
    );
  });

  it('with the RPC down: refuses at request time, but at signing time carries on with a fallback', async () => {
    eth.getNetworkInfo.mockRejectedValue(new Error('network RPC unreachable (ECONNREFUSED)'));
    await expect(build().plan(FROM, req(), 'request')).rejects.toBeInstanceOf(ServiceUnavailableException);
    eth.getFeeData.mockRejectedValue(new Error('ECONNREFUSED'));
    eth.estimateGas.mockRejectedValue(new Error('ECONNREFUSED'));
    const p = await build().plan(FROM, req({ chainId: 1337 }), 'signing');
    expect(p.chainId).toBe(1337);
    expect(p.maxFeePerGas).toBe((30n * GWEI).toString()); // sane fallback
    expect(p.gasLimit).toBe(21000);
  });

  it('falls back to legacy gasPrice on a chain without EIP-1559', async () => {
    eth.getFeeData.mockResolvedValue({ maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: 5n * GWEI });
    const p = await build().plan(FROM, req(), 'request');
    expect(p.gasPrice).toBe((5n * GWEI).toString());
    expect(p.maxFeePerGas).toBeUndefined();
  });

  it('pads gas estimates for contract calls by 20% but not for plain transfers', async () => {
    eth.estimateGas.mockResolvedValue(50000n);
    expect((await build().plan(FROM, req({ data: '0xdeadbeef' }), 'request')).gasLimit).toBe(60000);
    expect((await build().plan(FROM, req(), 'request')).gasLimit).toBe(50000);
  });

  it('uses 21000 when estimating a plain transfer fails, but refuses a contract call it cannot estimate', async () => {
    eth.estimateGas.mockRejectedValue(new Error('boom'));
    expect((await build().plan(FROM, req(), 'request')).gasLimit).toBe(21000);
    await expect(build().plan(FROM, req({ data: '0xdeadbeef' }), 'request')).rejects.toThrow(/gas estimation failed/);
    eth.estimateGas.mockRejectedValue(new Error('VM Exception while processing transaction: revert'));
    await expect(build().plan(FROM, req(), 'request')).rejects.toThrow(/would probably revert/);
  });
});
