# AskExpertsClient for NIP-174

A client implementation for the NIP-174 (Ask Experts) protocol that works in both browser and Node.js environments.

## Features

- Implements the updated NIP-174 protocol
- Works in both browser and Node.js environments
- Supports text and OpenAI formats
- Supports gzip compression (using Compression Streams API in browsers)
- Supports lightning payments
- Fully typed with TypeScript

## Installation

```bash
npm install askexperts
```

## Usage

### Importing the Client

```typescript
// Import the client - it will automatically use the correct build for your platform
import { AskExpertsClient } from 'askexperts/client';
```

### Finding Experts

```typescript
const client = new AskExpertsClient();

// Find experts by publishing an ask event
const bids = await client.findExperts({
  summary: 'What is the meaning of life?',
  hashtags: ['philosophy', 'life'],
  formats: ['text'],
  comprs: ['plain', 'gzip'],
  methods: ['lightning'],
});

console.log(`Found ${bids.length} bids from experts`);
```

### Fetching Expert Profiles

```typescript
// Fetch expert profiles
const expertPubkeys = bids.map(bid => bid.pubkey);
const experts = await client.fetchExperts({
  pubkeys: expertPubkeys,
});

console.log(`Fetched ${experts.length} expert profiles`);
```

### Asking an Expert

```typescript
// Define the onQuote callback to handle payment
const onQuote = async (quote) => {
  console.log('Received quote from expert');
  
  if (quote.error) {
    return { error: 'Cannot proceed due to expert error' };
  }
  
  const invoice = quote.invoices[0];
  console.log(`Amount: ${invoice.amount} ${invoice.unit}`);
  
  // Pay the invoice and get the preimage
  const preimage = await payInvoice(invoice.invoice);
  
  return {
    method: 'lightning',
    preimage,
  };
};

// Ask a question to an expert
const replies = await client.askExpert({
  expert: experts[0],
  content: 'What is the meaning of life?',
  format: 'text',
  compr: 'plain',
  onQuote,
});

// Process the replies
for await (const reply of replies) {
  console.log('Received reply:', reply.content);
  
  if (reply.done) {
    console.log('This is the final reply');
  }
}
```

## API Reference

### `AskExpertsClient`

The main client class for interacting with the NIP-174 protocol.

#### Methods

##### `findExperts(params: FindExpertsParams): Promise<Bid[]>`

Finds experts by publishing an ask event and collecting bids.

Parameters:
- `summary`: Summary of the question (public, anonymized)
- `hashtags`: Hashtags for discovery
- `formats?`: Accepted prompt formats (optional)
- `comprs?`: Accepted compression methods (optional)
- `methods?`: Accepted payment methods (optional)
- `relays?`: Discovery relays to use (optional)

Returns: Promise resolving to array of Bid objects

##### `fetchExperts(params: FetchExpertsParams): Promise<Expert[]>`

Fetches expert profiles from relays.

Parameters:
- `pubkeys`: Expert public keys to fetch
- `relays?`: Discovery relays to use (optional)

Returns: Promise resolving to array of Expert objects

##### `askExpert(params: AskExpertParams): Promise<Replies>`

Asks an expert a question and receives replies.

Parameters:
- `expert?`: Expert to ask (either expert or bid must be provided)
- `bid?`: Bid to use (either expert or bid must be provided)
- `content`: Content of the prompt
- `format?`: Format of the prompt (must be supported by expert/bid)
- `compr?`: Compression method to use (must be supported by expert/bid)
- `onQuote`: Callback function called when a quote is received

Returns: Promise resolving to Replies object (AsyncIterable yielding Reply objects)

## Types

### `FindExpertsParams`

Parameters for finding experts.

```typescript
interface FindExpertsParams {
  summary: string;
  hashtags: string[];
  formats?: PromptFormat[];
  comprs?: CompressionMethod[];
  methods?: PaymentMethod[];
  relays?: string[];
}
```

### `FetchExpertsParams`

Parameters for fetching expert profiles.

```typescript
interface FetchExpertsParams {
  pubkeys: string[];
  relays?: string[];
}
```

### `AskExpertParams`

Parameters for asking an expert.

```typescript
interface AskExpertParams {
  expert?: Expert;
  bid?: Bid;
  content: any;
  format?: PromptFormat;
  compr?: CompressionMethod;
  onQuote: (quote: Quote) => Promise<Proof>;
}
```

### `Bid`

Bid structure representing an expert's offer.

```typescript
interface Bid {
  pubkey: string;
  id: string;
  payloadId: string;
  offer: string;
  relays: string[];
  formats: PromptFormat[];
  compressions: CompressionMethod[];
  methods: PaymentMethod[];
  event: Event;
  payloadEvent: Event;
}
```

### `Expert`

Expert profile structure.

```typescript
interface Expert {
  pubkey: string;
  description: string;
  relays: string[];
  formats: PromptFormat[];
  compressions: CompressionMethod[];
  methods: PaymentMethod[];
  hashtags: string[];
  event: Event;
}
```

### `Quote`

Quote structure representing an expert's price quote.

```typescript
interface Quote {
  pubkey: string;
  promptId: string;
  error?: string;
  invoices?: Invoice[];
  event: Event;
}
```

### `Proof`

Proof structure for payment verification.

```typescript
interface Proof {
  error?: string;
  method?: PaymentMethod;
  preimage?: string;
}
```

### `Reply`

Reply structure representing an expert's response.

```typescript
interface Reply {
  pubkey: string;
  promptId: string;
  error?: string;
  done: boolean;
  content?: any;
  event: Event;
}
```

### `Replies`

Replies object that is AsyncIterable and yields Reply objects.

```typescript
interface Replies extends AsyncIterable<Reply> {
  promptId: string;
  expertPubkey: string;
}
```

## Constants

- `FORMAT_TEXT`: Text format
- `FORMAT_OPENAI`: OpenAI format
- `COMPRESSION_PLAIN`: No compression
- `COMPRESSION_GZIP`: Gzip compression
- `METHOD_LIGHTNING`: Lightning Network payment method
- `DEFAULT_DISCOVERY_RELAYS`: Default relays for discovery

## License

MIT