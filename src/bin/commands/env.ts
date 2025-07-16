/**
 * Implementation of the 'env' command that prints environment variables
 */

/**
 * Start the environment variables display
 * @returns A promise that resolves when the environment is displayed
 */
export async function displayEnvironment(): Promise<void> {
  console.log("Environment Variables:");
  console.log("======================");
  
  // Get all environment variables and sort them alphabetically
  const envVars = Object.entries(process.env)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
  
  // Print each environment variable
  for (const [key, value] of envVars) {
    console.log(`${key}=${value}`);
  }
  
  console.log("======================");
}