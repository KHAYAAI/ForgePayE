-- Kill Bill requires its own database schema.
-- The official schema is managed by the Kill Bill DDL scripts:
-- https://github.com/killbill/killbill/tree/master/util/src/main/resources/org/killbill/billing/util/ddl
--
-- This file creates the Kill Bill database and user.
-- Run BEFORE starting the billing-engine container.

-- Create dedicated Kill Bill database (separate from main forgepay DB)
CREATE DATABASE killbill;
CREATE DATABASE kaui;

-- Create Kill Bill user with full access to its own DB
CREATE USER killbill WITH PASSWORD '${KILLBILL_DB_PASSWORD}';
GRANT ALL PRIVILEGES ON DATABASE killbill TO killbill;
GRANT ALL PRIVILEGES ON DATABASE kaui TO killbill;

-- Note: Kill Bill runs its own DDL migrations on first startup.
-- ForgePay-specific Kill Bill schema customizations go in:
--   forgepay/services/billing-engine/config/db_migrations/
