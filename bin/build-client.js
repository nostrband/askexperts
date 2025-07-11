#!/usr/bin/env node

/**
 * Script to build the AskExpertsClient for both browser and Node.js environments
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Create the output directory
const outputDir = path.join(rootDir, 'dist', 'client');

// Ensure the output directory exists
fs.mkdirSync(outputDir, { recursive: true });

console.log('Building AskExpertsClient...');

try {
  // Build for Node.js
  console.log('Building for Node.js...');
  execSync('npm run build:client:node', { stdio: 'inherit', cwd: rootDir });
  console.log('Node.js build completed successfully.');

  // Build for browser
  console.log('Building for browser...');
  execSync('npm run build:client:browser', { stdio: 'inherit', cwd: rootDir });
  console.log('Browser build completed successfully.');

  // Copy the README.md file to the output directory
  const readmePath = path.join(rootDir, 'src', 'client', 'README.md');
  const outputReadmePath = path.join(outputDir, 'README.md');

  fs.copyFileSync(readmePath, outputReadmePath);

  console.log('README.md copied to output directory.');

  console.log('Build completed successfully!');
} catch (error) {
  console.error('Build failed:', error);
  process.exit(1);
}