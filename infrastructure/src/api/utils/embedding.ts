import { embed, embedMany } from 'ai';
import { openai } from '@ai-sdk/openai';
import { Pool } from 'pg';

// Initialize database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const embeddingModel = openai.embedding('text-embedding-ada-002');

const generateChunks = (input: string): string[] => {
  return input
    .trim()
    .split('.')
    .filter(i => i !== '');
};

export const generateEmbeddings = async (
  value: string,
): Promise<Array<{ embedding: number[]; content: string }>> => {
  const chunks = generateChunks(value);
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: chunks,
  });
  return embeddings.map((e, i) => ({ content: chunks[i], embedding: e }));
};

export const generateEmbedding = async (value: string): Promise<number[]> => {
  const input = value.replace(/\n/g, ' ');
  const { embedding } = await embed({
    model: embeddingModel,
    value: input,
  });
  return embedding;
};

/**
 * Store an embedding for a block in the database
 */
export const storeBlockEmbedding = async (
  blockId: string,
  userId: string,
  content: string
): Promise<void> => {
  try {
    console.log(`Generating embedding for block ${blockId}`);
    
    // Generate embedding
    const embedding = await generateEmbedding(content);
    
    // Store in database
    const query = `
      INSERT INTO embeddings (block_id, user_id, embedding)
      VALUES ($1, $2, $3)
      ON CONFLICT (block_id) 
      DO UPDATE SET embedding = $3, created_at = NOW()
    `;
    
    await pool.query(query, [blockId, userId, embedding]);
    console.log(`Successfully stored embedding for block ${blockId}`);
  } catch (error) {
    console.error(`Error storing embedding for block ${blockId}:`, error);
    throw error;
  }
};

/**
 * Process blocks for embedding generation or updates
 * This can be called when blocks are created/updated
 */
export const processBlocksForEmbeddings = async (
  blocks: Array<{ id: string; user_id: string; content: string; type: string }>
): Promise<void> => {
  try {
    console.log(`Processing ${blocks.length} blocks for embeddings`);
    
    // Process each block
    for (const block of blocks) {
      // Skip blocks without meaningful content
      if (!block.content || block.content.trim() === '') {
        console.log(`Skipping block ${block.id} - no content`);
        continue;
      }
      
      // Generate and store embedding
      await storeBlockEmbedding(block.id, block.user_id, block.content);
    }
    
    console.log('Finished processing blocks for embeddings');
  } catch (error) {
    console.error('Error processing blocks for embeddings:', error);
    throw error;
  }
};

/**
 * Find similar content using vector search
 */
export const findSimilarContent = async (
  query: string,
  userId: string,
  limit: number = 5
): Promise<Array<{ block_id: string; content: string; page_id: string; page_title: string; similarity: number }>> => {
  try {
    console.log(`Searching for content similar to: ${query}`);
    
    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);
    
    // Perform vector search
    const searchQuery = `
      SELECT b.id as block_id, b.content, b.page_id, p.title as page_title, 
             1 - (e.embedding <=> $1) as similarity
      FROM embeddings e
      JOIN blocks b ON e.block_id = b.id
      JOIN pages p ON b.page_id = p.id
      WHERE e.user_id = $2
      ORDER BY similarity DESC
      LIMIT $3
    `;
    
    const result = await pool.query(searchQuery, [queryEmbedding, userId, limit]);
    
    console.log(`Found ${result.rows.length} similar blocks`);
    return result.rows;
  } catch (error) {
    console.error('Error finding similar content:', error);
    throw error;
  }
};
