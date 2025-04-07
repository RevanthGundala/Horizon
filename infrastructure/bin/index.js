"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiEndpoint = void 0;
const pulumi = __importStar(require("@pulumi/pulumi"));
const aws = __importStar(require("@pulumi/aws"));
const awsx = __importStar(require("@pulumi/awsx"));
// Import our Lambda handlers
const status_1 = require("./api/lambdas/status");
const user_1 = require("./api/lambdas/user");
const chat_1 = require("./api/lambdas/chat");
const auth_1 = require("./api/lambdas/auth");
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
            eventHandler: status_1.statusApi.check,
        },
        // Authentication endpoints
        {
            path: "/api/auth/login",
            method: "GET",
            eventHandler: new aws.lambda.CallbackFunction("login-handler", {
                callback: auth_1.authApi.login,
                environment: env,
            }),
        },
        {
            path: "/api/auth/callback",
            method: "GET",
            eventHandler: new aws.lambda.CallbackFunction("callback-handler", {
                callback: auth_1.authApi.callback,
                environment: env,
            }),
        },
        {
            path: "/api/auth/logout",
            method: "GET",
            eventHandler: new aws.lambda.CallbackFunction("logout-handler", {
                callback: auth_1.authApi.logout,
                environment: env,
            }),
        },
        {
            path: "/api/auth/me",
            method: "GET",
            eventHandler: new aws.lambda.CallbackFunction("me-handler", {
                callback: auth_1.authApi.me,
                environment: env,
            }),
        },
        {
            path: "/api/user",
            method: "GET",
            eventHandler: new aws.lambda.CallbackFunction("user-profile-handler", {
                callback: user_1.userApi.user,
                environment: env,
            }),
        },
        // Chat endpoints
        {
            path: "/api/chat",
            method: "POST",
            eventHandler: new aws.lambda.CallbackFunction("chat-handler", {
                callback: chat_1.chatApi.chat,
                environment: env,
                timeout: 60, // Longer timeout for streaming responses
                memorySize: 512, // More memory for processing chat requests
            }),
        },
    ],
});
exports.apiEndpoint = api.url;
//# sourceMappingURL=index.js.map