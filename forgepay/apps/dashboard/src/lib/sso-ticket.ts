import { randomUUID } from 'node:crypto';
import { queryOne, execute } from './db';

/**
 * Single-use hand-off between the WorkOS SSO callback and NextAuth.
 *
 * The SSO callback proves who the merchant is, but only NextAuth's
 * credentials provider can mint a session this app recognises. A ticket
 * carries that proof across the gap: the callback issues one and redirects,
 * the login page spends it via signIn(), and authorize() redeems it in place
 * of a password.
 *
 * It is a bearer credential for those few seconds, so it is deliberately
 * narrow: 120 seconds to live, and redemption is a conditional UPDATE that
 * can only succeed once. A ticket that leaks via referrer header, browser
 * history, or a shared URL is already spent or expired by the time anyone
 * else could use it.
 */

const TICKET_TTL_MS = 120 * 1000;

export async function issueSsoTicket(merchantId: string): Promise<string> {
  const id = randomUUID();
  await execute(
    `INSERT INTO sso_tickets (id, merchant_id, expires_at) VALUES ($1, $2, $3)`,
    [id, merchantId, new Date(Date.now() + TICKET_TTL_MS)],
  );
  return id;
}

/**
 * Redeem a ticket, returning the merchant id it stands for, or null if it is
 * unknown, expired, or already spent.
 *
 * The guard lives in the UPDATE's WHERE clause rather than in a read-then-write
 * pair so that two simultaneous redemptions cannot both observe an unspent
 * ticket and both succeed — the database decides the winner, and the loser
 * gets null.
 */
export async function redeemSsoTicket(ticketId: string): Promise<string | null> {
  const row = await queryOne<{ merchant_id: string }>(
    `UPDATE sso_tickets
        SET consumed_at = NOW()
      WHERE id = $1
        AND consumed_at IS NULL
        AND expires_at > NOW()
      RETURNING merchant_id`,
    [ticketId],
  );
  return row?.merchant_id ?? null;
}

/** Housekeeping for spent/expired rows. Safe to call from a cron or on a timer. */
export async function purgeExpiredSsoTickets(): Promise<number> {
  return execute(
    `DELETE FROM sso_tickets WHERE expires_at < NOW() - INTERVAL '1 day'`,
  );
}
