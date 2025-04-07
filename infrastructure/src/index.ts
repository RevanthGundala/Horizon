import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as random from "@pulumi/random";

// Import our Lambda handlers
import { statusApi } from "./api/lambdas/status";
import { userApi } from "./api/lambdas/user";
import { chatApi } from "./api/lambdas/chat";
import { authApi } from "./api/lambdas/auth";
import { withAuth } from "./api/utils/middleware";

// Get environment variables from Pulumi config
const config = new pulumi.Config();
const apiUrl = config.require("API_URL");
const fireworksApiKey = config.requireSecret("FIREWORKS_API_KEY");
const frontendUrl = config.require("FRONTEND_URL");
const workosApiKey = config.requireSecret("WORKOS_API_KEY");
const workosClientId = config.requireSecret("WORKOS_CLIENT_ID");
const workosPassword = config.requireSecret("WORKOS_COOKIE_PASSWORD");
const password = "zisbas-roCfud-9kappe";
const connectionString = `postgresql://postgres.wduhigsetfxsisltbjhr:${password}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`;


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
  }
};

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
  ],
});

export const apiEndpoint = api.url;
