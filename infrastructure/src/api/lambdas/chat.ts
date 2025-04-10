import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { createHeaders, handleOptions, withAuth } from "../utils/middleware";
import { streamText } from "ai"
import { openai } from "@ai-sdk/openai"
import { search, ragSearch } from "../tools";
import { v4 as uuidv4 } from 'uuid';

const chatHandler = async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
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

    const body = JSON.parse(event.body);
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return {
        statusCode: 400,
        headers: createHeaders(event.headers.origin || event.headers.Origin),
        body: JSON.stringify({ error: 'Messages array is required' })
      };
    }

    // System prompt for the AI
    const systemPrompt = `You are an AI assistant that helps users with their notes and documents in the Horizon app.
You have access to the user's knowledge base through two powerful tools:
1. search - Use this to find and list relevant notes and blocks that might answer a question
2. ragSearch - Use this to get comprehensive context for in-depth questions that need detailed answers

TOOL SELECTION GUIDE:
- For simple information retrieval or to find specific notes, use the 'search' tool
- For answering detailed questions or synthesizing information, use the 'ragSearch' tool
- Always prefer the appropriate tool based on the complexity of the user's query

When using information from the user's notes, always cite your sources so they know where the information came from.`;

    try {
      // Stream the response using the AI SDK
      const result = streamText({
        model: openai("gpt-4o"), // Using higher quality model for better RAG capabilities
        messages,
        system: systemPrompt,
        tools: {
          search: search(user.id),
          ragSearch: ragSearch(user.id),
        },
      });

      // Get the streaming response
      const streamResponse = result.toDataStreamResponse();
      
      // Extract headers from the Response object
      const headers = Object.fromEntries(streamResponse.headers.entries());
      
      // Get origin for CORS headers
      const origin = event.headers.origin || event.headers.Origin;
      
      // Return response with streaming indicator
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin || process.env.FRONTEND_URL || 'http://localhost:5173',
          ...headers
        },
        body: JSON.stringify({
          stream: true,
          streamUrl: `/chat/stream/${uuidv4()}` // Generate unique stream URL
        }),
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

// Export the handler with authentication middleware
const chat = withAuth(chatHandler);

// Export the API handlers
export const chatApi = {
  chat,
};

// Also export the handler directly for local development
export const handler = chat;
