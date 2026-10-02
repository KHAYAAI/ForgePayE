-- A recovery sweep sends a stray token to an address an operator named. That address lives in the row, so
-- anyone able to write to the database could redirect it between planning and sending. The row now carries an
-- HMAC over its id, deposit, asset, source and destination, keyed from the gateway's own wallet key (which the
-- database does not hold); the sweeper refuses to send a recovery whose seal does not verify.
ALTER TABLE deposit_sweeps ADD COLUMN IF NOT EXISTS dest_seal TEXT;
