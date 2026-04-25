/**
 * Reconnection utilities for chain monitors.
 *
 * Provides exponential backoff retry for ethers.js provider startup and event
 * listener loops. When a provider connection fails or an RPC request errors,
 * we retry with exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s (cap).
 */

/**
 * Calls `fn` and retries with exponential backoff on failure.
 *
 * @param fn           Async operation to attempt.
 * @param label        Human-readable label used in log output.
 * @param maxAttempts  Maximum number of attempts before throwing. 0 = infinite.
 * @param baseDelayMs  Starting delay in milliseconds (doubles each attempt, capped at 30 s).
 */
export async function withExponentialBackoff<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 10,
  baseDelayMs = 1000,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (maxAttempts > 0 && attempt >= maxAttempts) {
        console.error(`[chain-sync] ${label}: failed after ${attempt} attempts`, err);
        throw err;
      }
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), 30_000);
      console.warn(
        `[chain-sync] ${label}: attempt ${attempt} failed, retrying in ${delay}ms:`,
        err,
      );
      await new Promise<void>((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Wraps a chain monitor with automatic reconnection.
 *
 * Calls `startFn` and, if it ever throws (provider error, WebSocket drop, etc.),
 * waits 5 seconds and restarts it. Never returns under normal operation — it
 * runs until the process exits.
 *
 * @param label     Human-readable monitor label for log output.
 * @param startFn   Async function that sets up and runs the monitor. Should
 *                  throw (or reject) when the connection is lost so this wrapper
 *                  can restart it.
 * @param intervalMs  Unused by the outer loop itself; callers may use this to
 *                    configure polling intervals inside `startFn`.
 */
export async function withAutoReconnect(
  label: string,
  startFn: () => Promise<void>,
  intervalMs = 120_000,
): Promise<void> {
  while (true) {
    try {
      console.log(`[chain-sync] ${label}: starting monitor`);
      // Pass to withExponentialBackoff with maxAttempts=0 for infinite retries
      // on initial provider setup, but if startFn itself manages its loop we
      // just call it directly and catch crashes at the outer level.
      await startFn();
    } catch (err) {
      console.error(`[chain-sync] ${label}: monitor crashed, restarting in 5s:`, err);
      await new Promise<void>((r) => setTimeout(r, 5_000));
    }
  }
}
