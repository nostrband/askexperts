import { XenovaEmbeddings, ChromaRagDB, Chunk } from '../src/rag/index.js';

/**
 * Example demonstrating how to use the RAG system.
 */
async function main() {
  try {
    console.log('Initializing RAG components...');
    
    // Initialize the embeddings model
    const embeddings = new XenovaEmbeddings();
    
    // Start the embeddings model
    console.log('Starting embeddings model...');
    await embeddings.start();
    
    // Initialize the RAG database
    const ragDB = new ChromaRagDB();
    
    // Example text to embed
    const text = `
      Retrieval-Augmented Generation (RAG) is a technique that enhances large language models
      by retrieving relevant information from external knowledge sources before generating a response.
      This approach combines the strengths of retrieval-based and generation-based methods,
      allowing models to access up-to-date information and reduce hallucinations.
      
      RAG works by first embedding the query, then searching for similar content in a vector database,
      and finally augmenting the prompt with the retrieved information before generating a response.
    `;
    
    console.log('Embedding text...');
    const chunks: Chunk[] = await embeddings.embed(text);
    console.log(`Text split into ${chunks.length} chunks`);

    // Store the chunks in the database
    console.log('Storing chunks in the database...');
    const collectionName = 'rag-example';
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const vector = chunk.embedding;
      
      if (!vector) {
        console.warn(`No embedding found for chunk ${chunk.index}, skipping`);
        continue;
      }
      
      await ragDB.store(
        collectionName,
        `chunk-${chunk.index}`,
        vector,
        {
          text: chunk.text,
          offset: chunk.offset,
          index: chunk.index
        }
      );
    }
    
    console.log('Chunks stored successfully');
    
    // Example query
    const queryText = 'How does RAG reduce hallucinations?';
    console.log(`\nPerforming query: "${queryText}"`);
    
    // Embed the query
    const queryChunks = await embeddings.embed(queryText);
    const queryVector = queryChunks[0].embedding;
    if (!queryVector) {
      throw new Error('Failed to generate embedding for query');
    }
    
    // Search for similar chunks
    const results = await ragDB.search(collectionName, queryVector, 2);
    
    console.log('\nSearch results:');
    for (const result of results) {
      console.log(`\nID: ${result.id}`);
      console.log(`Distance: ${result.distance}`);
      console.log(`Metadata: ${JSON.stringify(result.metadata)}`);
      console.log(`Text: ${result.metadata.text}`);
    }
    
    console.log('\nRAG example completed successfully');
  } catch (error) {
    console.error('Error in RAG example:', error);
  }
}

// Run the example
main().catch(console.error);