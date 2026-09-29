import { Pool } from 'pg';

/**
 * How many approvals a new proposal needs: the workspace's threshold, capped
 * at the number of signers whose cooling-off has passed. 0 means nobody can
 * approve anything yet, which callers must treat as "deny", never "allow".
 */
export async function requiredApprovals(pool: Pool, customerId: string): Promise<number> {
  const { rows } = await pool.query<{ threshold: number | null; eligible: string }>(
    `SELECT (SELECT threshold FROM custody.settings WHERE customer_id = $1) AS threshold,
            (SELECT COUNT(*) FROM custody.signers
              WHERE customer_id = $1 AND status = 'active' AND active_from <= NOW()) AS eligible`,
    [customerId],
  );
  const eligible = Number(rows[0].eligible);
  return Math.min(rows[0].threshold ?? 2, eligible);
}
