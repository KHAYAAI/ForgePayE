"use strict";
/**
 * Adapter factory.
 *
 * Returns a concrete adapter instance for the given protocol + chain
 * combination.  Throws if the combination is unsupported.
 *
 * Usage:
 *   const adapter = getAdapter('aave_v3', 'ethereum', provider);
 *   const apy     = await adapter.getCurrentApy();
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OndoAdapter = exports.CompoundAdapter = exports.AaveAdapter = void 0;
exports.getAdapter = getAdapter;
const ethers_1 = require("ethers");
const aave_1 = require("./aave");
const compound_1 = require("./compound");
const ondo_1 = require("./ondo");
const config_1 = require("../config");
// ── Provider cache (one provider per chain) ───────────────────────────────────
const providerCache = new Map();
function getProvider(chain) {
    let p = providerCache.get(chain);
    if (!p) {
        const url = config_1.config.rpc[chain];
        p = new ethers_1.ethers.JsonRpcProvider(url);
        providerCache.set(chain, p);
    }
    return p;
}
// ── Factory ───────────────────────────────────────────────────────────────────
/**
 * Instantiate an adapter for the given protocol.
 *
 * @param protocol  Which yield protocol to use
 * @param chain     Target chain (required for on-chain adapters)
 * @param provider  Optional externally-managed provider (overrides the default)
 */
function getAdapter(protocol, chain, provider) {
    const p = provider ?? getProvider(chain);
    switch (protocol) {
        case 'aave_v3': {
            if (!aave_1.AaveAdapter.isSupported(chain)) {
                throw new Error(`Aave V3 is not supported on chain: ${chain}`);
            }
            return new aave_1.AaveAdapter(p, chain);
        }
        case 'compound_v3': {
            if (!compound_1.CompoundAdapter.isSupported(chain)) {
                throw new Error(`Compound V3 is not supported on chain: ${chain}`);
            }
            return new compound_1.CompoundAdapter(p, chain);
        }
        case 'ondo_usdy': {
            // Ondo uses an off-chain API; the provider is used only for balance
            // fallback queries.
            return new ondo_1.OndoAdapter(p, chain);
        }
        case 'superstate_ustb':
            // Superstate USTB integration is planned; stub for future implementation.
            throw new Error('Superstate USTB adapter is not yet implemented');
        case 'manual':
            throw new Error('Manual protocol does not have an on-chain adapter');
        default: {
            // Exhaustive check
            const _exhaustive = protocol;
            throw new Error(`Unknown protocol: ${String(_exhaustive)}`);
        }
    }
}
var aave_2 = require("./aave");
Object.defineProperty(exports, "AaveAdapter", { enumerable: true, get: function () { return aave_2.AaveAdapter; } });
var compound_2 = require("./compound");
Object.defineProperty(exports, "CompoundAdapter", { enumerable: true, get: function () { return compound_2.CompoundAdapter; } });
var ondo_2 = require("./ondo");
Object.defineProperty(exports, "OndoAdapter", { enumerable: true, get: function () { return ondo_2.OndoAdapter; } });
//# sourceMappingURL=index.js.map