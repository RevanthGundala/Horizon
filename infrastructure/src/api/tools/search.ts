import { tool } from "ai";
import { z } from 'zod';
import { findSimilarContent } from '../utils/embedding';

/**
 * Find relevant content based on a query using vector search
 */
async function findRelevantContent(query: string, userId: string): Promise<string> {
  try {
    // Use vector search to find similar content
    const results = await findSimilarContent(query, userId);
    
    if (!results || results.length === 0) {
      return `No relevant information found for: ${query}`;
    }
    
    // Format the results into a readable response
    let response = `Here's what I found about "${query}":\n\n`;
    
    results.forEach((result, index) => {
      response += `${index + 1}. From page "${result.page_title}":\n`;
      response += `   ${result.content.substring(0, 200)}${result.content.length > 200 ? '...' : ''}\n\n`;
    });
    
    return response;
  } catch (error) {
    console.error('Error in findRelevantContent:', error);
    return `Sorry, I encountered an error while searching for information about: ${query}`;
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
