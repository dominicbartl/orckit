import { describe, expect, it } from 'vitest';
import { mergeEnv } from '../../src/util/env.js';

describe('mergeEnv', () => {
  it('inherits process.env', () => {
    const env = mergeEnv({});
    expect(env.PATH).toBe(process.env.PATH);
  });

  it('extra values override process.env', () => {
    const env = mergeEnv({ PATH: '/custom' });
    expect(env.PATH).toBe('/custom');
  });

  it('extra values are added', () => {
    const env = mergeEnv({ MY_NEW: 'yes' });
    expect(env.MY_NEW).toBe('yes');
  });
});
