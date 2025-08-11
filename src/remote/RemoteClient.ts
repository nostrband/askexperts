import fs from "fs";
import path from "path";
import { generateSecretKey, getPublicKey } from "nostr-tools";
import { APP_DIR } from "../common/constants.js";
import { createAuthToken } from "../common/auth.js";
import fetch from "node-fetch";
import { debugError } from "../common/debug.js";

// Path to the remote key file
const REMOTE_KEY_PATH = path.join(APP_DIR, "remote.key");

/**
 * Client for interacting with the askexperts.io remote service
 */
export class RemoteClient {
  private privateKey: Uint8Array;
  private publicKey: string;
  private baseUrl: string;

  /**
   * Create a new RemoteClient instance
   * Reads existing private key or generates a new one
   * @param baseUrl - Base URL for the API (defaults to askexperts.io)
   */
  constructor(baseUrl: string = "https://api.askexperts.io") {
    this.baseUrl = baseUrl;
    
    // Check if the key file exists
    if (fs.existsSync(REMOTE_KEY_PATH)) {
      console.log("Reading existing private key...");
      const hexKey = fs.readFileSync(REMOTE_KEY_PATH, "utf-8").trim();
      this.privateKey = new Uint8Array(Buffer.from(hexKey, "hex"));
    } else {
      console.log("Generating new private key...");
      this.privateKey = generateSecretKey();
      
      // Ensure the directory exists
      if (!fs.existsSync(APP_DIR)) {
        fs.mkdirSync(APP_DIR, { recursive: true });
      }
      
      // Write the key to the file in hex format
      const hexKey = Buffer.from(this.privateKey).toString("hex");
      fs.writeFileSync(REMOTE_KEY_PATH, hexKey);
      console.log(`Private key saved to ${REMOTE_KEY_PATH}`);
    }

    // Get the public key
    this.publicKey = getPublicKey(this.privateKey);
  }

  /**
   * Get the public key
   * @returns The public key
   */
  getPublicKey(): string {
    return this.publicKey;
  }

  /**
   * Sign up on the askexperts.io remote service
   * @returns A promise that resolves when signup is complete
   */
  async signup(): Promise<void> {
    try {
      // Create the URL for registration
      const url = `${this.baseUrl}/signup`;
      
      // Create an auth token
      const authToken = createAuthToken(this.privateKey, url, "GET");
      
      // Call the API to register the user
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": authToken
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to register: ${response.status} ${response.statusText}`);
      }

      console.log("Signed up on askexperts.io");
      console.log(`Public key: ${this.publicKey}`);
      
    } catch (error) {
      debugError("Failed to sign up:", error);
      throw error;
    }
  }

  /**
   * Get the current balance
   * @returns A promise that resolves to the balance
   */
  async balance(): Promise<number> {
    try {
      // Create the URL for balance check
      const url = `${this.baseUrl}/balance`;
      
      // Create an auth token
      const authToken = createAuthToken(this.privateKey, url, "GET");
      
      // Call the API to get the balance
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": authToken
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get balance: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { balance: number };
      console.log(`Balance: ${data.balance} sats`);
      return data.balance;
      
    } catch (error) {
      debugError("Failed to get balance:", error);
      throw error;
    }
  }

  /**
   * Create a new invoice
   * @param amount - The amount in satoshis
   * @returns A promise that resolves to the invoice string
   */
  async invoice(amount: number): Promise<string> {
    try {
      // Create the URL for invoice creation
      const url = `${this.baseUrl}/invoice?amount=${amount}`;
      
      // Create an auth token
      const authToken = createAuthToken(this.privateKey, url, "GET");
      
      // Call the API to create an invoice
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": authToken
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to create invoice: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { invoice: string };
      console.log(`Invoice: ${data.invoice}`);
      return data.invoice;
      
    } catch (error) {
      debugError("Failed to create invoice:", error);
      throw error;
    }
  }

  /**
   * Pay an invoice
   * @param invoice - The invoice to pay
   * @returns A promise that resolves to the preimage
   */
  async pay(invoice: string): Promise<string> {
    try {
      // Create the URL for payment
      const url = `${this.baseUrl}/pay?invoice=${encodeURIComponent(invoice)}`;
      
      // Create an auth token
      const authToken = createAuthToken(this.privateKey, url, "GET");
      
      // Call the API to pay the invoice
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": authToken
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to pay invoice: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { preimage: string };
      console.log(`Payment successful! Preimage: ${data.preimage}`);
      return data.preimage;
      
    } catch (error) {
      debugError("Failed to pay invoice:", error);
      throw error;
    }
  }
}