import { tool } from "ai";
import { z } from "zod";
import { Pool } from "pg";

export const ragSearchTool = (user: { id: string }) => tool({
    description: "Get comprehensive context from your knowledge base to answer questions accurately.",
    parameters: z.object({
      query: z.string().describe("The query to search for in your notes and documents"),
    }),
    execute: async ({ query }) => {
      try {
        
        const pool = new Pool({
          connectionString: process.env.DATABASE_URL,
          ssl: { rejectUnauthorized: false }
        });
        
        try {
          // Get notes and blocks most relevant to the query
          const result = await pool.query(`
            SELECT n.id, n.title, n.content, 'note' as type
            FROM notes n 
            WHERE n.user_id = $1
            UNION ALL
            SELECT b.id, n.title as note_title, b.content, 'block' as type
            FROM blocks b
            JOIN notes n ON b.note_id = n.id
            WHERE b.user_id = $1
            LIMIT 5
          `, [user.id]);
          
          if (result.rows.length === 0) {
            return `No relevant information found to answer your question about: ${query}`;
          }
          
          // Format context for RAG
          let context = result.rows.map(item => 
            `--- ${item.type === 'note' ? 'Note' : 'Block'} from "${item.title}" ---\n${item.content || ''}\n`
          ).join('\n\n');
          
          // Add sources
          context += `\n\n## Sources:\n`;
          result.rows.forEach((source, index) => {
            context += `${index + 1}. ${source.type === 'note' ? 'Note' : 'Block'}: "${source.title}"\n`;
          });
          
          return context;
        } finally {
          // Ensure pool is released
          await pool.end();
        }
      } catch (error) {
        console.error('Error in RAG search tool:', error);
        return `Sorry, I encountered an error retrieving context for: ${query}`;
      }
    },
  });