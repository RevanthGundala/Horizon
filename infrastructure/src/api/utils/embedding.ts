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

// Use the newer embedding model for better quality
const embeddingModel = openai.embedding('text-embedding-3-small');

/**
 * Generate embeddings for chunks of text
 */
export const generateEmbeddings = async (
  value: string,
): Promise<Array<{ embedding: number[]; content: string }>> => {
  // Improved chunking strategy - split by paragraphs for more meaningful chunks
  const chunks = value
    .split(/\n\s*\n/)
    .map(chunk => chunk.trim())
    .filter(chunk => chunk.length > 0);
  
  // Handle empty input
  if (chunks.length === 0) {
    chunks.push(value.trim());
  }
  
  // Generate embeddings for all chunks
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: chunks,
  });
  
  return embeddings.map((e, i) => ({ content: chunks[i], embedding: e }));
};

/**
 * Generate a single embedding for text
 */
export const generateEmbedding = async (value: string): Promise<number[]> => {
  const input = value.replace(/\n/g, ' ').trim();
  
  if (!input) {
    throw new Error('Cannot generate embedding for empty text');
  }
  
  const { embedding } = await embed({
    model: embeddingModel,
    value: input,
  });
  
  return embedding;
};

/**
 * Store an embedding for a note in the database
 */
export const storeNoteEmbedding = async (
  noteId: string,
  userId: string,
  title: string,
  content: string = ''
): Promise<void> => {
  try {
    console.log(`Generating embedding for note ${noteId}`);
    
    // Combine title and content for richer embedding context
    const textToEmbed = `${title}\n\n${content}`.trim();
    
    if (!textToEmbed) {
      console.log(`Skipping note ${noteId} - no content to embed`);
      return;
    }
    
    // Generate embedding
    const embedding = await generateEmbedding(textToEmbed);
    
    // Store in database
    const query = `
      INSERT INTO note_embeddings (note_id, embedding)
      VALUES ($1, $2)
      ON CONFLICT (note_id) 
      DO UPDATE SET embedding = $2, updated_at = NOW()
    `;
    
    await pool.query(query, [noteId, embedding]);
    console.log(`Successfully stored embedding for note ${noteId}`);
  } catch (error) {
    console.error(`Error storing embedding for note ${noteId}:`, error);
    throw error;
  }
};

/**
 * Store an embedding for a block in the database
 */
export const storeBlockEmbedding = async (
  blockId: string,
  content: string
): Promise<void> => {
  try {
    console.log(`Generating embedding for block ${blockId}`);
    
    if (!content || content.trim() === '') {
      console.log(`Skipping block ${blockId} - no content`);
      return;
    }
    
    // Generate embedding
    const embedding = await generateEmbedding(content);
    
    // Store in database
    const query = `
      INSERT INTO block_embeddings (block_id, embedding)
      VALUES ($1, $2)
      ON CONFLICT (block_id) 
      DO UPDATE SET embedding = $2, updated_at = NOW()
    `;
    
    await pool.query(query, [blockId, embedding]);
    console.log(`Successfully stored embedding for block ${blockId}`);
  } catch (error) {
    console.error(`Error storing embedding for block ${blockId}:`, error);
    throw error;
  }
};

/**
 * Process notes for embedding generation or updates
 */
export const processNotesForEmbeddings = async (
  notes: Array<{ id: string; title: string; content?: string; user_id: string }>
): Promise<void> => {
  try {
    console.log(`Processing ${notes.length} notes for embeddings`);
    
    for (const note of notes) {
      await storeNoteEmbedding(note.id, note.user_id, note.title, note.content);
    }
    
    console.log('Finished processing notes for embeddings');
  } catch (error) {
    console.error('Error processing notes for embeddings:', error);
    throw error;
  }
};

/**
 * Process blocks for embedding generation or updates
 */
export const processBlocksForEmbeddings = async (
  blocks: Array<{ id: string; content: string; type: string }>
): Promise<void> => {
  try {
    console.log(`Processing ${blocks.length} blocks for embeddings`);
    
    // Only process blocks with meaningful text content
    const textBlocks = blocks.filter(block => {
      // Skip blocks without content
      if (!block.content || block.content.trim() === '') return false;
      
      // Include all blocks with text content
      return block.type === 'text' || block.type === 'editor' || 
             block.type === 'heading' || block.type === 'paragraph' ||
             block.content.length > 10;
    });
    
    console.log(`Found ${textBlocks.length} blocks with text content to process`);
    
    // Process each block
    for (const block of textBlocks) {
      await storeBlockEmbedding(block.id, block.content);
    }
    
    console.log('Finished processing blocks for embeddings');
  } catch (error) {
    console.error('Error processing blocks for embeddings:', error);
    throw error;
  }
};

