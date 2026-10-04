import { describe, expect, it } from 'vitest';
import { bureauScopeQuery, canSeeBureauAgent, isBureauOperator, withQuery } from './bureau-scope';

const env = { FORGE_OPERATOR_TENANT_ID: 'forge_ops' } as unknown as NodeJS.ProcessEnv;

describe('bureau scope', () => {
  it('scopes a customer workspace to its own agents', () => {
    expect(bureauScopeQuery('ws_a', env)).toBe('managedBy=ws_a');
    expect(withQuery('/v1/agents?limit=50', bureauScopeQuery('ws_a', env))).toBe('/v1/agents?limit=50&managedBy=ws_a');
  });

  it('gives the operator workspace the whole register', () => {
    expect(bureauScopeQuery('forge_ops', env)).toBe('');
    expect(isBureauOperator('forge_ops', env)).toBe(true);
  });

  it('has no operator when none is configured', () => {
    const none = {} as NodeJS.ProcessEnv;
    expect(isBureauOperator('', none)).toBe(false);
    expect(bureauScopeQuery('ws_a', none)).toBe('managedBy=ws_a');
  });

  it('hides another workspace\'s agent and untagged agents', () => {
    expect(canSeeBureauAgent('ws_a', { managedBy: 'ws_a' }, env)).toBe(true);
    expect(canSeeBureauAgent('ws_a', { managedBy: 'ws_b' }, env)).toBe(false);
    expect(canSeeBureauAgent('ws_a', {}, env)).toBe(false);
    expect(canSeeBureauAgent('forge_ops', { managedBy: 'ws_b' }, env)).toBe(true);
  });
});
