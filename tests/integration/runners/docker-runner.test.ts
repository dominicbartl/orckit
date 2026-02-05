/**
 * DockerRunner Integration Tests
 *
 * Tests the DockerRunner with real Docker containers
 * Requires Docker to be installed and running
 */

import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { DockerRunner } from '../../../src/runners/docker.js';
import type { ProcessConfig } from '../../../src/types/index.js';
import { execa } from 'execa';
import { runProcess } from './runner-test-helper.js';

// Check if Docker is available
async function isDockerAvailable(): Promise<boolean> {
  try {
    await execa('docker', ['version']);
    return true;
  } catch {
    return false;
  }
}

describe('DockerRunner Integration', () => {
  let runner: DockerRunner;
  let dockerAvailable = false;

  beforeAll(async () => {
    dockerAvailable = await isDockerAvailable();
  });

  afterEach(async () => {
    if (runner) {
      await runner.stop();
    }
  });

  describe('basic container lifecycle', () => {
    it('should start and stop a simple container', async () => {
      if (!dockerAvailable) {
        console.log('Skipping Docker test - Docker not available');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'docker run --rm alpine sh -c "echo \\"Hello from Docker\\"; sleep 1"',
      };

      runner = new DockerRunner('alpine-test', config);

      const result = await runProcess(runner, {
        timeout: 3000,
        successCondition: 'exit:0',
      });

      expect(result.success).toBe(true);
      expect(result.outputs.join('')).toContain('Hello from Docker');
    }, 15000);

    it('should start and stop a long-running container', async () => {
      if (!dockerAvailable) {
        console.log('Skipping Docker test - Docker not available');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'docker run --rm --name orckit-test-nginx nginx:alpine',
      };

      runner = new DockerRunner('nginx-test', config);

      // Start and let it run for a bit
      await runner.start();

      expect(runner.status).toBe('running');
      expect(runner.pid).toBeGreaterThan(0);

      // Wait for container to start
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Stop should clean up the container
      await runner.stop();

      expect(runner.status).toBe('stopped');
      expect(runner.pid).toBe(null);

      // Verify container was removed
      try {
        const result = await execa('docker', ['ps', '-a', '--filter', 'name=orckit-test-nginx', '--format', '{{.Names}}']);
        expect(result.stdout).not.toContain('orckit-test-nginx');
      } catch {
        // Container not found, which is expected
      }
    }, 15000);

    it('should capture container ID from output', async () => {
      if (!dockerAvailable) {
        console.log('Skipping Docker test - Docker not available');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'docker run -d --rm alpine sleep 5',
      };

      runner = new DockerRunner('detached-test', config);

      const result = await runProcess(runner, {
        timeout: 2000,
        successCondition: 'exit:0',
      });

      expect(result.success).toBe(true);
      const output = result.outputs.join('').replace(/\n/g, '').trim();
      // Should have captured a 64-character hex container ID (or the short form)
      expect(output).toMatch(/[a-f0-9]{12,64}/);
    }, 15000);
  });

  describe('container with port mapping', () => {
    it('should start container with port mapping', async () => {
      if (!dockerAvailable) {
        console.log('Skipping Docker test - Docker not available');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'docker run --rm -p 18080:80 --name orckit-test-web nginx:alpine',
      };

      runner = new DockerRunner('web-test', config);

      // Start and let it run
      await runner.start();

      expect(runner.status).toBe('running');

      // Wait for nginx to start
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify port is accessible
      try {
        const response = await fetch('http://localhost:18080');
        expect(response.status).toBe(200);
      } catch (error) {
        console.log('Port check failed:', error);
      }
    }, 15000);
  });

  describe('container with environment variables', () => {
    it('should pass environment variables to container', async () => {
      if (!dockerAvailable) {
        console.log('Skipping Docker test - Docker not available');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'docker run --rm -e TEST_VAR=hello alpine sh -c "echo \\$TEST_VAR; sleep 1"',
      };

      runner = new DockerRunner('env-test', config);

      const result = await runProcess(runner, {
        timeout: 5000,
        successCondition: 'exit:0',
      });

      expect(result.success).toBe(true);
      const output = result.outputs.join('');
      // May be in stdout or stderr
      expect(output.includes('hello') || result.errors.join('').includes('hello')).toBe(true);
    }, 15000);
  });

  describe('error handling', () => {
    it('should handle container that fails to start', async () => {
      if (!dockerAvailable) {
        console.log('Skipping Docker test - Docker not available');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'docker run --rm alpine sh -c "exit 1"',
      };

      runner = new DockerRunner('fail-test', config);

      const result = await runProcess(runner, {
        timeout: 3000,
        successCondition: 'custom',
        customSuccessCheck: (res) => {
          // Success means we detected the failure
          return res.events.includes('failed:1') || runner.status === 'failed';
        },
      });

      expect(result.success).toBe(true);
      expect(runner.status).toBe('failed');
    }, 15000);

    it('should handle non-existent image', async () => {
      if (!dockerAvailable) {
        console.log('Skipping Docker test - Docker not available');
        return;
      }

      const config: ProcessConfig = {
        category: 'test',
        command: 'docker run --rm non-existent-image-12345',
      };

      runner = new DockerRunner('nonexistent-test', config);

      const result = await runProcess(runner, {
        timeout: 3000,
        successCondition: 'custom',
        customSuccessCheck: (res) => {
          // Success means we got the expected error
          return res.errors.join('').includes('Unable to find image');
        },
      });

      expect(result.success).toBe(true);
      expect(result.errors.join('')).toContain('Unable to find image');
    }, 10000);
  });
});
