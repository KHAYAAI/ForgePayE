/**
 * Onfido webhook verification and check results.
 *
 * Onfido signs each webhook with HMAC-SHA256 of the raw body, keyed with the
 * webhook's token, hex in the X-SHA2-Signature header. The webhook says a
 * check has *completed*; it does not say whether the person passed. That is
 * the check's `result` — `clear` or `consider` — read from the API. The old
 * handler approved on status `complete`, so a failed check approved the
 * applicant (and it was never routed, so nothing completed at all).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyOnfidoSignature(rawBody: Buffer, signatureHex: string | undefined, token: string | undefined): boolean {
  if (!token || !signatureHex) return false;
  const expected = createHmac('sha256', token).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signatureHex, 'hex');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type CheckDecision = 'approved' | 'requires_review';

/**
 * Only `clear` approves. `consider` and anything unexpected go to a person;
 * nothing here rejects outright, since `consider` means "look", not "fail".
 */
export function decisionForCheckResult(result: string | null | undefined): CheckDecision {
  return result === 'clear' ? 'approved' : 'requires_review';
}

export async function fetchCheckResult(
  checkId: string,
  apiKey: string,
  baseUrl = 'https://api.eu.onfido.com/v3.6',
  doFetch: typeof fetch = fetch,
): Promise<{ status: string; result: string | null }> {
  const res = await doFetch(`${baseUrl}/checks/${encodeURIComponent(checkId)}`, {
    headers: { Authorization: `Token token=${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Onfido GET check ${checkId}: HTTP ${res.status}`);
  const body = (await res.json()) as { status?: string; result?: string | null };
  return { status: body.status ?? '', result: body.result ?? null };
}
