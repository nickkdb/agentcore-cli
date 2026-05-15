#!/usr/bin/env node
import { main } from './cli.js';
import { getErrorMessage } from './errors.js';
import { createRequire } from 'module';

// Handle --version early to avoid loading heavy dependencies
if (process.argv.includes('--version') || process.argv.includes('-V')) {
  const require = createRequire(import.meta.url);
  const { version } = require('../../package.json') as { version: string };
  console.log(version);
  process.exit(0);
}

// Global safety net — prevent raw stack traces from reaching the user
process.on('uncaughtException', err => {
  console.error(`Error: ${getErrorMessage(err)}`);
  process.exit(1);
});
process.on('unhandledRejection', reason => {
  console.error(`Error: ${getErrorMessage(reason)}`);
  process.exit(1);
});

main(process.argv).catch(err => {
  console.error(getErrorMessage(err));
  process.exit(1);
});
