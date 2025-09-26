import { Command } from "commander";
import { debugError } from "../../../common/debug.js";
import { DB } from "../../../db/DB.js";
import { APP_DB_PATH } from "../../../common/constants.js";
import { generateRandomKeyPair } from "../../../common/crypto.js";
import { setCurrentUserId } from "../../../common/users.js";
import { addCommonOptions } from "./index.js";
import { getPublicKey } from "nostr-tools";
import { bytesToHex } from "nostr-tools/utils";

/**
 * Options for the add user command
 */
interface AddUserOptions {
  privkey?: string;
  pubkey?: string;
  debug?: boolean;
}

/**
 * Execute the add user command
 * 
 * @param options Command line options
 */
export async function executeAddUserCommand(
  options: AddUserOptions
): Promise<void> {
  try {
    // Validate that only one of privkey or pubkey is provided
    if (options.privkey && options.pubkey) {
      throw new Error("Cannot specify both --privkey and --pubkey options");
    }

    // Initialize the database
    const db = new DB(APP_DB_PATH);

    let privateKey: Uint8Array | null = null;
    let publicKey: string;
    let privateKeyHex: string;

    if (options.pubkey) {
      // Use provided public key without private key
      publicKey = options.pubkey;
      
      // Validate public key format (should be 64 hex characters)
      if (!/^[0-9a-fA-F]{64}$/.test(publicKey)) {
        throw new Error("Invalid public key: must be 64 hex characters");
      }
      
      // Set empty private key for pubkey-only users
      privateKeyHex = "";
      
      console.log("Adding user with public key only (no private key stored)");
    } else if (options.privkey) {
      // Use provided private key
      privateKey = new Uint8Array(
        options.privkey.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
      );
      
      // Validate private key length
      if (privateKey.length !== 32) {
        throw new Error("Invalid private key: must be 32 bytes (64 hex characters)");
      }
      
      // Get public key from private key
      publicKey = getPublicKey(privateKey);
      privateKeyHex = bytesToHex(privateKey);
    } else {
      // Generate a new key pair
      const keyPair = generateRandomKeyPair();
      privateKey = keyPair.privateKey;
      publicKey = keyPair.publicKey;
      privateKeyHex = bytesToHex(privateKey);
    }

    // Insert the user into the database
    const userId = await db.insertUser({
      pubkey: publicKey,
      privkey: privateKeyHex
    });

    console.log(`User added successfully with ID: ${userId}`);
    console.log(`Public key: ${publicKey}`);
    
    if (options.pubkey) {
      console.log("Note: No private key stored for this user");
    }

    // Check if this is the first user
    const users = await db.listUsers();
    if (users.length === 1) {
      // Set this user as the current user
      setCurrentUserId(userId);
      console.log(`Set as current user`);
    }

  } catch (error) {
    debugError("Failed to add user:", error);
    throw error;
  }
}

/**
 * Register the add user command with the CLI
 *
 * @param program The commander program
 */
export function registerAddCommand(program: Command): void {
  const command = program
    .command("add")
    .description("Add a new user with an optional private key or pubkey-only")
    .option("-p, --privkey <string>", "Private key in hex format (if not provided, a new key will be generated)")
    .option("--pubkey <string>", "Public key in hex format (creates user without storing private key)")
    .action(async (options) => {
      try {
        await executeAddUserCommand(options);
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
    
  // Add common options (debug)
  addCommonOptions(command);
}