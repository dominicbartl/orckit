import { describe, it, expect } from 'vitest';
import { parseDuration, extractPorts, hasDockerProcesses } from '../../../src/core/config/parser.js';
import type { OrckitConfig } from '../../../src/types/index.js';

describe('Config Parser', () => {
  describe('parseDuration', () => {
    it('should parse milliseconds', () => {
      expect(parseDuration('500ms')).toBe(500);
      expect(parseDuration('1000ms')).toBe(1000);
    });

    it('should parse seconds', () => {
      expect(parseDuration('5s')).toBe(5000);
      expect(parseDuration('30s')).toBe(30000);
    });

    it('should parse minutes', () => {
      expect(parseDuration('1m')).toBe(60000);
      expect(parseDuration('5m')).toBe(300000);
    });

    it('should parse hours', () => {
      expect(parseDuration('1h')).toBe(3600000);
      expect(parseDuration('2h')).toBe(7200000);
    });

    it('should handle decimal values', () => {
      expect(parseDuration('1.5s')).toBe(1500);
      expect(parseDuration('0.5m')).toBe(30000);
    });

    it('should throw on invalid format', () => {
      expect(() => parseDuration('invalid')).toThrow('Invalid duration format');
      expect(() => parseDuration('5')).toThrow('Invalid duration format');
      expect(() => parseDuration('5x')).toThrow('Invalid duration format');
    });
  });

  describe('extractPorts', () => {
    it('should extract ports from TCP ready checks', () => {
      const config: OrckitConfig = {
        processes: {
          db: {
            category: 'infra',
            command: 'docker run postgres',
            ready: {
              type: 'tcp',
              host: 'localhost',
              port: 5432,
            },
          },
        },
      };

      const ports = extractPorts(config);
      expect(ports).toContain(5432);
    });

    it('should extract ports from HTTP ready checks', () => {
      const config: OrckitConfig = {
        processes: {
          api: {
            category: 'backend',
            command: 'npm start',
            ready: {
              type: 'http',
              url: 'http://localhost:3000/health',
            },
          },
        },
      };

      const ports = extractPorts(config);
      expect(ports).toContain(3000);
    });

    it('should extract ports from Docker commands', () => {
      const config: OrckitConfig = {
        processes: {
          db: {
            category: 'infra',
            type: 'docker',
            command: 'docker run -p 5432:5432 postgres',
          },
        },
      };

      const ports = extractPorts(config);
      expect(ports).toContain(5432);
    });

    it('should remove duplicate ports', () => {
      const config: OrckitConfig = {
        processes: {
          api1: {
            category: 'backend',
            command: 'node server.js',
            ready: { type: 'tcp', host: 'localhost', port: 3000 },
          },
          api2: {
            category: 'backend',
            command: 'node server.js',
            ready: { type: 'tcp', host: 'localhost', port: 3000 },
          },
        },
      };

      const ports = extractPorts(config);
      expect(ports.filter((p) => p === 3000)).toHaveLength(1);
    });
  });

  describe('hasDockerProcesses', () => {
    it('should return true if any process uses Docker', () => {
      const config: OrckitConfig = {
        processes: {
          db: {
            category: 'infra',
            type: 'docker',
            command: 'docker run postgres',
          },
          api: {
            category: 'backend',
            command: 'npm start',
          },
        },
      };

      expect(hasDockerProcesses(config)).toBe(true);
    });

    it('should return false if no processes use Docker', () => {
      const config: OrckitConfig = {
        processes: {
          api: {
            category: 'backend',
            command: 'npm start',
          },
        },
      };

      expect(hasDockerProcesses(config)).toBe(false);
    });
  });
});
