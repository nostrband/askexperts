# DocStoreSQLite WebSocket API

This document describes the WebSocket API for the DocStoreSQLite class, which provides remote access to document storage functionality.

## General Approach

The DocStoreSQLiteServer exposes the DocStoreSQLite functionality through a WebSocket interface. The API follows a message-based approach with two primary patterns:

1. **Request-Reply Pattern**: For simple operations like getting, creating, or deleting documents and docstores.
2. **Subscription Pattern**: For streaming documents with filtering options, allowing clients to receive multiple documents over time.

## Message Format

All messages use JSON format for data exchange. Each message has a common structure:

```json
{
  "id": "unique-message-id",
  "type": "message-type",
  "method": "method-name",
  "params": { /* method-specific parameters */ },
  "error": { /* optional error information */ }
}
```

- `id`: A unique identifier for the message, used to correlate requests with responses
- `type`: The message type, one of: "request", "response", "subscription", "document", "end"
- `method`: The method being called or responded to
- `params`: Method-specific parameters
- `error`: Optional error information, present only in response messages when an error occurs

## Request-Reply Methods

These methods follow a simple request-response pattern. The client sends a request, and the server responds with a single response.

### Available Methods

#### 1. `upsert`

Inserts or updates a document in the store.

**Request:**
```json
{
  "id": "msg-1",
  "type": "request",
  "method": "upsert",
  "params": {
    "doc": {
      "id": "doc-id",
      "docstore_id": "docstore-id",
      "timestamp": 1628097600,
      "created_at": 1628097600,
      "type": "document-type",
      "data": "document-data",
      "embeddings": [] // Array of Float32Array embeddings
    }
  }
}
```

**Response:**
```json
{
  "id": "msg-1",
  "type": "response",
  "method": "upsert",
  "params": {
    "success": true
  }
}
```

#### 2. `get`

Gets a document by ID.

**Request:**
```json
{
  "id": "msg-2",
  "type": "request",
  "method": "get",
  "params": {
    "docstore_id": "docstore-id",
    "doc_id": "doc-id"
  }
}
```

**Response:**
```json
{
  "id": "msg-2",
  "type": "response",
  "method": "get",
  "params": {
    "doc": {
      "id": "doc-id",
      "docstore_id": "docstore-id",
      "timestamp": 1628097600,
      "created_at": 1628097600,
      "type": "document-type",
      "data": "document-data",
      "embeddings": [] // Array of Float32Array embeddings
    }
  }
}
```

#### 3. `delete`

Deletes a document by ID.

**Request:**
```json
{
  "id": "msg-3",
  "type": "request",
  "method": "delete",
  "params": {
    "docstore_id": "docstore-id",
    "doc_id": "doc-id"
  }
}
```

**Response:**
```json
{
  "id": "msg-3",
  "type": "response",
  "method": "delete",
  "params": {
    "success": true
  }
}
```

#### 4. `createDocstore`

Creates a new docstore.

**Request:**
```json
{
  "id": "msg-4",
  "type": "request",
  "method": "createDocstore",
  "params": {
    "name": "docstore-name",
    "model": "model-name",
    "vector_size": 768,
    "options": "model-options"
  }
}
```

**Response:**
```json
{
  "id": "msg-4",
  "type": "response",
  "method": "createDocstore",
  "params": {
    "id": "created-docstore-id"
  }
}
```

#### 5. `getDocstore`

Gets a docstore by ID.

**Request:**
```json
{
  "id": "msg-5",
  "type": "request",
  "method": "getDocstore",
  "params": {
    "id": "docstore-id"
  }
}
```

**Response:**
```json
{
  "id": "msg-5",
  "type": "response",
  "method": "getDocstore",
  "params": {
    "docstore": {
      "id": "docstore-id",
      "name": "docstore-name",
      "timestamp": 1628097600,
      "model": "model-name",
      "vector_size": 768,
      "options": "model-options"
    }
  }
}
```

#### 6. `listDocstores`

Lists all docstores.

**Request:**
```json
{
  "id": "msg-6",
  "type": "request",
  "method": "listDocstores",
  "params": {}
}
```

**Response:**
```json
{
  "id": "msg-6",
  "type": "response",
  "method": "listDocstores",
  "params": {
    "docstores": [
      {
        "id": "docstore-id-1",
        "name": "docstore-name-1",
        "timestamp": 1628097600,
        "model": "model-name",
        "vector_size": 768,
        "options": "model-options"
      },
      {
        "id": "docstore-id-2",
        "name": "docstore-name-2",
        "timestamp": 1628097600,
        "model": "model-name",
        "vector_size": 768,
        "options": "model-options"
      }
    ]
  }
}
```

