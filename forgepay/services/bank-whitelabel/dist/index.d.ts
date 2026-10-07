/**
 * ARCH: ForgePay Bank White-Label Module
 * ──────────────────────────────────────────────────────────────────────────────
 * Role: Multi-tenant bank admin console for ForgePay.
 *
 * Banks (e.g. Investec, Discovery) get an isolated namespace:
 *   - Their own admin logins (JWT, separate from merchant auth)
 *   - Their own customer registry with daily spending limits
 *   - Full transaction history scoped to their bankId
 *   - Daily settlement reports (JSON + CSV)
 *   - Webhook forwarding in forgepay / ISO 20022 / custom format
 *   - KYC status change webhooks
 *   - Admin action audit log
 *
 * Port: 3015
 *
 * Auth: POST /v1/auth/login → JWT { adminId, bankId, role }
 * Passwords hashed with scrypt (N=16384) — replaces insecure SHA-256.
 */
export {};
//# sourceMappingURL=index.d.ts.map