-- LOCAL DEVELOPMENT ONLY. The API key below is public. Never load this into a shared or production database.
-- ---------------------------------------------------------------------------
-- Seed a demo tenant for local development. Remove in production.
-- API keys are stored as SHA-256 hashes; the plaintext key for this row is
-- "dev-demo-key" (sha256 below). Authenticate with: Authorization: Bearer dev-demo-key
-- ---------------------------------------------------------------------------
INSERT INTO customers (customer_id, email, api_key, status, tier)
VALUES (
  'demo',
  'demo@openfireblocks.local',
  '6cbae51c7775b973f845b3fb4b333495890ecc9c57a9c3b3d662a3200d3227e1',
  'active',
  'pro'
)
ON CONFLICT (customer_id) DO NOTHING;
