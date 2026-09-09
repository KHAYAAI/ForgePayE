/**
 * Guard for code paths that fabricate a result instead of doing the real work.
 *
 * The yield engine had two of these, and both wrote their fabricated result
 * into a transaction record marked `status: 'confirmed'` and persisted it to
 * Postgres. A simulated sweep was then indistinguishable from a real one except
 * by the `0xsimulated_` prefix on the hash:
 *
 *   - `executeOnChainDeposit` returned `0xsimulated_<ts>` whenever
 *     `SIGNER_PRIVATE_KEY` was absent — an unset variable silently turned real
 *     execution off.
 *   - the withdrawal path fabricated `0xwd_<ts>` *unconditionally*, even with a
 *     signer configured. `AaveAdapter.withdraw` and `CompoundAdapter.withdraw`
 *     are implemented but have no callers.
 *
 * Simulation is legitimate in development. What is not legitimate is a
 * production deployment quietly recording money movements that never happened,
 * so these paths now fail closed: loud in development, fatal in production.
 */
export declare class SimulationRefusedError extends Error {
    constructor(operation: string, reason: string);
}
/**
 * Call immediately before returning a fabricated result.
 *
 * @throws SimulationRefusedError when NODE_ENV === 'production'.
 */
export declare function refuseSimulationInProduction(operation: string, reason: string): void;
//# sourceMappingURL=simulation-guard.d.ts.map