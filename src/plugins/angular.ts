/**
 * Angular builder for Orckit integration
 *
 * This is a placeholder for an Angular custom builder
 * In a real implementation, this would be a proper Angular CLI builder
 */

/**
 * Angular builder options
 */
export interface MaestroAngularBuilderOptions {
  /**
   * Path to orckit configuration file
   */
  orckitConfig?: string;

  /**
   * Process name in orckit config
   */
  processName: string;

  /**
   * Processes to wait for before starting build
   */
  waitFor?: string[];
}

/**
 * Angular builder schema for angular.json
 *
 * @example
 * ```json
 * {
 *   "projects": {
 *     "my-app": {
 *       "architect": {
 *         "build": {
 *           "builder": "@orckit/cli/angular:build",
 *           "options": {
 *             "orckitConfig": "./orckit.yaml",
 *             "processName": "angular",
 *             "waitFor": ["api"]
 *           }
 *         }
 *       }
 *     }
 *   }
 * }
 * ```
 */
export const ANGULAR_BUILDER_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema',
  type: 'object',
  properties: {
    orckitConfig: {
      type: 'string',
      description: 'Path to orckit configuration file',
    },
    processName: {
      type: 'string',
      description: 'Process name in orckit config',
    },
    waitFor: {
      type: 'array',
      items: { type: 'string' },
      description: 'Processes to wait for before starting',
    },
  },
  required: ['processName'],
};

/**
 * Note: A full Angular builder implementation would require:
 * 1. Implementing BuilderContext from @angular-devkit/architect
 * 2. Creating a proper builder function
 * 3. Setting up builder.json with the schema
 * 4. Packaging as a separate @orckit/angular package
 *
 * This is left as a stub for documentation purposes.
 */
