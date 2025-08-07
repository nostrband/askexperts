#!/usr/bin/env node

import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import http from 'http';

// Create an HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server is running');
});

// Create a WebSocket server by passing the HTTP server
const wss = new WebSocketServer({ server });

// Handle WebSocket connections
wss.on('connection', (ws) => {
  console.log('Client connected');
  
  // Send a welcome message
  ws.send('Welcome to the WebSocket server!');
  
  // Handle messages from the client
  ws.on('message', (message) => {
    console.log(`Received message: ${message}`);
    
    // Echo the message back
    ws.send(`Echo: ${message}`);
  });
  
  // Handle connection close
  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Start the server
const PORT = 8081;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
  
  // Create a client to test the connection
  const client = new WebSocket(`ws://localhost:${PORT}`);
  
  client.on('open', () => {
    console.log('Connected to server');
    
    // Send a test message
    client.send('Hello, server!');
    
    // Close the connection after 2 seconds
    setTimeout(() => {
      console.log('Closing client connection');
      client.close();
      
      // Close the server after 1 more second
      setTimeout(() => {
        console.log('Closing server');
        server.close();
      }, 1000);
    }, 2000);
  });
  
  client.on('message', (message) => {
    console.log(`Received from server: ${message}`);
  });
  
  client.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
  
  client.on('close', () => {
    console.log('Disconnected from server');
  });
});