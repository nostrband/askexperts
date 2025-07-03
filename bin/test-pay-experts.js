#!/usr/bin/env node

/**
 * Script to run the payExperts test
 */

// Import the test module
import('../dist/tests/test-pay-experts.js').catch(error => {
  console.error('Failed to run test:', error);
  process.exit(1);
});