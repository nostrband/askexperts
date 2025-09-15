import { INCLUDE_ALWAYS } from "../../common/constants.js";
import { debugError, debugExpert } from "../../common/debug.js";
import { Doc, DocStoreClient } from "../../docstore/interfaces.js";
import { RagDB, RagEmbeddings } from "../../rag/interfaces.js";

export async function buildContext(
  ragEmbeddings: RagEmbeddings,
  ragDB: RagDB,
  ragCollectionName: string,
  docstoreClient: DocStoreClient,
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

    const docIds = new Map<string, Set<string>>();
    const relatedDocIds = new Map<string, Set<string>>();
    const add = (
      ids: Map<string, Set<string>>,
      docstore_id: string,
      id: string
    ) => {
      if (!ids.has(docstore_id)) ids.set(docstore_id, new Set());
      ids.get(docstore_id)!.add(id);
    };

    for (const r of results) {
      add(docIds, r.metadata.docstore_id, r.metadata.doc_id);
      // collect related docs
      if (r.metadata.doc_related_ids) {
        const ids = JSON.parse(r.metadata.doc_related_ids);
        for (const id of ids) add(relatedDocIds, r.metadata.docstore_id, id);
      }
    }

    // Markdown context, for each document:
    //
    // =============================
    // # doc: {docstore_id}:{id}
    // ## metadata
    // {doc.metadata}
    // ## content
    // {doc.content}
    let context = "";

    // Keep track of which documents have been printed to avoid duplicates
    const docs: Doc[] = [];
    const printedDocs = new Map<string, Set<string>>();

    // Process each docstore and its documents
    for (const [docstore_id, docIdsSet] of docIds.entries()) {
      // Get related doc IDs for this docstore
      const relatedIdsSet = relatedDocIds.get(docstore_id) || new Set<string>();

      // Fetch docs with include="always" for this docstore
      const alwaysResults = await ragDB.get(ragCollectionName, {
        include: INCLUDE_ALWAYS
      });
      
      // Add the doc IDs of "always" docs to the set
      const alwaysDocIds = new Set<string>();
      for (const result of alwaysResults) {
        if (result.metadata.docstore_id === docstore_id) {
          alwaysDocIds.add(result.metadata.doc_id);
        }
      }

      // Merge IDs from all sets to create a unified list of documents to fetch
      const allIds = new Set<string>([...docIdsSet, ...relatedIdsSet, ...alwaysDocIds]);
      const idsList = Array.from(allIds);

      // Skip if there are no documents to fetch
      if (idsList.length === 0) {
        continue;
      }

      // Fetch all documents for this docstore
      const docstoreDocs = await docstoreClient.listDocsByIds(
        docstore_id,
        idsList
      );

      debugExpert(
        `Fetched ${docstoreDocs.length} documents from docstore ${docstore_id}`
      );

      // Put to global list
      docs.push(...docstoreDocs);

      // Initialize tracking set for this docstore if not exists
      printedDocs.set(docstore_id, new Set<string>());
    }

    // Process each result to add relevant documents to the context
    for (const r of results) {
      const did = r.metadata.doc_id;
      const dsid = r.metadata.docstore_id;

      // Skip if already printed
      if (printedDocs.get(dsid)!.has(did)) {
        continue;
      }

      const print = (doc: Doc) => {
        // Mark as printed
        printedDocs.get(doc.docstore_id)!.add(doc.id);

        // Add to context
        context += "=============================\n";
        context += `# doc: ${dsid}:${did}\n`;
        context += "## metadata\n";
        context += `${doc.metadata || ""}\n`;
        context += "## content\n";
        context += `${doc.data || ""}\n\n`;
      };

      // Find the document in the fetched docs
      const doc = docs.find((d) => d.id === did && d.docstore_id === dsid);
      if (!doc) continue;

      print(doc);

      // Process related documents if available
      if (r.metadata.doc_related_ids) {
        try {
          const relatedIds = JSON.parse(r.metadata.doc_related_ids);
          for (const relatedId of relatedIds) {
            // Skip if already printed
            if (printedDocs.get(dsid)!.has(relatedId)) {
              continue;
            }

            // Find the related document
            const relatedDoc = docs.find(
              (d) => d.id === relatedId && d.docstore_id === dsid
            );
            if (!relatedDoc) continue;

            print(relatedDoc);
          }
        } catch (parseError) {
          debugError("Error parsing related doc IDs:", parseError);
        }
      }
    }

    // If no context was built, throw not found
    if (!context) {
      throw notFound;
    }

    debugExpert(
      `onGetContext results ${results.length} context ${context.length} chars`
    );
    return context;

    // // Newer version with data stored in RAG?
    // let context: {
    //   id: string;
    //   metadata: string;
    //   segments: { i: number; c: string }[];
    // }[] = [];
    // // if (results[0].data) {

    // for (const r of results) {
    //   // add segment to context
    //   const c = context.find((c) => c.id === r.metadata.doc_id);
    //   if (c) {
    //     if (!c.segments.find((s) => s.i === r.metadata.chunk))
    //       c.segments.push({ i: r.metadata.chunk, c: r.data });
    //   } else {
    //     context.push({
    //       id: r.metadata.doc_id,
    //       metadata: r.metadata.doc_metadata,
    //       segments: [{ i: r.metadata.chunk, c: r.data }],
    //     });
    //   }
    // }

    // // Search related docs

    // // Sort segments by index
    // for (const c of context) {
    //   c.segments.sort((a, b) => a.i - b.i);
    // }

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

    // const jsonContext = JSON.stringify(context, null, 2);
    // debugExpert("jsonContext", jsonContext);
    // debugExpert(
    //   `onGetContext results ${results.length} context ${jsonContext.length} chars`
    // );
    // return jsonContext;
  } catch (error) {
    debugError("Error generating prompt context:", error);
    throw error;
  }
}
