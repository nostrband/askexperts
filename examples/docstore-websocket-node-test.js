// Test script for DocStoreWebSocketClient in Node.js environment
import { DocStoreWebSocketClient, generateUUID } from '../dist/docstore/index.node.js';
import WebSocket from 'ws';

// Test UUID generation
console.log('Testing UUID generation...');
const uuid = generateUUID();
console.log(`Generated UUID: ${uuid}`);

// Test DocStoreWebSocketClient with custom WebSocket
console.log('\nTesting DocStoreWebSocketClient with custom WebSocket...');

// Create a mock WebSocket
const mockWs = {
  send: (data) => {
    console.log(`Mock WebSocket sent: ${data}`);
  },
  close: () => {
    console.log('Mock WebSocket closed');
  },
  onopen: null,
  onmessage: null,
  onclose: null,
  onerror: null
};

// Create client with mock WebSocket
const client = new DocStoreWebSocketClient({
  url: 'ws://example.com',
  webSocket: mockWs
});

// Trigger the onopen handler
setTimeout(() => {
  console.log('Triggering mock WebSocket open event');
  if (mockWs.onopen) mockWs.onopen();
}, 500);

// Test with real WebSocket (commented out to avoid actual connection)
/*
console.log('\nTesting DocStoreWebSocketClient with real WebSocket...');
const realClient = new DocStoreWebSocketClient({
  url: 'ws://localhost:8080'
});

// Wait for connection or timeout
setTimeout(() => {
  console.log('Closing client');
  realClient[Symbol.dispose]();
}, 5000);
*/

// Test providing a WebSocket instance from 'ws' package
console.log('\nTesting DocStoreWebSocketClient with ws package...');
const wsClient = new DocStoreWebSocketClient({
  url: 'ws://example.com',
  webSocket: new WebSocket('ws://example.com', { skipConnectionCheck: true })
});

// Clean up after 2 seconds
setTimeout(() => {
  console.log('\nTest complete, cleaning up...');
  client[Symbol.dispose]();
  wsClient[Symbol.dispose]();
}, 2000);