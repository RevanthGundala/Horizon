"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatApi = exports.toolExecutionHandler = exports.chatHandler = void 0;
const auth_1 = require("../middleware/auth");
const stream_1 = require("../utils/stream");
const tools_1 = require("../tools");
/**
 * Chat handler - processes chat requests and streams responses from Fireworks AI
 */
exports.chatHandler = (0, auth_1.withAuth)((event, user) => __awaiter(void 0, void 0, void 0, function* () {
    // Handle OPTIONS request for CORS preflight
    function createHeaders() {
        return {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "http://localhost:5173",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token",
            "Access-Control-Allow-Credentials": "true"
        };
    }
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
        const payload = {
            model,
            messages: requestBody.messages,
            stream: requestBody.stream !== undefined ? requestBody.stream : true, // Default to streaming
            temperature: requestBody.temperature || 0.7,
            max_tokens: requestBody.max_tokens || 1000,
        };
        // Add tools if provided in the request or use available tools by default
        if (requestBody.tools && requestBody.tools.length > 0) {
            payload.tools = requestBody.tools;
        }
        else {
            // Use all available tools by default
            payload.tools = tools_1.availableTools;
        }
        // If streaming is requested
        if (payload.stream) {
            // Create a stream from the Fireworks API
            const responseStream = (0, stream_1.createFireworksStream)('https://api.fireworks.ai/inference/v1/chat/completions', payload, fireworksApiKey);
            // Convert the stream to a string for the Lambda response
            const streamContent = yield (0, stream_1.streamToString)(responseStream);
            return {
                statusCode: 200,
                headers: Object.assign(Object.assign({}, createHeaders()), { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }),
                body: streamContent,
                isBase64Encoded: false,
            };
        }
        else {
            // For non-streaming responses
            const response = yield fetch('https://api.fireworks.ai/inference/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${fireworksApiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                throw new Error(`Fireworks API error: ${response.status} ${response.statusText}`);
            }
            return {
                statusCode: 200,
                headers: createHeaders(),
                body: JSON.stringify(yield response.json()),
            };
        }
    }
    catch (error) {
        console.error("Chat error:", error);
        return {
            statusCode: 500,
            headers: createHeaders(),
            body: JSON.stringify({ error: "Failed to process chat request" }),
        };
    }
}));
/**
 * Tool execution handler - processes tool calls from the chat
 */
exports.toolExecutionHandler = (0, auth_1.withAuth)((event, user) => __awaiter(void 0, void 0, void 0, function* () {
    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: (0, auth_1.createHeaders)(),
            body: '',
        };
    }
    try {
        if (!event.body) {
            return {
                statusCode: 400,
                headers: (0, auth_1.createHeaders)(),
                body: JSON.stringify({ error: "Request body is required" }),
            };
        }
        const requestBody = JSON.parse(event.body);
        const { toolName, arguments: toolArgs } = requestBody;
        // Check if the tool exists in the registry
        if (!tools_1.toolRegistry[toolName]) {
            return {
                statusCode: 400,
                headers: (0, auth_1.createHeaders)(),
                body: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
            };
        }
        // Execute the tool from the registry
        const toolFunction = tools_1.toolRegistry[toolName];
        let result;
        if (toolName === 'get_user_info') {
            // User info tool needs the user ID
            result = yield toolFunction(user.id);
        }
        else if (toolName === 'get_weather') {
            // Weather tool needs the location
            result = yield toolFunction(toolArgs.location);
        }
        else if (toolName === 'search_knowledge_base') {
            // Knowledge base tool needs the query
            result = yield toolFunction(toolArgs.query);
        }
        else {
            // For other tools, pass all arguments
            result = yield toolFunction(toolArgs);
        }
        return {
            statusCode: 200,
            headers: (0, auth_1.createHeaders)(),
            body: JSON.stringify({ result }),
        };
    }
    catch (error) {
        console.error("Tool execution error:", error);
        return {
            statusCode: 500,
            headers: (0, auth_1.createHeaders)(),
            body: JSON.stringify({ error: "Failed to execute tool" }),
        };
    }
}));
// Export the API handlers
exports.chatApi = {
    chat: exports.chatHandler,
    executeTool: exports.toolExecutionHandler,
};
//# sourceMappingURL=chat.js.map