/**
 * Search for similar notes using vector search
 */
export const searchNotes = async (
  query: string,
  userId: string,
  limit: number = 5
): Promise<Array<{
  note_id: string;
  title: string;
  content: string;
  workspace_id: string;
  similarity: number;
}>> => {
  try {
    console.log(`Searching for notes similar to: ${query}`);
    
    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);
    
    // Perform vector search against note embeddings
    const searchQuery = `
      SELECT 
        n.id as note_id, 
        n.title, 
        n.content,
        n.workspace_id,
        1 - (ne.embedding <=> $1) as similarity
      FROM 
        notes n
      JOIN 
        note_embeddings ne ON n.id = ne.note_id
      WHERE 
        n.user_id = $2
      ORDER BY 
        similarity DESC
      LIMIT $3
    `;
    
    const result = await pool.query(searchQuery, [queryEmbedding, userId, limit]);
    console.log(`Found ${result.rows.length} similar notes`);
    
    return result.rows;
  } catch (error) {
    console.error('Error searching notes:', error);
    throw error;
  }
};

/**
 * Search for similar blocks using vector search
 */
export const searchBlocks = async (
  query: string,
  userId: string,
  limit: number = 10
): Promise<Array<{
  block_id: string;
  content: string;
  note_id: string; 
  note_title: string;
  workspace_id: string;
  similarity: number;
}>> => {
  try {
    console.log(`Searching for blocks similar to: ${query}`);
    
    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);
    
    // Perform vector search against block embeddings
    const searchQuery = `
      SELECT 
        b.id as block_id, 
        b.content,
        b.note_id,
        n.title as note_title,
        n.workspace_id,
        1 - (be.embedding <=> $1) as similarity
      FROM 
        blocks b
      JOIN 
        block_embeddings be ON b.id = be.block_id
      JOIN
        notes n ON b.note_id = n.id
      WHERE 
        b.user_id = $2
      ORDER BY 
        similarity DESC
      LIMIT $3
    `;
    
    const result = await pool.query(searchQuery, [queryEmbedding, userId, limit]);
    console.log(`Found ${result.rows.length} similar blocks`);
    
    return result.rows;
  } catch (error) {
    console.error('Error searching blocks:', error);
    throw error;
  }
};

/**
 * Combined search across notes and blocks
 */
export const searchAll = async (
  query: string,
  userId: string,
  options: { noteLimit?: number; blockLimit?: number } = {}
): Promise<{
  notes: any[];
  blocks: any[];
}> => {
  try {
    console.log(`Performing combined search for: ${query}`);
    
    const { noteLimit = 3, blockLimit = 7 } = options;
    
    // Run searches in parallel for better performance
    const [noteResults, blockResults] = await Promise.all([
      searchNotes(query, userId, noteLimit),
      searchBlocks(query, userId, blockLimit)
    ]);
    
    return {
      notes: noteResults,
      blocks: blockResults
    };
  } catch (error) {
    console.error('Error in combined search:', error);
    throw error;
  }
};

/**
 * Retrieve context for RAG from top search results
 */
export const retrieveContextForRAG = async (
  query: string,
  userId: string
): Promise<{ context: string; sources: any[] }> => {
  try {
    console.log(`Retrieving RAG context for query: ${query}`);
    
    // Get search results from both notes and blocks
    const searchResults = await searchAll(query, userId);
    
    // Combine and rank results by similarity
    const allResults = [
      ...searchResults.notes.map(note => ({
        ...note,
        type: 'note',
        id: note.note_id,
        title: note.title,
        content: `# ${note.title}\n\n${note.content || ''}`.trim(),
      })),
      ...searchResults.blocks.map(block => ({
        ...block,
        type: 'block',
        id: block.block_id,
        title: block.note_title,
        content: block.content || '',
      }))
    ].sort((a, b) => b.similarity - a.similarity);
    
    // Take top results (limit to reasonable token count)
    const topResults = allResults.slice(0, 5);
    
    // Format context for RAG with clear section boundaries
    const context = topResults.map(item => 
      `--- ${item.type === 'note' ? 'Note' : 'Block'} from "${item.title}" ---\n${item.content}\n`
    ).join('\n\n');
    
    // Create source references for attribution
    const sources = topResults.map(item => ({
      id: item.id,
      type: item.type,
      noteId: item.type === 'note' ? item.id : item.note_id,
      noteTitle: item.title,
      similarity: item.similarity,
      workspaceId: item.workspace_id
    }));
    
    return { context, sources };
  } catch (error) {
    console.error('Error retrieving context for RAG:', error);
    throw error;
  }
};
