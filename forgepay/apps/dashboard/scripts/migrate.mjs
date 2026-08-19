#!/usr/bin/env node
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Pool } = pkg;

const __dirname = new URL('.', import.meta.url).pathname;
const schemaPath = join(__dirname, '../src/lib/schema.sql');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  const client = await pool.connect();
  try {
    const schema = readFileSync(schemaPath, 'utf-8');
    await client.query(schema);
    console.log('✓ Database schema migrated successfully');
  } catch (err) {
    console.error('✗ Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
