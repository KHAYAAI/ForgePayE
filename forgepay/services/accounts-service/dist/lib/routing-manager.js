const VALID_CHAINS = new Set(['polygon', 'base', 'ethereum', 'arbitrum']);
// Estimated fees and finality times per route
const ROUTE_FEES = {
    'direct-blockchain:polygon': { feeUsd: 0.01, timeSeconds: 15 },
    'direct-blockchain:base': { feeUsd: 0.02, timeSeconds: 5 },
    'direct-blockchain:ethereum': { feeUsd: 5.00, timeSeconds: 180 },
    'direct-blockchain:arbitrum': { feeUsd: 0.05, timeSeconds: 10 },
    'circle:polygon': { feeUsd: 0.50, timeSeconds: 60 },
    'circle:ethereum': { feeUsd: 2.00, timeSeconds: 600 },
    'circle:base': { feeUsd: 0.30, timeSeconds: 30 },
    'circle:arbitrum': { feeUsd: 0.40, timeSeconds: 45 },
};
export class RoutingManager {
    selectRoute(req) {
        // Fast urgency: always direct on Base (fastest finality, low cost)
        if (req.urgency === 'fast') {
            const chain = VALID_CHAINS.has(req.preferredChain ?? '') ? req.preferredChain : 'base';
            return this.buildDecision('direct-blockchain', chain, 'USDC', 'fast_urgency_override');
        }
        // Preferred chain override if specified and valid
        if (req.preferredChain && VALID_CHAINS.has(req.preferredChain)) {
            const supplier = req.amountUsd > 10_000 ? 'circle' : 'direct-blockchain';
            return this.buildDecision(supplier, req.preferredChain, 'USDC', 'preferred_chain_override');
        }
        // Large amounts: Circle on Ethereum for liquidity
        if (req.amountUsd > 10_000) {
            return this.buildDecision('circle', 'ethereum', 'USDC', 'large_amount_liquidity');
        }
        // Medium amounts: Circle on Polygon for reliability
        if (req.amountUsd > 100) {
            return this.buildDecision('circle', 'polygon', 'USDC', 'medium_amount_circle');
        }
        // Small amounts: direct on Polygon for minimum cost
        return this.buildDecision('direct-blockchain', 'polygon', 'USDC', 'small_amount_low_cost');
    }
    buildDecision(supplier, chain, token, reason) {
        const key = `${supplier}:${chain}`;
        const stats = ROUTE_FEES[key] ?? { feeUsd: 1.00, timeSeconds: 120 };
        return {
            supplier,
            chain,
            token,
            estimatedFeeUsd: stats.feeUsd,
            estimatedTimeSeconds: stats.timeSeconds,
            reason,
        };
    }
}
//# sourceMappingURL=routing-manager.js.map