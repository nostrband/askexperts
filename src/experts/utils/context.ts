import { debugError, debugExpert } from "../../common/debug.js";
import { RagDB, RagEmbeddings } from "../../rag/interfaces.js";

export async function buildContext(
  ragEmbeddings: RagEmbeddings,
  ragDB: RagDB,
  ragCollectionName: string,
  promptText: string
) {
  try {
    // We will throw this to signal that the expert doesn't
    // have any relevant knowledge and quote should include this error
    const notFound = new Error("Expert has no knowledge on the subject");

    // Check prompt
    if (!promptText) {
      throw notFound;
    }

    // Generate embeddings for all prompt texts sequentially
    const embeddings: number[][] = [];
    // debugExpert("promptText", promptText);

    // Process each text sequentially
    const chunks = await ragEmbeddings!.embed(promptText);

    // Extract embeddings from chunks
    for (const chunk of chunks) {
      embeddings.push(chunk.embedding);
    }

    if (embeddings.length === 0) {
      throw notFound;
    }

    // Take up to 20 most recent chunks
    const recentEmbeddings = embeddings.slice(-20);
    const limit = Math.min(50, Math.ceil(200 / recentEmbeddings.length));

    // Search for similar content in the RAG database using batch search
    const batchResults = await ragDB.searchBatch(
      ragCollectionName,
      recentEmbeddings,
      limit // result per query embedding
    );

    const results = batchResults.flat();
    // Distance comparison is meaningless across chunks
    // .sort((a, b) => a.distance - b.distance);
    if (!results.length) {
      throw notFound;
    }

    debugExpert(
      `Rag search results ${results.length} chunks distance ${
        results[0].distance
      }:${results[results.length - 1].distance}`
    );

    // Newer version with data stored in RAG?
    let context: {
      id: string;
      metadata: string;
      segments: { i: number; c: string }[];
    }[] = [];
    // if (results[0].data) {
    debugExpert(`Rag matching chunks ${results.length}`);

    for (const r of results) {
      const c = context.find((c) => c.id === r.metadata.id);
      if (c) {
        if (!c.segments.find((s) => s.i === r.metadata.chunk))
          c.segments.push({ i: r.metadata.chunk, c: r.data });
      } else {
        context.push({
          id: r.metadata.id,
          metadata: r.metadata.doc_metadata,
          segments: [{ i: r.metadata.chunk, c: r.data }],
        });
      }
    }
    for (const c of context) {
      c.segments.sort((a, b) => a.i - b.i);
    }
    // } else {
    //   // Collect post IDs from all results
    //   const docIds = new Map<string, number>();
    //   for (const result of results) {
    //     if (result.metadata && result.metadata.id) {
    //       const docDistance = Math.min(
    //         result.distance,
    //         docIds.get(result.metadata.id) || result.distance
    //       );
    //       docIds.set(result.metadata.id, docDistance);
    //     }
    //   }

    //   // Find matching posts in profileInfo
    //   const matchingDocs = this.docs
    //     .filter((doc) => docIds.has(doc.id))
    //     .sort((a, b) => docIds.get(b.id)! - docIds.get(a.id)!);
    //   debugExpert(`Rag matchingDocs ${matchingDocs.length}`);

    //   // Nothing?
    //   if (!matchingDocs.length) {
    //     throw notFound;
    //   }

    //   if (matchingDocs.length > MAX_RESULTS)
    //     matchingDocs.length = MAX_RESULTS;

    //   // Remove useless fields, return as string
    //   context = matchingDocs.map((d) => {
    //     return {
    //       id: d.id,
    //       segments: [{ i: 0, c: d.data }],
    //       metadata: d.metadata || "",
    //     };
    //   });
    // }

    const jsonContext = JSON.stringify(context, null, 2);
    debugExpert("jsonContext", jsonContext);
    debugExpert(
      `onGetContext results ${results.length} context ${jsonContext.length} chars`
    );
    return jsonContext;
  } catch (error) {
    debugError("Error generating prompt context:", error);
    throw error;
  }
}
