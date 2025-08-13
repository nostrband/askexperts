import { ExpertServer, ExpertServerOptions } from '../src/experts/ExpertServer.js';
import { ExpertServerPerms } from '../src/experts/interfaces.js';
import { Request } from 'express';
import { createAuthToken } from '../src/common/auth.js';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import fetch from 'node-fetch';

// Mock implementation of ExpertServerPerms for testing
class MockExpertServerPerms implements ExpertServerPerms {
  private userIdMap: Map<string, string> = new Map();

  constructor() {
    // Add some test users
    this.userIdMap.set('test-pubkey-1', 'user-id-1');
    this.userIdMap.set('test-pubkey-2', 'user-id-2');
  }
  
  // Method to add a test user
  addTestUser(pubkey: string, userId: string): void {
    this.userIdMap.set(pubkey, userId);
  }

  async checkPerms(user_id: string, req: Request): Promise<{ listIds?: string[] }> {
    // For testing, allow all operations
    return {};
  }

  async getUserId(pubkey: string): Promise<string> {
    // Return the user ID for the given pubkey
    const userId = this.userIdMap.get(pubkey);
    if (!userId) {
      throw new Error(`User ID not found for pubkey: ${pubkey}`);
    }
    return userId;
  }
}

async function runTest() {
  console.log('Starting ExpertServer auth test...');

  // Create a test server
  const port = 3333;
  const options: ExpertServerOptions = {
    port,
    basePath: '/api',
    origin: `http://localhost:${port}`,
    perms: new MockExpertServerPerms(),
  };

  const server = new ExpertServer(options);
  await server.start();

  try {
    // Generate a test private key and get the public key
    const privateKey = generateSecretKey();
    const pubkey = getPublicKey(privateKey);
    console.log(`Test pubkey: ${pubkey}`);
    
    // Add this pubkey to the userIdMap
    (options.perms as MockExpertServerPerms).addTestUser(pubkey, 'test-user-id');

    // Create an auth token
    const url = `http://localhost:${port}/api/experts`;
    const authToken = createAuthToken(
      privateKey,
      url,
      'POST'
    );

    // Create a test expert
    const expertData = {
      pubkey: 'test-expert-pubkey',
      name: 'Test Expert',
      description: 'A test expert',
      model: 'test-model',
      disabled: false,
    };

    // Make a request to insert an expert
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(expertData)
    });

    const responseData = await response.json();
    console.log('Response:', responseData);
    
    // Get the expert to verify user_id was set
    const getUrl = `http://localhost:${port}/api/experts/test-expert-pubkey`;
    const getAuthToken = createAuthToken(
      privateKey,
      getUrl,
      'GET'
    );
    
    const getResponse = await fetch(getUrl, {
      method: 'GET',
      headers: {
        Authorization: getAuthToken,
        'Content-Type': 'application/json',
      }
    });
    
    const expert = await getResponse.json();
    console.log('Retrieved expert:', expert);
    
    // Verify user_id was set correctly
    if (expert.user_id === 'test-user-id') {
      console.log('✅ user_id was correctly set to the expected value in the auth middleware');
    } else {
      console.error(`❌ user_id was not set correctly. Expected: 'test-user-id', Got: '${expert.user_id}'`);
    }
    
    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    // Stop the server
    await server.stop();
  }
}

// Run the test
runTest().catch(console.error);