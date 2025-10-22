import { describe, it, expect } from 'vitest';
import { ANGULAR_BUILDER_SCHEMA } from '../../../src/plugins/angular.js';
import type { MaestroAngularBuilderOptions } from '../../../src/plugins/angular.js';

describe('Angular Plugin', () => {
  describe('ANGULAR_BUILDER_SCHEMA', () => {
    it('should export builder schema', () => {
      expect(ANGULAR_BUILDER_SCHEMA).toBeDefined();
      expect(ANGULAR_BUILDER_SCHEMA.$schema).toBe('http://json-schema.org/draft-07/schema');
      expect(ANGULAR_BUILDER_SCHEMA.type).toBe('object');
    });

    it('should have required properties', () => {
      expect(ANGULAR_BUILDER_SCHEMA.properties).toBeDefined();
      expect(ANGULAR_BUILDER_SCHEMA.properties.processName).toBeDefined();
      expect(ANGULAR_BUILDER_SCHEMA.properties.orckitConfig).toBeDefined();
      expect(ANGULAR_BUILDER_SCHEMA.properties.waitFor).toBeDefined();
    });

    it('should require processName', () => {
      expect(ANGULAR_BUILDER_SCHEMA.required).toContain('processName');
    });

    it('should define processName as string', () => {
      expect(ANGULAR_BUILDER_SCHEMA.properties.processName.type).toBe('string');
    });

    it('should define orckitConfig as optional string', () => {
      expect(ANGULAR_BUILDER_SCHEMA.properties.orckitConfig.type).toBe('string');
      expect(ANGULAR_BUILDER_SCHEMA.required).not.toContain('orckitConfig');
    });

    it('should define waitFor as array', () => {
      expect(ANGULAR_BUILDER_SCHEMA.properties.waitFor.type).toBe('array');
      expect(ANGULAR_BUILDER_SCHEMA.properties.waitFor.items).toEqual({ type: 'string' });
    });
  });

  describe('MaestroAngularBuilderOptions', () => {
    it('should allow valid options', () => {
      const options: MaestroAngularBuilderOptions = {
        processName: 'angular',
        orckitConfig: './orckit.yaml',
        waitFor: ['api'],
      };

      expect(options.processName).toBe('angular');
      expect(options.orckitConfig).toBe('./orckit.yaml');
      expect(options.waitFor).toEqual(['api']);
    });

    it('should allow minimal options', () => {
      const options: MaestroAngularBuilderOptions = {
        processName: 'angular',
      };

      expect(options.processName).toBe('angular');
      expect(options.orckitConfig).toBeUndefined();
      expect(options.waitFor).toBeUndefined();
    });
  });
});
