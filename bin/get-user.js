#!/usr/bin/env node

import { DB } from '../dist/src/db/index.js';

// Check if required arguments are provided
if (process.argv.length < 3) {
  console.error('Usage: node get-user.js <token>');
  process.exit(1);
}

const token = process.argv[2];

const db = new DB();

// Get user from the database by token
async function getUser() {
  try {
    
    // Get the user
    const user = await db.getUserByToken(token);
    
    if (!user) {
      console.error('User not found with the provided token');
      process.exit(1);
    }
    
    console.log('User found:');
    console.log('Pubkey:', user.pubkey);
    console.log('NWC:', user.nwc);
    console.log('Token:', user.token);
    console.log('Timestamp:', new Date(user.timestamp * 1000).toISOString());
    
    // Close the database connection
    await db.close();
  } catch (error) {
    console.error('Error getting user:', error);
    process.exit(1);
  }
}

getUser();