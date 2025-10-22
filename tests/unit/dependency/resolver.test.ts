import { describe, it, expect } from 'vitest';
import {
  resolveDependencies,
  groupIntoWaves,
  CircularDependencyError,
  MissingDependencyError,
} from '../../../src/core/dependency/resolver.js';
import type { OrckitConfig } from '../../../src/types/index.js';

describe('Dependency Resolver', () => {
  describe('resolveDependencies', () => {
    it('should resolve simple dependency chain', () => {
      const config: OrckitConfig = {
        processes: {
          a: { category: 'main', command: 'echo a' },
          b: { category: 'main', command: 'echo b', dependencies: ['a'] },
          c: { category: 'main', command: 'echo c', dependencies: ['b'] },
        },
      };

      const order = resolveDependencies(config);
      expect(order).toEqual(['a', 'b', 'c']);
    });

    it('should resolve parallel dependencies', () => {
      const config: OrckitConfig = {
        processes: {
          a: { category: 'main', command: 'echo a' },
          b: { category: 'main', command: 'echo b' },
          c: { category: 'main', command: 'echo c', dependencies: ['a', 'b'] },
        },
      };

      const order = resolveDependencies(config);
      expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
      expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
    });

    it('should throw on circular dependencies', () => {
      const config: OrckitConfig = {
        processes: {
          a: { category: 'main', command: 'echo a', dependencies: ['b'] },
          b: { category: 'main', command: 'echo b', dependencies: ['a'] },
        },
      };

      expect(() => resolveDependencies(config)).toThrow(CircularDependencyError);
    });

    it('should throw on missing dependencies', () => {
      const config: OrckitConfig = {
        processes: {
          a: { category: 'main', command: 'echo a', dependencies: ['nonexistent'] },
        },
      };

      expect(() => resolveDependencies(config)).toThrow(MissingDependencyError);
    });

    it('should handle complex dependency graph', () => {
      const config: OrckitConfig = {
        processes: {
          db: { category: 'infra', command: 'docker run postgres' },
          redis: { category: 'infra', command: 'docker run redis' },
          api: { category: 'backend', command: 'npm start', dependencies: ['db', 'redis'] },
          worker: { category: 'backend', command: 'node worker', dependencies: ['db', 'redis'] },
          frontend: { category: 'frontend', command: 'npm start', dependencies: ['api'] },
        },
      };

      const order = resolveDependencies(config);

      // Infrastructure first
      expect(order.indexOf('db')).toBeLessThan(order.indexOf('api'));
      expect(order.indexOf('redis')).toBeLessThan(order.indexOf('api'));

      // API before frontend
      expect(order.indexOf('api')).toBeLessThan(order.indexOf('frontend'));
    });
  });

  describe('groupIntoWaves', () => {
    it('should group independent processes together', () => {
      const config: OrckitConfig = {
        processes: {
          a: { category: 'main', command: 'echo a' },
          b: { category: 'main', command: 'echo b' },
          c: { category: 'main', command: 'echo c', dependencies: ['a', 'b'] },
        },
      };

      const waves = groupIntoWaves(config);

      expect(waves.length).toBe(2);
      expect(waves[0]).toContain('a');
      expect(waves[0]).toContain('b');
      expect(waves[1]).toEqual(['c']);
    });

    it('should create separate waves for dependent processes', () => {
      const config: OrckitConfig = {
        processes: {
          a: { category: 'main', command: 'echo a' },
          b: { category: 'main', command: 'echo b', dependencies: ['a'] },
          c: { category: 'main', command: 'echo c', dependencies: ['b'] },
        },
      };

      const waves = groupIntoWaves(config);

      expect(waves.length).toBe(3);
      expect(waves[0]).toEqual(['a']);
      expect(waves[1]).toEqual(['b']);
      expect(waves[2]).toEqual(['c']);
    });
  });
});
