// infrastructure/index.ts – Pulumi program that wires API Gateway + Lambda Function URL behind a single
// CloudFront distribution.  This version fixes the “origin name must be a domain name” error and removes
// hard‑coded secrets.  Supply all values with `pulumi config set` (and add `--secret` for sensitive data).

import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as path from "path";
import { syncApi } from "./api/lambdas/sync";
import { authApi } from "./api/lambdas/auth";
import { statusApi } from "./api/lambdas/status";

// ‑‑‑ Helper --------------------------------------------------------------
// Split an https URL into hostname + pathname (stage).  CloudFront needs these separately.
function split(url: pulumi.Output<string>) {
  return {
    host: url.apply(u => new URL(u).hostname),                          // "abcd.execute-api…"
    path: url.apply(u => {
      const p = new URL(u).pathname.replace(/\/$/, "");               // "/stage" | "/dev" | ""
      return p || "/";                                                 // CloudFront requires at least "/"
    }),
  } as const;
}

// ‑‑‑ Config -------------------------------------------------------------
const cfg = new pulumi.Config();

// runtime (non‑secret) values
type RequiredKey = "API_URL" | "FRONTEND_URL" | "CHAT_URL";
const apiUrl           = cfg.require<RequiredKey>("API_URL");
const frontendUrl      = cfg.require("FRONTEND_URL");
const chatUrl          = cfg.require("CHAT_URL");

// secrets – always store with `pulumi config set --secret <key>`
const fireworksApiKey  = cfg.requireSecret("FIREWORKS_API_KEY");
const workosApiKey     = cfg.requireSecret("WORKOS_API_KEY");
const workosClientId   = cfg.requireSecret("WORKOS_CLIENT_ID");
const workosCookiePwd  = cfg.requireSecret("WORKOS_COOKIE_PASSWORD");
const openaiApiKey     = cfg.requireSecret("OPENAI_API_KEY");
const redisUrl = cfg.requireSecret("REDIS_URL");
const dbUrl = cfg.requireSecret("DB_URL");

// ‑‑‑ Common Lambda env ---------------------------------------------------
const commonEnv = {
  variables: {
    WORKOS_API_KEY:         workosApiKey,
    WORKOS_CLIENT_ID:       workosClientId,
    WORKOS_COOKIE_PASSWORD: workosCookiePwd,
    FRONTEND_URL:           frontendUrl,
    FIREWORKS_API_KEY:      fireworksApiKey,
    API_URL:                apiUrl,
    OPENAI_API_KEY:         openaiApiKey,
    REDIS_URL:              redisUrl,
    CHAT_URL:               chatUrl,
    DB_URL:                 dbUrl,
  },
};

// ‑‑‑ IAM role -----------------------------------------------------------
const lambdaRole = new aws.iam.Role("lambdaRole", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "lambda.amazonaws.com" }),
});
new aws.iam.RolePolicyAttachment("lambdaLogs", {
  role:       lambdaRole.name,
  policyArn:  aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
});

// ‑‑‑ Streaming Lambda (Function URL) ------------------------------------
const streamingChatLambda = new aws.lambda.Function("streamingChat", {
  code:    new pulumi.asset.FileArchive(path.join(__dirname, "../dist")),
  handler: "chat.streamingChatHandler",
  role:    lambdaRole.arn,
  runtime: aws.lambda.Runtime.NodeJS18dX,
  timeout: 180,
  memorySize: 1024,
  environment: commonEnv,
});

const chatFunctionUrl = new aws.lambda.FunctionUrl("chatUrl", {
  functionName:   streamingChatLambda.name,
  authorizationType: "NONE",
  invokeMode:     "RESPONSE_STREAM",
  cors: {
    allowCredentials: true,
    allowHeaders:  ["Content-Type", "Cookie", "Authorization", "X-Electron-App"],
    allowMethods:  ["POST"],
    allowOrigins:  ["*"],
    exposeHeaders: ["*"] ,
  },
});

