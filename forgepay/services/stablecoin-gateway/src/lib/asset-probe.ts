/**
 * What to look at the first time the gateway reaches a real token.
 *
 * Symbol and decimals prove a contract is the right shape; they do not prove it behaves like a plain
 * ERC-20. The things that actually cost money are balances that move without a transfer (rebasing),
 * fees taken on transfer, a token that is paused or can freeze an address, and a proxy whose
 * implementation can change under you. None of these can be proven safe from outside, but most can be
 * detected, so this reads them from the chain and reports:
 *
 *   block   the gateway will not use the asset (rebasing, currently paused) unless an operator
 *           overrides it by name
 *   review  a person should read it before launch (upgradeable, can freeze, fee-like functions)
 *   info    worth knowing
 *
 * The probes call view functions and read storage; they never send a transaction. Whether a contract
 * answers is a hint, not proof: a rebasing token with unusual function names would pass, which is why
 * settlement also checks the deposit address's real balance before it credits (see settlement.ts).
 */
import { ethers } from 'ethers';

export interface ProbeChain {
  call(to: string, data: string): Promise<string | null>; // null when the call reverts / is absent
  storageAt(address: string, slot: string): Promise<string>;
}

export type Level = 'block' | 'review' | 'info';
export interface Finding { level: Level; code: string; message: string }
export interface ProbeResult { findings: Finding[]; implementation?: string; admin?: string }

const ZERO = '0x' + '00'.repeat(20);
const SLOT_IMPL = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const SLOT_ADMIN = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
const sel = (sig: string) => ethers.id(sig).slice(0, 10);
const pad = (addr: string) => ethers.zeroPadValue(addr, 32).slice(2);
const word = (hex: string | null) => (hex && hex.length >= 66 ? hex : null);
const asAddress = (w: string) => ethers.getAddress('0x' + w.slice(-40));

const REBASING = [
  ['sharesOf(address)', true], ['totalShares()', false], ['getSharesByPooledEth(uint256)', false],
  ['rebasingCreditsPerToken()', false], ['rebasingCreditsPerTokenHighres()', false],
  ['creditsBalanceOf(address)', true], ['scaledBalanceOf(address)', true], ['gonsPerFragment()', false],
] as const;
const FEE_LIKE = ['transferFeeBasisPoints()', 'basisPointsRate()', '_taxFee()', 'taxFee()', 'sellFee()', 'buyFee()', 'transferFee()'];
const FREEZE = ['isBlacklisted(address)', 'blacklisted(address)', 'isBlocklisted(address)', 'isFrozen(address)'];

export async function probeToken(chain: ProbeChain, token: string, probeAddress = '0x000000000000000000000000000000000000dEaD'): Promise<ProbeResult> {
  const f: Finding[] = [];

  // Proxy?
  let implementation: string | undefined, admin: string | undefined;
  const implW = await chain.storageAt(token, SLOT_IMPL).catch(() => '0x');
  if (implW && implW.length >= 66 && BigInt(implW) !== 0n) {
    implementation = asAddress(implW);
    const adminW = await chain.storageAt(token, SLOT_ADMIN).catch(() => '0x');
    if (adminW && adminW.length >= 66 && BigInt(adminW) !== 0n) admin = asAddress(adminW);
    f.push({ level: 'review', code: 'upgradeable', message: `an upgradeable proxy (implementation ${implementation}${admin ? `, admin ${admin}` : ''}); its issuer can change what it does. The gateway re-checks the implementation and alerts if it changes` });
  }

  // Paused right now?
  const paused = word(await chain.call(token, sel('paused()')));
  if (paused !== null) {
    if (BigInt(paused) !== 0n) f.push({ level: 'block', code: 'paused', message: 'the token reports paused() = true: transfers are halted' });
    else f.push({ level: 'info', code: 'pausable', message: 'can be paused by its issuer (not paused now)' });
  }

  // Rebasing signals
  const rebasing: string[] = [];
  for (const [sig, takesAddr] of REBASING) {
    const r = await chain.call(token, sel(sig) + (takesAddr ? pad(probeAddress) : sig.includes('uint256') ? '00'.repeat(32) : ''));
    if (word(r) !== null) rebasing.push(sig);
  }
  if (rebasing.length) f.push({ level: 'block', code: 'rebasing', message: `looks like a rebasing / share-based token (answers ${rebasing.join(', ')}): holders' balances change without transfers, so what a deposit address holds can differ from what was paid` });

  // Fee-on-transfer signals
  const fees: string[] = [];
  for (const sig of FEE_LIKE) if (word(await chain.call(token, sel(sig))) !== null) fees.push(sig);
  if (fees.length) f.push({ level: 'review', code: 'fee-like', message: `exposes fee-like settings (${fees.join(', ')}); a transfer may deliver less than was sent` });

  // Can freeze an address?
  const freezes: string[] = [];
  for (const sig of FREEZE) if (word(await chain.call(token, sel(sig) + pad(probeAddress))) !== null) freezes.push(sig);
  if (freezes.length) f.push({ level: 'review', code: 'freezable', message: `the issuer can freeze addresses (${freezes.join(', ')}); a frozen deposit or treasury address cannot move its funds` });

  // Who controls it?
  const owner = word(await chain.call(token, sel('owner()')));
  if (owner !== null && asAddress(owner) !== ZERO) f.push({ level: 'info', code: 'owner', message: `has an owner: ${asAddress(owner)}` });

  return { findings: f, implementation, admin };
}

export class RpcProbeChain implements ProbeChain {
  constructor(private provider: ethers.JsonRpcProvider) {}
  async call(to: string, data: string) {
    try { const r = await this.provider.call({ to, data }); return r === '0x' ? null : r; } catch { return null; }
  }
  storageAt(address: string, slot: string) { return this.provider.getStorage(address, slot); }
}
