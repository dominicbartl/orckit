/**
 * Angular Runner Diagnostic Test
 * Simple test to capture and display all output
 */

import { describe, it, expect } from 'vitest';
import { AngularRunner } from '../../../src/runners/angular.js';
import type { ProcessConfig } from '../../../src/types/index.js';
import * as path from 'path';

const ANGULAR_APP_PATH = path.resolve(__dirname, '../../../examples/fullstack-app/admin-dashboard');

describe('Angular Diagnostic', () => {
  it('should capture all Angular build output', async () => {
    const config: ProcessConfig = {
      category: 'test',
      command: 'npm run build',
      cwd: ANGULAR_APP_PATH,
    };

    const runner = new AngularRunner('angular-diagnostic', config);

    const allOutput: string[] = [];
    const events: string[] = [];

    // Capture all output
    runner.on('stdout', (data) => {
      allOutput.push(`[STDOUT] ${data}`);
    });

    runner.on('stderr', (data) => {
      allOutput.push(`[STDERR] ${data}`);
    });

    // Capture all events
    runner.on('build:start', () => {
      events.push('build:start');
      console.log('✓ Event: build:start');
    });

    runner.on('build:progress', (data) => {
      events.push(`build:progress: ${JSON.stringify(data)}`);
      console.log(`✓ Event: build:progress`, data);
    });

    runner.on('build:complete', (data) => {
      events.push('build:complete');
      console.log('✓ Event: build:complete', data);
    });

    runner.on('build:failed', () => {
      events.push('build:failed');
      console.log('✗ Event: build:failed');
    });

    runner.on('exit', (code, signal) => {
      events.push(`exit: ${code}`);
      console.log(`ℹ Event: exit (code: ${code}, signal: ${signal})`);
    });

    runner.on('failed', (code, signal) => {
      events.push(`failed: ${code}`);
      console.log(`✗ Event: failed (code: ${code}, signal: ${signal})`);
    });

    runner.on('status', (status) => {
      events.push(`status: ${status}`);
      console.log(`ℹ Status changed to: ${status}`);
    });

    console.log('\n🚀 Starting Angular build...\n');
    await runner.start();

    // Wait for build to complete
    await new Promise(resolve => setTimeout(resolve, 35000));

    console.log('\n📊 Final Status:', runner.status);
    console.log('\n📋 All Output:');
    allOutput.forEach(line => console.log(line));

    console.log('\n📌 Events Emitted:');
    events.forEach(event => console.log(`  - ${event}`));

    console.log('\n🔍 Build Info:', runner.buildInfo);

    // Check if we got expected events
    const hasBuildComplete = events.includes('build:complete');
    const hasBuildStart = events.includes('build:start');

    console.log('\n✅ Summary:');
    console.log(`  Build Start Event: ${hasBuildStart ? '✓' : '✗'}`);
    console.log(`  Build Complete Event: ${hasBuildComplete ? '✓' : '✗'}`);
    console.log(`  Final Status: ${runner.status}`);

    await runner.stop();
  }, 60000);
});
