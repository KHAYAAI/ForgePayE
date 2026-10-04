import { describe, it, expect } from 'vitest';
import { demoSeedAllowed } from './store';

// A fresh production database used to be seeded with demo agents and ACTIVE demo furnishers whose keys are published
// in .env.example: anyone could have submitted credit history as "FORGE Internal" and fabricated an agent's record.
describe('demo data is never seeded in production', () => {
  it('only outside production', () => {
    expect(demoSeedAllowed({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
    expect(demoSeedAllowed({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(true);
    expect(demoSeedAllowed({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toBe(true);
  });
});
