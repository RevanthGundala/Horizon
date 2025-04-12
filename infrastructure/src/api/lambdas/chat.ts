import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { createHeaders, handleOptions, parseCookies, withAuth } from "../utils/middleware";
import { streamText } from "ai"
import { openai } from "@ai-sdk/openai"
import { tool } from "ai";
import { z } from 'zod';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

// Define search functions within the handler to avoid closure issues
const chatHandler = async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
  // Add detailed logging for debugging
  
  console.log('🔍 User object:', JSON.stringify(user));
  
  // Handle OPTIONS requests for CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return await handleOptions(event);
  }

  try {
    // Parse the request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers: createHeaders(event.headers.origin || event.headers.Origin),
        body: JSON.stringify({ error: 'Request body is required' })
      };
    }
    let requestPayloadString: string;
    if (event.isBase64Encoded) {
        console.log('🔍 Decoding Base64 body...');
        // Decode the base64 string
        requestPayloadString = Buffer.from(event.body, 'base64').toString('utf8');
        console.log('🔍 Decoded body:', requestPayloadString);
    } else {
        // Use the body directly if it's not encoded
        requestPayloadString = event.body;
    }

    // Parse the potentially decoded string
    const body = JSON.parse(requestPayloadString); 
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return {
        statusCode: 400,
        headers: createHeaders(event.headers.origin || event.headers.Origin),
        body: JSON.stringify({ error: 'Messages array is required' })
      };
    }
    
    // Check if user is anonymous (no authentication)
    const isAnonymous = user.id === "anonymous";

    // System prompt for the AI
    let systemPrompt = `You are an AI assistant that helps users with their notes and documents in the Horizon app.`;
    
    // Add different instructions based on authentication status
    if (isAnonymous) {
      systemPrompt += `\nYou are currently in demo mode because the user is not authenticated.
      You can still help with general questions, but you don't have access to the user's notes or documents.`;
    } else {
      systemPrompt += `\nYou have access to the user's knowledge base through two powerful tools:
      1. search - Use this to find and list relevant notes and blocks that might answer a question
      2. ragSearch - Use this to get comprehensive context for in-depth questions that need detailed answers
      
      TOOL SELECTION GUIDE:
      - For simple information retrieval or to find specific notes, use the 'search' tool
      - For answering detailed questions or synthesizing information, use the 'ragSearch' tool
      - Always prefer the appropriate tool based on the complexity of the user's query
      
      When using information from the user's notes, always cite your sources so they know where the information came from.`;
    }

    // Define search tools directly within handler scope
    // Create a new pool for each request to avoid closure issues with the Pool object
    const searchTool = tool({
      description: "Search your knowledge base to find relevant information and answer questions.",
      parameters: z.object({
        query: z.string().describe("The query to search for in your notes and documents"),
      }),
      execute: async ({ query }) => {
        try {
          if (isAnonymous) {
            return "Sorry, this feature is only available to authenticated users. Please sign in to access your notes.";
          }
          
          const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
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
    
    const ragSearchTool = tool({
      description: "Get comprehensive context from your knowledge base to answer questions accurately.",
      parameters: z.object({
        query: z.string().describe("The query to search for in your notes and documents"),
      }),
      execute: async ({ query }) => {
        try {
          if (isAnonymous) {
            return "Sorry, this feature is only available to authenticated users. Please sign in to access your notes.";
          }
          
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

    try {
      // Stream the response using the AI SDK
      const result = streamText({
        model: openai("gpt-4o"), // Using higher quality model for better RAG capabilities
        messages,
        system: systemPrompt,
        tools: isAnonymous ? {} : {
          search: searchTool,
          ragSearch: ragSearchTool,
        },
      });

      // Get the streaming response
      const streamResponse = result.toDataStreamResponse();

      if (!streamResponse.body) {
        return {
          statusCode: 500,
          headers: createHeaders(event.headers.origin || event.headers.Origin),
          body: JSON.stringify({ error: 'Failed to stream response' })
        };
      }
      
      // Get origin for CORS headers
      const origin = event.headers.origin || event.headers.Origin;
      
      // Read the stream and return content directly
      const chunks = [];
      for await (const chunk of streamResponse.body) {
        chunks.push(chunk);
      }
      
      // Combine all chunks into a response
      const responseText = Buffer.concat(chunks).toString('utf-8');
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': origin || process.env.FRONTEND_URL || 'http://localhost:5173',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Credentials': 'true'
        },
        body: responseText,
        isBase64Encoded: false
      };
    } catch (streamError) {
      console.error('Streaming error:', streamError);
      return {
        statusCode: 500,
        headers: createHeaders(event.headers.origin || event.headers.Origin),
        body: JSON.stringify({ error: 'Streaming error', details: String(streamError) })
      };
    }
  } catch (error) {
    console.error('Error in chat handler:', error);
    return {
      statusCode: 500,
      headers: createHeaders(event.headers.origin || event.headers.Origin),
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};

// Export the API handlers
export const chatApi = {
  chat: withAuth(chatHandler),
};

// Export the handler directly for local development
export const handler = chatHandler;
