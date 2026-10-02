import { ForbiddenException } from '@nestjs/common';
import { CustodyService } from './custody.service';

// Minting or revoking an API key is a custody action: only an active signer may do it.
describe('API key issuance requires an eligible signer', () => {
  function service(eligible: boolean) {
    const svc: any = Object.create(CustodyService.prototype);
    svc.eligibleSigner = jest.fn(async () => { if (!eligible) throw new ForbiddenException('not an active signer'); });
    svc.customers = { getByCustomerId: jest.fn(async () => ({})) };
    svc.pool = { query: jest.fn(async () => ({ rows: [{ id: 'k1', name: 'app', key_prefix: 'ofb_x', created_at: new Date() }] })) };
    svc.audit = { logEvent: jest.fn(async () => undefined) };
    return svc as any;
  }

  it('a non-signer cannot issue or revoke, and nothing is written', async () => {
    const s = service(false);
    await expect(s.issueApiKey('c1', 'mallory@example.com', 'app')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(s.revokeApiKey('c1', 'mallory@example.com', 'k1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(s.pool.query).not.toHaveBeenCalled();
  });

  it('an active signer can', async () => {
    const s = service(true);
    const out = await s.issueApiKey('c1', 'alice@example.com', 'app');
    expect(out.api_key).toBeTruthy();
    expect(s.eligibleSigner).toHaveBeenCalledWith('c1', 'alice@example.com');
  });
});
