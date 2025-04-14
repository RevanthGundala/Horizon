import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx"; // Using classic API Gateway here

// Import our Lambda handlers
import { statusApi } from "./api/lambdas/status";
import { userApi } from "./api/lambdas/user";
import { authApi } from "./api/lambdas/auth";
import { syncApi } from "./api/lambdas/sync";
import * as path from "path";
import { chatApi } from "./api/lambdas/chat";

// Get environment variables from Pulumi config
const config = new pulumi.Config();
const apiUrl = config.require("API_URL"); // Base URL for API Gateway endpoints
const fireworksApiKey = config.requireSecret("FIREWORKS_API_KEY");
const frontendUrl = config.require("FRONTEND_URL"); // Used for CORS
const workosApiKey = config.requireSecret("WORKOS_API_KEY");
const workosClientId = config.requireSecret("WORKOS_CLIENT_ID");
const workosPassword = config.requireSecret("WORKOS_COOKIE_PASSWORD");
const openaiApiKey = config.requireSecret("OPENAI_API_KEY");

// --- Database & Redis Config ---
// TODO: Securely manage password/connection strings using Pulumi secrets or KMS
const password = "zisbas-roCfud-9kappe"; // WARNING: Hardcoding secrets is insecure
const connectionString = `postgresql://postgres.wduhigsetfxsisltbjhr:${password}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
const redisUrl = "redis://default:AWo3AAIjcDFmMjQ3ZWU1YjZkMTA0NTJiOTk1OWM2OGI5NmQwYzgzYnAxMA@diverse-egret-27191.upstash.io:6379"; // WARNING: Hardcoding secrets is insecure

// Common environment variables for all Lambda functions
// Ensure CHAT_FUNCTION_URL is NOT needed here if client gets it from Pulumi output
const env = {
 variables: {
   WORKOS_API_KEY: workosApiKey,
   WORKOS_CLIENT_ID: workosClientId,
   WORKOS_COOKIE_PASSWORD: workosPassword,
   FRONTEND_URL: frontendUrl,
   FIREWORKS_API_KEY: fireworksApiKey,
   API_URL: apiUrl, // Keep for Lambdas needing the base API URL
   DB_URL: connectionString,
   DATABASE_URL: connectionString, // Some libraries prefer this name
   OPENAI_API_KEY: openaiApiKey,
   REDIS_URL: redisUrl
 }
};

// --- Database Initialization ---
// Keep console logs as reminders
console.log("🔷 Skipping database initialization during deployment");

// --- Define IAM Role for Lambdas ---
// It's good practice to define a role explicitly
const lambdaRole = new aws.iam.Role("lambdaRole", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "lambda.amazonaws.com" }),
});

// --- Define Lambda Function for Streaming Chat using aws.lambda.Function ---
const streamingChatLambda = new aws.lambda.Function("streaming-chat-handler-func", {
  // Specify the path to your compiled Javascript code package
  code: new pulumi.asset.FileArchive(path.join(__dirname, "../dist")), // ADJUST PATH to your build output directory
  // Specify the handler entrypoint: 'filename.exportedHandlerName'
  handler: "api/lambdas/chat.chatApi.chat", // ADJUST filename (chat.js?) and exported name if needed
  runtime: aws.lambda.Runtime.NodeJS18dX, // <== IS SET
  role: lambdaRole.arn, // Assign the IAM role
  environment: env,
  timeout: 180,
  memorySize: 1024,
});


// --- Create Lambda Function URL for Streaming Chat ---
// This part remains the same, targeting the new aws.lambda.Function resource
const chatFunctionUrl = new aws.lambda.FunctionUrl("chatFunctionUrl", {
  functionName: streamingChatLambda.name, // Targets the aws.lambda.Function
  authorizationType: "NONE",
  invokeMode: "RESPONSE_STREAM",
  cors: {
    allowCredentials: true,
    allowHeaders: ["Content-Type", "Cookie", "Authorization", "X-Electron-App"],
    allowMethods: ["POST"],
    allowOrigins: ["*"],
    exposeHeaders: ["*"],
    maxAge: 86400,
  },
});


// --- Create API Gateway for REST Endpoints (Non-Chat) ---
const api = new awsx.classic.apigateway.API("horizon-api", {
 restApiArgs: {
   binaryMediaTypes: ["*/*"], // Keep if needed for other endpoints
 },
 stageArgs: {
   cacheClusterEnabled: false,
 },
 routes: [
   // Status endpoint
   {
     path: "/api/status",
     method: "GET",
     // Assuming statusApi.check is a standard request/response handler
     eventHandler: new aws.lambda.CallbackFunction("status-handler", {
        callback: statusApi.check,
        environment: env,
     }),
   },
   // Authentication endpoints (standard request/response)
   {
     path: "/api/auth/login",
     method: "GET",
     eventHandler: new aws.lambda.CallbackFunction("login-handler", {
       callback: authApi.login,
       environment: env,
     }),
   },
   {
     path: "/api/auth/callback",
     method: "GET",
     eventHandler: new aws.lambda.CallbackFunction("callback-handler", {
       callback: authApi.callback,
       environment: env,
     }),
   },
   {
     path: "/api/auth/logout",
     method: "GET", // Consider POST for logout if preferred
     eventHandler: new aws.lambda.CallbackFunction("logout-handler", {
       callback: authApi.logout,
       environment: env,
     }),
   },
   // User endpoint (uses /me path - CORRECTED)
   {
     path: "/api/users/me",
     method: "GET",
     eventHandler: new aws.lambda.CallbackFunction("get-current-user-handler", { // Renamed
       callback: userApi.user, // Assumes this uses withAuth
       environment: env,
     }),
   },
   // Sync endpoints (standard request/response)
   {
     path: "/api/sync/status",
     method: "POST",
     eventHandler: new aws.lambda.CallbackFunction("sync-status-handler", {
       callback: syncApi.status,
       environment: env,
     }),
   },
   {
     path: "/api/sync/pull",
     method: "POST",
     eventHandler: new aws.lambda.CallbackFunction("sync-pull-handler", {
       callback: syncApi.pull,
       environment: env,
       memorySize: 512, // Sync might need more memory
       timeout: 60,    // Sync might take longer
     }),
   },
   {
     path: "/api/sync/push",
     method: "POST",
     eventHandler: new aws.lambda.CallbackFunction("sync-push-handler", {
       callback: syncApi.push,
       environment: env,
       memorySize: 512,
       timeout: 60,
     }),
   },
   // NOTE: The /api/chat route is intentionally REMOVED from API Gateway
   // as it's now handled by the direct Lambda Function URL.
 ],
});

// --- Exports ---

// Export the standard API Gateway endpoint URL (for non-chat endpoints)
export const apiGatewayEndpoint = api.url;

// Export the specific Lambda Function URL for streaming chat
export const chatFunctionUrlEndpoint = chatFunctionUrl.functionUrl;