// ‑‑‑ API Gateway (all other REST endpoints) -----------------------------
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
        environment: commonEnv,
      }),
    },
    // Authentication endpoints (standard request/response)
    {
      path: "/api/auth/token",
      method: "POST",
      eventHandler: new aws.lambda.CallbackFunction("token-callback-handler", {
        callback: authApi.callback,
        environment: commonEnv,
      }),
    },
    {
      path: "/api/auth/logout",
      method: "GET", // Consider POST for logout if preferred
      eventHandler: new aws.lambda.CallbackFunction("logout-handler", {
        callback: authApi.logout,
        environment: commonEnv,
      }),
    },
    // User endpoint (uses /me path - CORRECTED)
    {
      path: "/api/auth/me",
      method: "GET",
      eventHandler: new aws.lambda.CallbackFunction("get-current-user-handler", { // Renamed
        callback: authApi.me, // Assumes this uses withAuth
        environment: commonEnv,
      }),
    },
    // Sync endpoints (standard request/response)
    {
      path: "/api/sync/status",
      method: "POST",
      eventHandler: new aws.lambda.CallbackFunction("sync-status-handler", {
        callback: syncApi.status,
        environment: commonEnv,
      }),
    },
    {
      path: "/api/sync/pull",
      method: "POST",
      eventHandler: new aws.lambda.CallbackFunction("sync-pull-handler", {
        callback: syncApi.pull,
        environment: commonEnv,
        memorySize: 512, // Sync might need more memory
        timeout: 60,    // Sync might take longer
      }),
    },
    {
      path: "/api/sync/push",
      method: "POST",
      eventHandler: new aws.lambda.CallbackFunction("sync-push-handler", {
        callback: syncApi.push,
        environment: commonEnv,
        memorySize: 512,
        timeout: 60,
      }),
    },
    // NOTE: The /api/chat route is intentionally REMOVED from API Gateway
    // as it's now handled by the direct Lambda Function URL.
  ],
});


// ‑‑‑ CloudFront origins --------------------------------------------------
const apiParts  = split(api.url);                       // host + "/stage"
const chatParts = split(chatFunctionUrl.functionUrl);   // host + "/"
const allMethods = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"];
const allCachedMethods = ["GET", "HEAD", "OPTIONS"]
const cachingDisabledPolicyId = aws.cloudfront.getCachePolicyOutput({
  name: "Managed-CachingDisabled",
});
const allViewerExceptHostHeaderPolicy = aws.cloudfront.getOriginRequestPolicyOutput({
  name: "Managed-AllViewerExceptHostHeader",
});

const distribution = new aws.cloudfront.Distribution("horizon-cf", {
  enabled: true,
  priceClass: "PriceClass_100",
  origins: [
    {
      domainName: apiParts.host,
      originId:   "api-gw",
      originPath: apiParts.path,        // e.g. "/stage"
      customOriginConfig: {
        originProtocolPolicy: "https-only",
        httpsPort: 443,
        httpPort: 80,
        originSslProtocols: ["TLSv1.2"],
      },
    },
    {
      domainName: chatParts.host,
      originId:   "chat-url",
      customOriginConfig: {
        originProtocolPolicy: "https-only",
        httpsPort: 443,
        httpPort: 80,
        originSslProtocols: ["TLSv1.2"],
      },
    },
  ],
  defaultCacheBehavior: {
    targetOriginId: "api-gw",
    viewerProtocolPolicy: "redirect-to-https",
    allowedMethods: allMethods,
    cachedMethods:  allCachedMethods,
    cachePolicyId: cachingDisabledPolicyId.id!.apply(id => {
      if (!id) throw new Error("Managed-CachingDisabled policy not found");
      return id;
    }),
    originRequestPolicyId: allViewerExceptHostHeaderPolicy.id!.apply(id => {
      if (!id) throw new Error("Managed-AllViewerExceptHostHeader policy not found");
      return id;
    }),
  },
  orderedCacheBehaviors: [
    {
      pathPattern: "/api/chat*",      // Function URL path
      targetOriginId: "chat-url",
      viewerProtocolPolicy: "redirect-to-https",
      allowedMethods: allMethods,
      cachedMethods:  allCachedMethods,
      cachePolicyId: cachingDisabledPolicyId.id!.apply(id => {
        if (!id) throw new Error("Managed-CachingDisabled policy not found");
        return id;
      }),
      originRequestPolicyId: allViewerExceptHostHeaderPolicy.id!.apply(id => {
        if (!id) throw new Error("Managed-AllViewerExceptHostHeader policy not found");
        return id;
      }),
    },
  ],
  restrictions: { geoRestriction: { restrictionType: "none" } },
  viewerCertificate: { cloudfrontDefaultCertificate: true },
});

// ‑‑‑ Stack outputs ------------------------------------------------------
export const apiGatewayEndpoint    = api.url;
export const chatFunctionUrlOutput = chatFunctionUrl.functionUrl;
export const cloudfrontDomain      = distribution.domainName;