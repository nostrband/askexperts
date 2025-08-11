/**
 * Test script to verify that all package exports are working correctly
 */

// Test client exports
import * as client from '../src/client/index.js';
console.log('✅ Client exports loaded successfully');

// Test experts exports
import * as experts from '../src/experts/index.js';
console.log('✅ Experts exports loaded successfully');

// Test docstore exports
import * as docstore from '../src/docstore/index.js';
console.log('✅ Docstore exports loaded successfully');

// Test server exports
import * as server from '../src/server/index.js';
console.log('✅ Server exports loaded successfully');

// Test mcp exports
import * as mcp from '../src/mcp/index.js';
console.log('✅ MCP exports loaded successfully');

// Test openai exports
import * as openai from '../src/openai/index.js';
console.log('✅ OpenAI exports loaded successfully');

// Test rag exports
import * as rag from '../src/rag/index.js';
console.log('✅ RAG exports loaded successfully');

// Test proxy exports
import * as proxy from '../src/proxy/index.js';
console.log('✅ Proxy exports loaded successfully');

// Test payments exports
import * as payments from '../src/payments/index.js';
console.log('✅ Payments exports loaded successfully');

console.log('\n🎉 All exports loaded successfully!');