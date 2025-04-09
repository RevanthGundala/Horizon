import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { createHeaders, handleOptions, withAuth } from "../utils/middleware";
import { streamText } from "ai"
import { openai } from "@ai-sdk/openai"
import { search } from "../tools";

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
    const systemPrompt = `You are an AI assistant that helps users with their notes and documents.
You have access to the user's knowledge base through the search tool.
When answering questions, try to use the search tool to find relevant information.`;

    try {
      // Stream the response using the AI SDK
      const result = await streamText({
        model: openai("gpt-4o-mini"),
        messages,
        system: systemPrompt,
        tools: {
          search: search(user.id),
        },
      });

      // Get the streaming response
      const streamResponse = result.toDataStreamResponse();
      
      // Extract headers from the Response object
      const headers = Object.fromEntries(streamResponse.headers.entries());
      
      // Get origin for CORS headers
      const origin = event.headers.origin || event.headers.Origin;
      
      // Return the response in a format compatible with AWS Lambda
      return {
        statusCode: streamResponse.status,
        headers: {
          // Important: Set the correct content type for streaming
          'Content-Type': 'text/event-stream',
          // Add CORS headers
          'Access-Control-Allow-Origin': origin || process.env.FRONTEND_URL || 'http://localhost:5173',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token, Cookie',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Expose-Headers': 'Content-Type, Content-Length',
          // Streaming specific headers
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
          ...headers
        },
        // Use the ReadableStream directly
        body: await new Response(streamResponse.body).text(),
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
