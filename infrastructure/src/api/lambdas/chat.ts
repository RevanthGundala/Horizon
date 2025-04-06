import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { createHeaders } from "./utils/auth-utils";
import { withAuth } from "../middleware/auth";
import { createFireworksStream, streamToString } from "../utils/stream";
import { availableTools, toolRegistry } from "../tools";

// Define the interface for the chat request
interface ChatRequest {
  messages: Array<{
    role: string;
    content: string;
  }>;
  tools?: Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters: Record<string, any>;
    };
  }>;
  stream?: boolean;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

// Define the payload interface to fix TypeScript errors
interface FireworksPayload {
  model: string;
  messages: Array<{
    role: string;
    content: string;
  }>;
  stream: boolean;
  temperature: number;
  max_tokens: number;
  tools?: Array<{
    type: string;
    function: {
      name: string;
      description: string;
      parameters: Record<string, any>;
    };
  }>;
}

/**
 * Chat handler - processes chat requests and streams responses from Fireworks AI
 */
export const chatHandler = withAuth(
  async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: createHeaders(),
        body: '',
      };
    }

    try {
      if (!event.body) {
        return {
          statusCode: 400,
          headers: createHeaders(),
          body: JSON.stringify({ error: "Request body is required" }),
        };
      }

      const requestBody: ChatRequest = JSON.parse(event.body);
      const fireworksApiKey = process.env.FIREWORKS_API_KEY;

      if (!fireworksApiKey) {
        return {
          statusCode: 500,
          headers: createHeaders(),
          body: JSON.stringify({ error: "Fireworks API key is not configured" }),
        };
      }

      // Default model if not specified
      const model = requestBody.model || "accounts/fireworks/models/llama-v3p1-70b-instruct";
      
      // Prepare the request payload for Fireworks AI
      const payload: FireworksPayload = {
        model,
        messages: requestBody.messages,
        stream: requestBody.stream !== undefined ? requestBody.stream : true, // Default to streaming
        temperature: requestBody.temperature || 0.7,
        max_tokens: requestBody.max_tokens || 1000,
      };

      // Add tools if provided in the request or use available tools by default
      if (requestBody.tools && requestBody.tools.length > 0) {
        payload.tools = requestBody.tools;
      } else {
        // Use all available tools by default
        payload.tools = availableTools;
      }

      // If streaming is requested
      if (payload.stream) {
        // Create a stream from the Fireworks API
        const responseStream = createFireworksStream(
          'https://api.fireworks.ai/inference/v1/chat/completions',
          payload,
          fireworksApiKey
        );
        
        // Convert the stream to a string for the Lambda response
        const streamContent = await streamToString(responseStream);
        
        return {
          statusCode: 200,
          headers: {
            ...createHeaders(),
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
          body: streamContent,
          isBase64Encoded: false,
        };
      } else {
        // For non-streaming responses
        const response = await axios.post(
          'https://api.fireworks.ai/inference/v1/chat/completions',
          payload,
          {
            headers: {
              'Authorization': `Bearer ${fireworksApiKey}`,
              'Content-Type': 'application/json',
            },
          }
        );

        return {
          statusCode: 200,
          headers: createHeaders(),
          body: JSON.stringify(response.data),
        };
      }
    } catch (error) {
      console.error("Chat error:", error);
      return {
        statusCode: 500,
        headers: createHeaders(),
        body: JSON.stringify({ error: "Failed to process chat request" }),
      };
    }
  }
);

/**
 * Tool execution handler - processes tool calls from the chat
 */
export const toolExecutionHandler = withAuth(
  async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: createHeaders(),
        body: '',
      };
    }

    try {
      if (!event.body) {
        return {
          statusCode: 400,
          headers: createHeaders(),
          body: JSON.stringify({ error: "Request body is required" }),
        };
      }

      const requestBody = JSON.parse(event.body);
      const { toolName, arguments: toolArgs } = requestBody;

      // Check if the tool exists in the registry
      if (!toolRegistry[toolName]) {
        return {
          statusCode: 400,
          headers: createHeaders(),
          body: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
        };
      }

      // Execute the tool from the registry
      const toolFunction = toolRegistry[toolName];
      
      let result;
      if (toolName === 'get_user_info') {
        // User info tool needs the user ID
        result = await toolFunction(user.id);
      } else if (toolName === 'get_weather') {
        // Weather tool needs the location
        result = await toolFunction(toolArgs.location);
      } else if (toolName === 'search_knowledge_base') {
        // Knowledge base tool needs the query
        result = await toolFunction(toolArgs.query);
      } else {
        // For other tools, pass all arguments
        result = await toolFunction(toolArgs);
      }

      return {
        statusCode: 200,
        headers: createHeaders(),
        body: JSON.stringify({ result }),
      };
    } catch (error) {
      console.error("Tool execution error:", error);
      return {
        statusCode: 500,
        headers: createHeaders(),
        body: JSON.stringify({ error: "Failed to execute tool" }),
      };
    }
  }
);

// Export the API handlers
export const chatApi = {
  chat: chatHandler,
  executeTool: toolExecutionHandler,
};
