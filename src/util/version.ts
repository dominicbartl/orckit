import { readFileSync } from 'node:fs';

/**
 * The installed orckit's version, from its own package.json — two levels up
 * from both `src/util/` (tsx) and `dist/util/` (published build).
 */
export const ORCKIT_VERSION: string = (
  JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;
