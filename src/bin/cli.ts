import { Command } from 'commander';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { startMcpServer } from './commands/mcp.js';

// Load environment variables from .env file without debug logs
dotenv.config({ debug: false });

/**
 * Get the package version from package.json
 * @returns The package version
 */
function getPackageVersion(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  
  // First try to find package.json in the project root
  let packageJsonPath = resolve(__dirname, '../../../package.json');
  
  // If that doesn't exist (when running from dist), try one level up
  if (!fs.existsSync(packageJsonPath)) {
    packageJsonPath = resolve(__dirname, '../../package.json');
  }
  
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.version;
}

/**
 * Helper function to parse comma-separated lists
 * @param value The comma-separated string
 * @returns Array of trimmed strings
 */
function commaSeparatedList(value: string): string[] {
  return value.split(',').map(item => item.trim());
}

/**
 * Main CLI function that sets up the commander program and parses arguments
 */
export function runCli(): void {
  const program = new Command();

  program
    .name('askexperts')
    .description('CLI utility for AskExperts')
    .version(getPackageVersion());

  // MCP command
  program
    .command('mcp')
    .description('Launch the stdio MCP server')
    .option('-n, --nwc <string>', 'NWC connection string for payments')
    .option('-r, --relays <items>', 'Comma-separated list of discovery relays', commaSeparatedList)
    .option('-d, --debug', 'Enable debug logging')
    .action(async (options) => {
      try {
        await startMcpServer(options);
      } catch (error) {
        console.error('Error starting MCP server:', error);
        process.exit(1);
      }
    });

  // Parse command line arguments
  program.parse();

  // If no arguments provided, show help
  if (process.argv.length === 2) {
    program.help();
  }
}

// Run the CLI when this file is executed directly
runCli();