import { APIGatewayProxyEvent, Context } from "aws-lambda"; // Context might be needed
import { Writable } from "stream"; // For the response stream type
import { createHeaders, parseCookies, isAuthSuccess /*, Your DB/other utils */ } from "../utils/middleware"; // Adjust path
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { WorkOS, User } from "@workos-inc/node";
import { searchTool, ragSearchTool } from "../tools";

// --- Streaming Chat Handler ---
const streamingChatHandler = async (
  event: APIGatewayProxyEvent,
  responseStream: Writable, // This is the stream Lambda provides
  context: Context
) => {

  // --- Manual Authentication (Replace/Adapt Middleware) ---
  // This section needs to be robust or replaced by a proper stream-compatible middleware
  let user: User | null = null;
  try {
    console.log("[Streaming Chat] Attempting authentication...");
    const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
    const sessionData = cookies["wos-session"];

    if (!sessionData) {
      throw new Error("No session cookie found");
    }

    const workos = new WorkOS(process.env.WORKOS_API_KEY || "", { clientId: process.env.WORKOS_CLIENT_ID || "" });
    const session = workos.userManagement.loadSealedSession({
      sessionData,
      cookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
    });
    const authResult = await session.authenticate(); // TODO: Add refresh logic if needed

    if (!isAuthSuccess(authResult)) {
      throw new Error("WorkOS authentication failed");
    }
    
    // Type guard to ensure we have a successful authentication response
    if ('user' in authResult) {
      user = authResult.user as User;
      console.log(`[Streaming Chat] User authenticated via cookie: ${user.id}`);
    } else {
      throw new Error("Invalid authentication response");
    }

  } catch (authError: any) {
    console.error("[Streaming Chat] Authentication Error:", authError.message);
    // Before sending headers, we can send a proper error response
    // Write standard HTTP response headers and body for error
    responseStream.write(JSON.stringify({ // AWS specific preamble for errors before body stream
      statusCode: 401,
      headers: createHeaders(event.headers.origin || event.headers.Origin) // Use your CORS headers
    }));
    responseStream.write(Buffer.alloc(0)); // Delimiter
    responseStream.write(JSON.stringify({ error: "Authentication required", details: authError.message }));
    responseStream.end();
    return; // Stop execution
  }
  // --- End Manual Authentication ---

  // Ensure user is authenticated before proceeding
  if (!user) {
    responseStream.write(JSON.stringify({ 
      statusCode: 401, 
      body: JSON.stringify({ error: "User not authenticated" }) 
    }));
    responseStream.end();
    return;
  }
  // --- Write HTTP Headers (Mandatory Preamble for Streaming) ---
  // Define headers *before* any body content is written
  const httpPreamble = {
    statusCode: 200,
    headers: {
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      // Use createHeaders to include necessary CORS headers
      ...createHeaders(event.headers.origin || event.headers.Origin),
      "Content-Type": "text/plain; charset=utf-8", // Streaming plain text chunks
    }
  };
  // AWS requires writing metadata before the response body
  responseStream.write(Buffer.from(JSON.stringify(httpPreamble)));
  responseStream.write(Buffer.alloc(0)); // Empty chunk delimiter
  console.log("[Streaming Chat] HTTP headers written to response stream.");
  // --- End Headers ---


  // --- Start Main Handler Logic ---
  // --- Body Parsing (same as before) ---
  if (!event.body) throw new Error("Request body is required");
  let requestPayloadString = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  const body = JSON.parse(requestPayloadString);
  const { messages } = body;
  if (!messages || !Array.isArray(messages)) throw new Error("Messages array is required");
  // --- End Body Parsing ---


  // System prompt for the AI
  const systemPrompt = `You are an AI assistant that helps users with their notes and documents in the Horizon app. You have access to the user's knowledge base through two powerful tools:
  1. search - Use this to find and list relevant notes and blocks that might answer a question
  2. ragSearch - Use this to get comprehensive context for in-depth questions that need detailed answers
  
  TOOL SELECTION GUIDE:
  - For simple information retrieval or to find specific notes, use the 'search' tool
  - For answering detailed questions or synthesizing information, use the 'ragSearch' tool
  - Always prefer the appropriate tool based on the complexity of the user's query
  
  When using information from the user's notes, always cite your sources so they know where the information came from.`;

  try {
    if (!event.body) throw new Error("Request body is required");
    let requestPayloadString = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
    const body = JSON.parse(requestPayloadString);
    // *** Use CoreMessage type from 'ai' SDK for messages ***
    const { messages } = body;
    if (!messages || !Array.isArray(messages)) throw new Error("Messages array is required");
    // --- End Body Parsing ---

  // --- AI SDK Streaming Call ---
  console.log("[Streaming Chat] Calling streamText...");
  const result = streamText({
    model: openai("gpt-4o"), // Using higher quality model for better RAG capabilities
    messages,
    system: systemPrompt,
    tools: {
      search: searchTool(user),
      ragSearch: ragSearchTool(user),
    },
  }); 
  console.log("[Streaming Chat] streamText call returned. Processing stream...");
  // --- End AI SDK Streaming Call ---


  // --- Pipe the AI stream to the Lambda response stream ---
  let chunkCount = 0;
  for await (const delta of result.textStream) {
    responseStream.write(delta); // Write text chunk directly
    chunkCount++;
  }
  console.log(`[Streaming Chat] Finished piping ${chunkCount} chunks from AI stream.`);
  // --- End Piping ---
  } catch (error) {
    console.error("[Streaming Chat] Failed to write error chunk to stream:", error);
  }
 finally {
  // --- End the response stream ---
  // This MUST be called to signal the end of the response.
  responseStream.end();
  console.log("[Streaming Chat] Response stream ended.");
  // --- End Stream End ---
}
}

export const chatApi = {
  chat: streamingChatHandler // Your actual async handler function
};