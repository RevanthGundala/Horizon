import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
// Import our Lambda handlers
import { statusApi } from "./api/lambdas/status";
import { userApi } from "./api/lambdas/user";
import { chatApi } from "./api/lambdas/chat";
import { authApi } from "./api/lambdas/auth";
import { syncApi } from "./api/lambdas/sync";
// No need to import searchApi as it's used as a tool, not an API endpoint
import { Client } from "pg";
import { SQL_SCHEMAS } from "../../shared/sql-schemas";

// Get environment variables from Pulumi config
const config = new pulumi.Config();
const apiUrl = config.require("API_URL");
const fireworksApiKey = config.requireSecret("FIREWORKS_API_KEY");
const frontendUrl = config.require("FRONTEND_URL");
const workosApiKey = config.requireSecret("WORKOS_API_KEY");
const workosClientId = config.requireSecret("WORKOS_CLIENT_ID");
const workosPassword = config.requireSecret("WORKOS_COOKIE_PASSWORD");
const openaiApiKey = config.requireSecret("OPENAI_API_KEY");

// TODO: Move to Pulumi config
const password = "zisbas-roCfud-9kappe";
const connectionString = `postgresql://postgres.wduhigsetfxsisltbjhr:${password}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;
const redisUrl = "redis://default:AWo3AAIjcDFmMjQ3ZWU1YjZkMTA0NTJiOTk1OWM2OGI5NmQwYzgzYnAxMA@diverse-egret-27191.upstash.io:6379";

// Common environment variables for all Lambda functions
const env = {
  variables: {
    WORKOS_API_KEY: workosApiKey,
    WORKOS_CLIENT_ID: workosClientId,
    WORKOS_COOKIE_PASSWORD: workosPassword,
    FRONTEND_URL: frontendUrl,
    FIREWORKS_API_KEY: fireworksApiKey,
    API_URL: apiUrl,
    DB_URL: connectionString,
    DATABASE_URL: connectionString,
    OPENAI_API_KEY: openaiApiKey,
    REDIS_URL: redisUrl
  }
};

// Initialize our DB
(async function initDatabase() {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });
  
  try {
    await client.connect();
    console.log("🔷 Initializing database schema...");
    
    await client.query(SQL_SCHEMAS.USERS);
    await client.query(SQL_SCHEMAS.WORKSPACES);
    await client.query(SQL_SCHEMAS.NOTES);
    await client.query(SQL_SCHEMAS.BLOCKS);
    await client.query(SQL_SCHEMAS.SYNC_LOG);
    
    console.log("✅ Database initialized successfully");
  } catch (err) {
    console.error("❌ Database initialization failed:", err);
    throw err;
  } finally {
    await client.end();
  }
})().catch(err => {
  console.error("Fatal error during initialization:", err);
  process.exit(1);
});

// Create an API Gateway
const api = new awsx.classic.apigateway.API("horizon-api", {
  routes: [
    // Status endpoint
    {
      path: "/api/status",
      method: "GET",
      eventHandler: statusApi.check,
    },
    // Authentication endpoints
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
      method: "GET",
      eventHandler: new aws.lambda.CallbackFunction("logout-handler", {
        callback: authApi.logout,
        environment: env,
      }),
    },
    {
      path: "/api/auth/me",
      method: "GET",
      eventHandler: new aws.lambda.CallbackFunction("me-handler", {
        callback: authApi.me,
        environment: env,
      }),
    },
    {
      path: "/api/user",
      method: "GET",
      eventHandler: new aws.lambda.CallbackFunction("user-profile-handler", {
        callback: userApi.user,
        environment: env,
      }),
    },
    // Chat endpoints
    {
      path: "/api/chat",
      method: "POST",
      eventHandler: new aws.lambda.CallbackFunction("chat-handler", {
        callback: chatApi.chat,
        environment: env,
        timeout: 60, // Longer timeout for streaming responses
        memorySize: 512, // More memory for processing chat requests
      }),
    },
    // Sync endpoints with Git-inspired naming
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
      }),
    },
    {
      path: "/api/sync/push",
      method: "POST",
      eventHandler: new aws.lambda.CallbackFunction("sync-push-handler", {
        callback: syncApi.push,
        environment: env,
      }),
    },
    // No standalone search endpoints needed - search functionality is provided as tools in the chat endpoint
  ],
});

export const apiEndpoint = api.url;
