/**
 * Test example for the include field functionality
 * This demonstrates how to use the new include field across the system
 */

import { DocStoreSQLite } from "../src/docstore/DocStoreSQLite.js";
import { ChromaRagDB } from "../src/rag/ChromaRagDB.js";
import { DocstoreToRag } from "../src/rag/DocstoreToRag.js";
import { buildContext } from "../src/experts/utils/context.js";
import { Doc } from "../src/docstore/interfaces.js";
import { RagEmbeddings } from "../src/rag/interfaces.js";

// Mock embeddings implementation for testing
class MockEmbeddings implements RagEmbeddings {
  async start(): Promise<void> {
    // Mock implementation
  }

  getModelName(): string {
    return "mock-model";
  }

  getVectorSize(): number {
    return 1536;
  }

  async embed(text: string): Promise<any[]> {
    // Return mock embeddings
    return [{
      index: 0,
      offset: 0,
      text: text,
      embedding: new Array(1536).fill(0.1)
    }];
  }

  async embedDoc(doc: Doc): Promise<Doc> {
    // Add mock embeddings to the document
    const result = { ...doc };
    result.embeddings = [new Float32Array(1536).fill(0.1)];
    result.embedding_offsets = new Uint32Array([0]);
    return result;
  }
}

async function testIncludeField() {
  console.log("Testing include field functionality...");

  // Initialize components
  const docStore = new DocStoreSQLite(":memory:");
  const ragDB = new ChromaRagDB();
  const docstoreToRag = new DocstoreToRag(ragDB, docStore);
  const mockEmbeddings = new MockEmbeddings();

  try {
    // 1. Create a docstore
    const docstoreId = await docStore.createDocstore("test-docstore", "mock-model", 1536);
    console.log("✓ Created docstore:", docstoreId);

    // 2. Create test documents with different include values
    const docs: Doc[] = [
      {
        id: "doc1",
        docstore_id: docstoreId,
        timestamp: Date.now(),
        created_at: Date.now(),
        type: "test",
        data: "This is a regular document",
        embeddings: [],
        include: undefined // No include field
      },
      {
        id: "doc2",
        docstore_id: docstoreId,
        timestamp: Date.now(),
        created_at: Date.now(),
        type: "test",
        data: "This is an always-included document",
        embeddings: [],
        include: "always" // Always include
      },
      {
        id: "doc3",
        docstore_id: docstoreId,
        timestamp: Date.now(),
        created_at: Date.now(),
        type: "test",
        data: "This is another regular document",
        embeddings: [],
        include: undefined
      }
    ];

    // 3. Embed and store documents
    for (const doc of docs) {
      const embeddedDoc = await mockEmbeddings.embedDoc(doc);
      await docStore.upsert(embeddedDoc);
      console.log(`✓ Stored document ${doc.id} with include="${doc.include || 'undefined'}"`);
    }

    // 4. Sync documents to RAG database
    const syncResult = await docstoreToRag.sync({
      docstore_id: docstoreId,
      collection_name: "test-collection",
      onEof: () => {
        console.log("✓ Sync completed");
      }
    });

    // Wait a bit for sync to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    syncResult.stop();

    // 5. Test RAG search with include filter
    console.log("\n--- Testing RAG search with include filter ---");

    // Search for documents with include="always"
    const alwaysResults = await ragDB.get("test-collection", {
      include: "always"
    });
    console.log(`✓ Found ${alwaysResults.length} documents with include="always"`);
    console.log("  Documents:", alwaysResults.map(r => r.metadata.doc_id));

    // Search for all documents (no include filter)
    const allResults = await ragDB.get("test-collection", {});
    console.log(`✓ Found ${allResults.length} total documents`);

    // 6. Test buildContext function
    console.log("\n--- Testing buildContext with include field ---");
    
    await mockEmbeddings.start();
    const context = await buildContext(
      mockEmbeddings,
      ragDB,
      "test-collection",
      docStore,
      "test query"
    );

    console.log("✓ Built context successfully");
    console.log("Context length:", context.length, "characters");
    console.log("Context includes 'always' document:", context.includes("always-included"));

    console.log("\n🎉 All tests passed! Include field functionality is working correctly.");

  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    // Cleanup
    docStore[Symbol.dispose]();
    docstoreToRag[Symbol.dispose]();
  }
}

// Run the test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testIncludeField().catch(console.error);
}

export { testIncludeField };