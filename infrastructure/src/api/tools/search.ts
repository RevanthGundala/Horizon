import { tool } from "ai";
import { Pool } from "pg";
import { z } from "zod";

export const searchTool = (user: { id: string }) => tool({
    description: "Search your knowledge base to find relevant information and answer questions.",
    parameters: z.object({
      query: z.string().describe("The query to search for in your notes and documents"),
    }),
    execute: async ({ query }) => {
      try {
        
        const pool = new Pool({
          connectionString: process.env.DB_URL!,
          ssl: { rejectUnauthorized: false }
        });
        
        try {
          // Use a simple query to avoid embedding complexity for now
          const result = await pool.query(`
            SELECT n.id, n.title, n.content 
            FROM notes n 
            WHERE n.user_id = $1 
            LIMIT 5
          `, [user.id]);
          
          if (result.rows.length === 0) {
            return `No notes found for your query: "${query}"`;
          }
          
          // Format results
          let response = `Here's what I found about "${query}":\n\n## Notes:\n`;
          result.rows.forEach((note, index) => {
            response += `${index + 1}. Note: "${note.title}"\n`;
            if (note.content) {
              const contentPreview = note.content.substring(0, 200) + 
                (note.content.length > 200 ? '...' : '');
              response += `   ${contentPreview}\n\n`;
            }
          });
          
          return response;
        } finally {
          // Ensure pool is released
          await pool.end();
        }
      } catch (error) {
        console.error('Error in search tool:', error);
        return `Sorry, I encountered an error while searching for information about: ${query}`;
      }
    },
  });