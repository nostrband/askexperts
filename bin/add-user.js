#!/usr/bin/env node

import { DB } from '../dist/src/db/index.js';

// Check if required arguments are provided
if (process.argv.length < 5) {
  console.error('Usage: node add-user.js <pubkey> <nsec> <nwc>');
  process.exit(1);
}

const pubkey = process.argv[2];
const nsec = process.argv[3];
const nwc = process.argv[4];

const db = new DB();

// Add user to the database
async function addUser() {
  try {
    
    // Add the user
    const user = await db.addUser({
      pubkey,
      nsec,
      nwc
    });
    
    console.log('User added successfully:');
    console.log('Pubkey:', user.pubkey);
    console.log('Token:', user.token);
    console.log('Timestamp:', new Date(user.timestamp * 1000).toISOString());
    console.log('\nUse this token in the Authorization header:');
    console.log(`Authorization: Bearer ${user.token}`);
    
    // Close the database connection
    await db.close();
  } catch (error) {
    console.error('Error adding user:', error);
    process.exit(1);
  }
}

addUser();