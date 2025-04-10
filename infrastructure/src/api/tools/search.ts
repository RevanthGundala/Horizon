import { tool } from "ai";
import { z } from 'zod';
import { searchAll, retrieveContextForRAG } from '../utils/embedding';
import { Pool } from 'pg';

// Initialize database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

/**
 * Find relevant content based on a query using vector search
 */
async function findRelevantContent(query: string, userId: string): Promise<string> {
  try {
    // Get a client from the pool
    const client = await pool.connect();
    
    try {
      // Use vector search to find similar content
      const results = await searchAll(query, userId, { noteLimit: 3, blockLimit: 5 });
      
      if ((!results.notes || results.notes.length === 0) && 
          (!results.blocks || results.blocks.length === 0)) {
        return `No relevant information found for: ${query}`;
      }
      
      // Format the results into a readable response
      let response = `Here's what I found about "${query}":\n\n`;
      
      // Add note results
      if (results.notes && results.notes.length > 0) {
        response += `## Notes:\n`;
        results.notes.forEach((note, index) => {
          response += `${index + 1}. Note: "${note.title}"\n`;
          
          const contentPreview = note.content ? 
            note.content.substring(0, 200) + (note.content.length > 200 ? '...' : '') : 
            '(No content)';
            
          response += `   ${contentPreview}\n\n`;
        });
      }
      
      // Add block results
      if (results.blocks && results.blocks.length > 0) {
        response += `## Blocks:\n`;
        results.blocks.forEach((block, index) => {
          response += `${index + 1}. From note "${block.note_title}":\n`;
          
          const contentPreview = block.content ? 
            block.content.substring(0, 200) + (block.content.length > 200 ? '...' : '') : 
            '(No content)';
            
          response += `   ${contentPreview}\n\n`;
        });
      }
      
      return response;
    } finally {
      // Release client back to pool
      client.release();
    }
  } catch (error) {
    console.error('Error in findRelevantContent:', error);
    return `Sorry, I encountered an error while searching for information about: ${query}`;
  }
}

/**
 * Get comprehensive RAG context for a query to use in answering questions
 */
async function getRAGContext(query: string, userId: string): Promise<string> {
  try {
    // Get a client from the pool
    const client = await pool.connect();
    
    try {
      // Get context and sources from the RAG retrieval
      const { context, sources } = await retrieveContextForRAG(query, userId);
      
      if (!context || context.trim() === '') {
        return `No relevant information found to answer your question about: ${query}`;
      }
      
      // Include sources for transparency
      let response = context;
      
      response += `\n\n## Sources:\n`;
      sources.forEach((source, index) => {
        response += `${index + 1}. ${source.type === 'note' ? 'Note' : 'Block'}: "${source.noteTitle}"\n`;
      });
      
      return response;
    } finally {
      // Release client back to pool
      client.release();
    }
  } catch (error) {
    console.error('Error in getRAGContext:', error);
    return `Sorry, I encountered an error retrieving context for: ${query}`;
  }
}

export const search = (userId: string) => tool({
  description: "Search your knowledge base to find relevant information and answer questions.",
  parameters: z.object({
    query: z.string().describe("The query to search for in your notes and documents"),
  }),
  execute: async ({ query }) => {
    return findRelevantContent(query, userId);
  },
});

export const ragSearch = (userId: string) => tool({
  description: "Get comprehensive context from your knowledge base to answer questions accurately.",
  parameters: z.object({
    query: z.string().describe("The query to search for in your notes and documents"),
  }),
  execute: async ({ query }) => {
    return getRAGContext(query, userId);
  },
});
