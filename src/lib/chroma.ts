import { ChromaClient, Collection } from 'chromadb';
import path from 'path';

const COLLECTION_NAME = 'podcast_transcripts';

let client: ChromaClient | null = null;
let collection: Collection | null = null;

export async function getChromaClient(): Promise<ChromaClient> {
  if (!client) {
    // Use persistent local storage (no Docker required)
    const chromaPath = path.join(process.cwd(), 'chroma-data');
    client = new ChromaClient({
      path: chromaPath,
    });
  }
  return client;
}

export async function getCollection(): Promise<Collection> {
  if (!collection) {
    const chromaClient = await getChromaClient();
    collection = await chromaClient.getOrCreateCollection({
      name: COLLECTION_NAME,
      metadata: { 'hnsw:space': 'cosine' },
    });
  }
  return collection;
}

export async function addDocuments(
  ids: string[],
  embeddings: number[][],
  documents: string[],
  metadatas: Record<string, string | number>[]
): Promise<void> {
  const coll = await getCollection();

  const batchSize = 100;
  for (let i = 0; i < ids.length; i += batchSize) {
    await coll.add({
      ids: ids.slice(i, i + batchSize),
      embeddings: embeddings.slice(i, i + batchSize),
      documents: documents.slice(i, i + batchSize),
      metadatas: metadatas.slice(i, i + batchSize),
    });
  }
}

export async function queryDocuments(
  embedding: number[],
  nResults: number = 10
): Promise<{
  ids: string[];
  documents: (string | null)[];
  metadatas: (Record<string, string | number> | null)[];
  distances: number[];
}> {
  const coll = await getCollection();
  const results = await coll.query({
    queryEmbeddings: [embedding],
    nResults,
  });

  return {
    ids: results.ids[0] || [],
    documents: results.documents[0] || [],
    metadatas: (results.metadatas?.[0] || []) as (Record<string, string | number> | null)[],
    distances: results.distances?.[0] || [],
  };
}

export async function deleteCollection(): Promise<void> {
  const chromaClient = await getChromaClient();
  try {
    await chromaClient.deleteCollection({ name: COLLECTION_NAME });
    collection = null;
  } catch (e) {
    // Collection might not exist, that's fine
  }
}
