/**
 * Tests for the encryption utilities
 * Tests both "none" and "nip44" encryption types
 */

import { DefaultEncryption, EncryptionError, ENCRYPTION_NONE, ENCRYPTION_NIP44 } from '../src/stream/encryption.js';
import { generateRandomKeyPair } from '../src/common/crypto.js';
import assert from 'assert';
import { EncryptionMethod } from '../src/stream/types.js';

// Helper function to create a large string of a specific size
function createLargeString(sizeInKB: number): string {
  const chunk = 'A'.repeat(1024); // 1KB chunk
  return chunk.repeat(sizeInKB);
}

async function testNoneEncryption() {
  console.log('Testing "none" encryption...');
  
  const encryption = new DefaultEncryption();
  
  // Test with string data
  const stringData = 'Hello, world!';
  const encryptedString = await encryption.encrypt(stringData, ENCRYPTION_NONE);
  const decryptedString = await encryption.decrypt(encryptedString, ENCRYPTION_NONE, false);
  
  assert.strictEqual(decryptedString, stringData, 'Decrypted string should match original string');
  console.log('String encryption/decryption successful');
  
  // Test with binary data
  const binaryData = new TextEncoder().encode('Binary data test');
  const encryptedBinary = await encryption.encrypt(binaryData, ENCRYPTION_NONE);
  const decryptedBinary = await encryption.decrypt(encryptedBinary, ENCRYPTION_NONE, true);
  
  assert(decryptedBinary instanceof Uint8Array, 'Decrypted binary should be Uint8Array');
  assert.strictEqual(
    new TextDecoder().decode(decryptedBinary as Uint8Array),
    new TextDecoder().decode(binaryData),
    'Decrypted binary should match original binary'
  );
  console.log('Binary encryption/decryption successful');
  
  console.log('"none" encryption test passed!');
}

async function testNip44Encryption() {
  console.log('Testing "nip44" encryption...');
  
  const encryption = new DefaultEncryption();
  
  // Generate key pairs for sender and recipient
  const sender = generateRandomKeyPair();
  const recipient = generateRandomKeyPair();
  
  // Test with string data
  const stringData = 'Secret message for NIP-44 encryption';
  const encryptedString = await encryption.encrypt(
    stringData,
    ENCRYPTION_NIP44,
    sender.privateKey,
    recipient.publicKey
  );
  
  // Verify encrypted data is different from original
  assert.notStrictEqual(encryptedString, stringData, 'Encrypted string should be different from original');
  
  // Decrypt the data
  const decryptedString = await encryption.decrypt(
    encryptedString,
    ENCRYPTION_NIP44,
    false,
    recipient.privateKey,
    sender.publicKey
  );
  
  assert.strictEqual(decryptedString, stringData, 'Decrypted string should match original string');
  console.log('String encryption/decryption successful');
  
  // Test with binary data
  const binaryData = new TextEncoder().encode('Binary secret data for NIP-44 encryption');
  const encryptedBinary = await encryption.encrypt(
    binaryData,
    ENCRYPTION_NIP44,
    sender.privateKey,
    recipient.publicKey
  );
  
  // Decrypt the binary data
  const decryptedBinary = await encryption.decrypt(
    encryptedBinary,
    ENCRYPTION_NIP44,
    true,
    recipient.privateKey,
    sender.publicKey
  );
  
  assert(decryptedBinary instanceof Uint8Array, 'Decrypted binary should be Uint8Array');
  assert.strictEqual(
    new TextDecoder().decode(decryptedBinary as Uint8Array),
    new TextDecoder().decode(binaryData),
    'Decrypted binary should match original binary'
  );
  console.log('Binary encryption/decryption successful');
  
  console.log('"nip44" encryption test passed!');
}

async function testErrorHandling() {
  console.log('Testing error handling...');
  
  const encryption = new DefaultEncryption();
  const sender = generateRandomKeyPair();
  const recipient = generateRandomKeyPair();
  
  // Test unsupported encryption type
  try {
    await encryption.encrypt('Test data', 'unsupported' as EncryptionMethod);
    throw new Error('Should have thrown EncryptionError for unsupported encryption type');
  } catch (error) {
    if (error instanceof EncryptionError) {
      console.log(`Successfully caught unsupported encryption type error: ${error.message}`);
    } else {
      throw error;
    }
  }
  
  // Test missing keys for NIP-44 encryption
  try {
    await encryption.encrypt('Test data', ENCRYPTION_NIP44);
    throw new Error('Should have thrown EncryptionError for missing keys');
  } catch (error) {
    if (error instanceof EncryptionError) {
      console.log(`Successfully caught missing keys error: ${error.message}`);
    } else {
      throw error;
    }
  }
  
  // Test decryption with wrong keys
  const data = 'Secret message';
  const wrongSender = generateRandomKeyPair();
  
  const encrypted = await encryption.encrypt(
    data,
    ENCRYPTION_NIP44,
    sender.privateKey,
    recipient.publicKey
  );
  
  try {
    // Try to decrypt with wrong sender public key
    await encryption.decrypt(
      encrypted,
      ENCRYPTION_NIP44,
      false,
      recipient.privateKey,
      wrongSender.publicKey
    );
    throw new Error('Should have thrown EncryptionError for wrong keys');
  } catch (error) {
    if (error instanceof EncryptionError) {
      console.log(`Successfully caught wrong keys error: ${error.message}`);
    } else {
      throw error;
    }
  }
  
  console.log('Error handling test passed!');
}

async function testLargeData() {
  console.log('Testing large data encryption...');
  
  const encryption = new DefaultEncryption();
  const sender = generateRandomKeyPair();
  const recipient = generateRandomKeyPair();
  
  // Create a 50KB string (below NIP-44's 64KB limit)
  const largeData = createLargeString(50);
  
  // Test with "none" encryption
  console.log('Testing large data with "none" encryption...');
  const encryptedNone = await encryption.encrypt(largeData, ENCRYPTION_NONE);
  const decryptedNone = await encryption.decrypt(encryptedNone, ENCRYPTION_NONE, false);
  assert.strictEqual(decryptedNone, largeData, 'Decrypted large data should match original with "none" encryption');
  
  // Test with "nip44" encryption
  console.log('Testing large data with "nip44" encryption...');
  const encryptedNip44 = await encryption.encrypt(
    largeData,
    ENCRYPTION_NIP44,
    sender.privateKey,
    recipient.publicKey
  );
  
  const decryptedNip44 = await encryption.decrypt(
    encryptedNip44,
    ENCRYPTION_NIP44,
    false,
    recipient.privateKey,
    sender.publicKey
  );
  
  assert.strictEqual(decryptedNip44, largeData, 'Decrypted large data should match original with "nip44" encryption');
  
  console.log('Large data encryption test passed!');
}

async function runTests() {
  try {
    await testNoneEncryption();
    await testNip44Encryption();
    await testErrorHandling();
    await testLargeData();
    console.log('All encryption tests passed!');
  } catch (error) {
    console.error('Test failed:', error);
    process.exit(1);
  }
}

runTests();