#### 7. `deleteDocstore`

Deletes a docstore by ID.

**Request:**
```json
{
  "id": "msg-7",
  "type": "request",
  "method": "deleteDocstore",
  "params": {
    "id": "docstore-id"
  }
}
```

**Response:**
```json
{
  "id": "msg-7",
  "type": "response",
  "method": "deleteDocstore",
  "params": {
    "success": true
  }
}
```

#### 8. `countDocs`

Counts documents in a docstore.

**Request:**
```json
{
  "id": "msg-8",
  "type": "request",
  "method": "countDocs",
  "params": {
    "docstore_id": "docstore-id"
  }
}
```

**Response:**
```json
{
  "id": "msg-8",
  "type": "response",
  "method": "countDocs",
  "params": {
    "count": 42
  }
}
```

## Subscription Methods

The subscription method allows clients to receive multiple documents over time. This follows a different pattern:

1. Client sends a subscription request
2. Server sends multiple document messages
3. Client sends an end message to terminate the subscription

### `subscribe`

Subscribes to documents in a docstore with filtering options.

**Subscription Request:**
```json
{
  "id": "sub-1",
  "type": "subscription",
  "method": "subscribe",
  "params": {
    "docstore_id": "docstore-id",
    "type": "document-type", // optional
    "since": 1628097600, // optional
    "until": 1628184000 // optional
  }
}
```

**Document Messages (from server):**
```json
{
  "id": "sub-1",
  "type": "document",
  "method": "subscribe",
  "params": {
    "doc": {
      "id": "doc-id-1",
      "docstore_id": "docstore-id",
      "timestamp": 1628097600,
      "created_at": 1628097600,
      "type": "document-type",
      "data": "document-data-1",
      "embeddings": [] // Array of Float32Array embeddings
    }
  }
}
```

**End of Feed Message (from server):**
```json
{
  "id": "sub-1",
  "type": "document",
  "method": "subscribe",
  "params": {
    "eof": true
  }
}
```

**End Subscription Message (from client):**
```json
{
  "id": "sub-1",
  "type": "end",
  "method": "subscribe",
  "params": {}
}
```

## Error Handling

When an error occurs, the server responds with an error message:

```json
{
  "id": "msg-id",
  "type": "response",
  "method": "method-name",
  "error": {
    "code": "error-code",
    "message": "Error message"
  }
}
```

Common error codes:

- `invalid_request`: The request format is invalid
- `method_not_found`: The requested method does not exist
- `invalid_params`: The parameters for the method are invalid
- `docstore_not_found`: The requested docstore does not exist
- `document_not_found`: The requested document does not exist
- `internal_error`: An internal server error occurred

## Binary Data Handling

WebSockets support both text and binary data. For efficiency, embeddings are transmitted as binary data in the following format:

1. The JSON message is sent as text
2. For messages containing embeddings, the embeddings field contains placeholder indices
3. The actual embedding data is sent as separate binary messages
4. The client reconstructs the embeddings using the indices and binary data

This approach reduces the overhead of encoding Float32Array data as JSON strings.

## Client Implementation Notes

1. Clients should maintain a mapping of message IDs to callbacks or promises
2. For subscriptions, clients should maintain a mapping of subscription IDs to handlers
3. Clients should handle reconnection and subscription resumption
4. Clients should implement proper error handling

## Example Client Usage

```javascript
// Connect to the DocStoreSQLite WebSocket server
const client = new DocStoreWebSocketClient('ws://localhost:8080');

// Create a docstore
const docstoreId = await client.createDocstore('my-docstore', 'model-name', 768);

// Upsert a document
await client.upsert({
  id: 'doc-1',
  docstore_id: docstoreId,
  timestamp: Date.now() / 1000,
  created_at: Date.now() / 1000,
  type: 'text',
  data: 'Hello, world!',
  embeddings: []
});

// Get a document
const doc = await client.get(docstoreId, 'doc-1');

// Subscribe to documents
const subscription = client.subscribe({
  docstore_id: docstoreId,
  type: 'text',
  since: Date.now() / 1000 - 3600 // Last hour
}, (doc) => {
  if (doc) {
    console.log('Received document:', doc);
  } else {
    console.log('End of feed');
  }
});

// Later, close the subscription
subscription.close();