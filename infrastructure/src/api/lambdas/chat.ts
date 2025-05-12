import { APIGatewayProxyEvent, Context } from "aws-lambda";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { searchTool, ragSearchTool } from "../tools";
import { getUserId } from "../utils/helpers";

// Define your handler as a separate function first
const streamingChatHandlerInternal = async (
  event: APIGatewayProxyEvent, 
  responseStream: any, 
  context: Context
) => {

  const userId = await getUserId(event.headers.authorization || "");
  if (!userId) {
    console.error("Unauthorized: Invalid token");
    responseStream.end();
    return;
  }
  // Set response content type
  responseStream.setContentType("text/plain");

  // --- Parse request body ---
  if (!event.body) {
    console.log("Error: Request body is required");
    responseStream.end();
    return;
  }
  
  let requestPayloadString = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
    
  let body;
  try {
    body = JSON.parse(requestPayloadString);
  } catch (error) {
    console.log("Error: Invalid JSON in request body");
    responseStream.end();
    return;
  }
  
  const { messages } = body;
  if (!messages || !Array.isArray(messages)) {
    console.log("Error: Messages array is required");
    responseStream.end();
    return;
  }

  // System prompt
  const systemPrompt = `You are an AI assistant that helps users with their notes and documents in the Horizon app. You have access to the user's knowledge base through two powerful tools:
  1. search - Use this to find and list relevant notes and blocks that might answer a question
  2. ragSearch - Use this to get comprehensive context for in-depth questions that need detailed answers
  
  TOOL SELECTION GUIDE:
  - For simple information retrieval or to find specific notes, use the 'search' tool
  - For answering detailed questions or synthesizing information, use the 'ragSearch' tool
  - Always prefer the appropriate tool based on the complexity of the user's query
  - If you don't know which tool to use, ask the user a more clarifying question to help you understand their needs
  
  When using information from the user's notes, always cite your sources so they know where the information came from.`;

  try {
    console.log("[Streaming Chat] Starting AI stream...");
    const result = streamText({
      model: openai("gpt-4o"),
      messages,
      system: systemPrompt,
      tools: {
        search: searchTool({ id: userId }),
        ragSearch: ragSearchTool({ id: userId }),
      },
      onError: ({ error }) => console.error("[Streaming Chat] AI Stream Error Callback:", error),
      onFinish: (data) => console.log("[Streaming Chat] AI Stream Finished Callback. Reason:", data.finishReason),
    });
    let streamedContent = false; 
    // Stream the AI responses directly to the client
    for await (const part of result.fullStream) {
      // Log every part type received for debugging
      // console.log("[Streaming Chat] Stream Part Received:", part.type);

      switch (part.type) {
        case 'text-delta':
          // Write only the text parts to the response stream
          // process.stdout.write(part.textDelta); // Optional: Log chunk to CloudWatch stdout
          responseStream.write(part.textDelta);
          streamedContent = true; // Use the declared variable
          break;

        // ... (rest of the switch cases remain the same) ...
         case 'tool-call':
          console.log(`[Streaming Chat] Tool call requested: ${part.toolName}`, JSON.stringify(part.args));
          break;
        case 'tool-result':
          console.log(`[Streaming Chat] Tool result received for: ${part.toolName}`);
          break;
        case 'error':
          console.error("[Streaming Chat] AI Stream Error Part:", part.error);
          break;
        case 'finish':
          console.log(`[Streaming Chat] AI Stream finished. Reason: ${part.finishReason}, Usage: ${JSON.stringify(part.usage)}`);
          break;
        default:
           console.log("[Streaming Chat] Received unhandled stream part type:", (part as any).type);
      }
    }
     if (!streamedContent) {
      console.log("[Streaming Chat] No text-delta content was streamed.");
      // You might want to send a default message or just close if this happens often
      // responseStream.write("[No text response generated]");
    }

  } catch (error: any) {
    // This catches errors during the setup of streamText or potentially
    // synchronous errors *before* the stream starts iterating.
    console.error("[Streaming Chat] Outer Catch Error (Stream Setup/Sync Error):", error);
    // Ensure stream is closed even if setup fails
    if (!responseStream.writableEnded) {
       try {
         responseStream.write(`\n[SYSTEM ERROR]: ${error.message}\n`);
       } catch (writeError) {
         console.error("Failed to write error to stream", writeError);
       }
    }
  } finally {
      // Ensure the stream is always closed properly
      if (!responseStream.writableEnded) {
          responseStream.end();
      }
    console.log("[Streaming Chat] Stream processing finished, responseStream ended.");
  }
};

// Export the handler wrapped with streamifyResponse
export const streamingChatHandler = awslambda.streamifyResponse(streamingChatHandlerInternal);