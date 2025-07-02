#!/usr/bin/env node

import { runFakeExpert } from '../dist/utils/fakeExpert.js';

// Run the fake expert
runFakeExpert().catch(error => {
  console.error('Error running fake expert:', error);
  process.exit(1);
});