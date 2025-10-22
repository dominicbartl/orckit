#!/usr/bin/env node

/**
 * Test script for port checking functionality
 *
 * This script:
 * 1. Starts a simple HTTP server on port 3000
 * 2. Runs the port checking utilities
 * 3. Shows detailed information about the process using the port
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

console.log('🧪 Port Checking Test Script\n');

// Create a simple HTTP server on port 3000
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Test server');
});

server.listen(3000, () => {
  console.log('✅ Started test HTTP server on port 3000');
  console.log(`   Process: node (PID: ${process.pid})\n`);

  // Wait a moment for the server to fully start
  setTimeout(() => {
    console.log('🔍 Testing port checking utilities...\n');

    // Run the built CLI with debug mode to check ports
    const cli = spawn(
      'node',
      [
        path.join(__dirname, 'dist/cli/index.js'),
        'validate',
        '-c',
        'examples/simple.yaml',
        '--debug'
      ],
      { stdio: 'inherit' }
    );

    cli.on('exit', (code) => {
      console.log(`\n📊 Test completed with exit code: ${code}`);
      server.close(() => {
        console.log('🛑 Stopped test server');
        process.exit(code || 0);
      });
    });

    cli.on('error', (err) => {
      console.error('❌ Error running CLI:', err);
      server.close(() => {
        process.exit(1);
      });
    });
  }, 500);
});

server.on('error', (err) => {
  console.error('❌ Failed to start test server:', err);
  process.exit(1);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n🛑 Stopping test...');
  server.close(() => {
    process.exit(0);
  });
});
