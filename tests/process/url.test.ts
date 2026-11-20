import { describe, expect, it } from 'vitest';
import {
  detectUrl,
  initialUrl,
  normalizeUrl,
  rewriteLoopbackHost,
  urlMatcher,
} from '../../src/process/url.js';
import { processConfigSchema } from '../../src/config/schema.js';

describe('detectUrl', () => {
  it.each([
    [
      'Angular ≥17 / Vite',
      '  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m4200\x1b[22m/\x1b[39m',
      'http://localhost:4200',
    ],
    ['Next', '   - Local:        http://localhost:3000', 'http://localhost:3000'],
    [
      'webpack-dev-server',
      '<i> [webpack-dev-server] Loopback: http://localhost:8080/, http://[::1]:8080/',
      'http://localhost:8080',
    ],
    [
      'Angular ≤16',
      '** Angular Live Development Server is listening on localhost:4200, open your browser on http://localhost:4200/ **',
      'http://localhost:4200',
    ],
    [
      'Firebase',
      '│ i  View Emulator UI at http://127.0.0.1:4000/               │',
      'http://127.0.0.1:4000',
    ],
    ['wildcard bind', '  ➜  Local:   http://0.0.0.0:5173/', 'http://localhost:5173'],
  ])('finds the browser URL in %s output', (_label, line, expected) => {
    expect(detectUrl(line)).toBe(expected);
  });

  it('ignores lines that merely mention a URL', () => {
    expect(detectUrl('connecting to http://localhost:5432')).toBeNull();
    expect(detectUrl('  ➜  Network: http://192.168.1.10:5173/')).toBeNull();
    expect(detectUrl('Local: no url here')).toBeNull();
  });
});

describe('normalizeUrl', () => {
  it('keeps paths and queries, drops a bare trailing slash', () => {
    expect(normalizeUrl('http://localhost:3000/')).toBe('http://localhost:3000');
    expect(normalizeUrl('http://localhost:3000/app/?x=1')).toBe('http://localhost:3000/app/?x=1');
  });
  it('trims trailing prose punctuation', () => {
    expect(normalizeUrl('http://localhost:3000).')).toBe('http://localhost:3000');
  });
  it('rejects non-http URLs', () => {
    expect(normalizeUrl('ftp://localhost')).toBeNull();
    expect(normalizeUrl('localhost:3000')).toBeNull();
  });
});

const config = (raw: Record<string, unknown>) =>
  processConfigSchema.parse({ command: 'true', ...raw });

describe('initialUrl / urlMatcher', () => {
  it('uses a static url as-is and never matches output', () => {
    const c = config({ url: 'http://localhost:9000/' });
    expect(initialUrl(c)).toBe('http://localhost:9000');
    expect(urlMatcher(c)).toBeNull();
  });

  it('falls back to the http ready-check origin and still detects from output', () => {
    const c = config({ ready: { type: 'http', url: 'http://localhost:3004/health' } });
    expect(initialUrl(c)).toBe('http://localhost:3004');
    expect(urlMatcher(c)?.('  ➜  Local:   http://localhost:4200/')).toBe('http://localhost:4200');
  });

  it('has nothing without a ready check or output', () => {
    expect(initialUrl(config({}))).toBeNull();
  });

  it('url: false disables everything', () => {
    const c = config({ url: false, ready: { type: 'http', url: 'http://localhost:3004/health' } });
    expect(initialUrl(c)).toBeNull();
    expect(urlMatcher(c)).toBeNull();
  });

  it('captures a custom pattern (group 1, else the whole match)', () => {
    const grouped = config({ url: { pattern: 'templates on (http://\\S+)' } });
    expect(initialUrl(grouped)).toBeNull();
    expect(urlMatcher(grouped)?.('serving templates on http://localhost:3333/')).toBe(
      'http://localhost:3333',
    );
    const whole = config({ url: { pattern: 'http://localhost:\\d+' } });
    expect(urlMatcher(whole)?.('up at http://localhost:7000')).toBe('http://localhost:7000');
    expect(urlMatcher(whole)?.('  ➜  Local:   http://localhost:4200/')).toBe(
      'http://localhost:4200',
    );
  });

  it('rejects an invalid pattern at config time', () => {
    expect(() => config({ url: { pattern: '(' } })).toThrow(/invalid regular expression/);
  });
});

describe('rewriteLoopbackHost', () => {
  it('points loopback URLs at the sandbox host', () => {
    expect(rewriteLoopbackHost('http://localhost:4200', 'wt.app.test')).toBe(
      'http://wt.app.test:4200',
    );
    expect(rewriteLoopbackHost('http://127.0.0.1:4000/ui', 'wt.app.test')).toBe(
      'http://wt.app.test:4000/ui',
    );
  });
  it('leaves other hosts alone', () => {
    expect(rewriteLoopbackHost('https://staging.example.com', 'wt.app.test')).toBe(
      'https://staging.example.com',
    );
  });
});
