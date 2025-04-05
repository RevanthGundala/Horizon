import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

// Import our Lambda handlers
import { statusApi } from "./api/status";
import { authApi } from "./api/auth";
import { protectedApi } from "./api/protected";
import { userApi } from "./api/protected/user";
import { configApi } from "./api/config";

// Get environment variables from Pulumi config
const config = new pulumi.Config();
const workosApiKey = config.requireSecret("workosApiKey");
const workosClientId = config.requireSecret("workosClientId");
const workosPassword = config.requireSecret("workosPassword");
const frontendUrl = config.require("frontendUrl");
const redirectUri = config.require("redirectUri");

// Common environment variables for all Lambda functions
const lambdaEnv = {
  variables: {
    WORKOS_API_KEY: workosApiKey,
    WORKOS_CLIENT_ID: workosClientId,
    WORKOS_COOKIE_PASSWORD: workosPassword,
    FRONTEND_URL: frontendUrl,
    REDIRECT_URI: redirectUri,
  }
};

// Create an API Gateway
const api = new awsx.classic.apigateway.API("horizon-api", {
  routes: [
    // Status endpoint
    {
      path: "/status",
      method: "GET",
      eventHandler: statusApi.check,
    },
    // Authentication endpoints
    {
      path: "/auth/login",
      method: "GET",
      eventHandler: new aws.lambda.CallbackFunction("login-handler", {
        callback: authApi.login,
        environment: lambdaEnv,
      }),
    },
    {
      path: "/auth/callback",
      method: "GET",
      eventHandler: new aws.lambda.CallbackFunction("callback-handler", {
        callback: authApi.callback,
        environment: lambdaEnv,
      }),
    },
    {
      path: "/auth/logout",
      method: "GET",
      eventHandler: new aws.lambda.CallbackFunction("logout-handler", {
        callback: authApi.logout,
        environment: lambdaEnv,
      }),
    },
    // Protected endpoints
    {
      path: "/protected",
      method: "GET",
      eventHandler: new aws.lambda.CallbackFunction("protected-handler", {
        callback: protectedApi.getData,
        environment: lambdaEnv,
      }),
    },
    {
      path: "/user/profile",
      method: "GET",
      eventHandler: new aws.lambda.CallbackFunction("user-profile-handler", {
        callback: userApi.getProfile,
        environment: lambdaEnv,
      }),
    },
  ],
});

// Add the config endpoint after the API is created to avoid circular reference
const configFunction = new aws.lambda.CallbackFunction("config-handler", {
  callback: configApi.getConfig,
  environment: {
    variables: {
      ...lambdaEnv.variables,
      API_URL: api.url,
      NODE_ENV: pulumi.getStack(),
    }
  },
});

// Create a new API integration for the config endpoint
const configIntegration = new aws.apigateway.Integration("config-integration", {
  restApi: api.restAPI,
  resourceId: new aws.apigateway.Resource("config-resource", {
    restApi: api.restAPI,
    parentId: api.restAPI.rootResourceId,
    pathPart: "config",
  }).id,
  httpMethod: "GET",
  type: "AWS_PROXY",
  integrationHttpMethod: "POST",
  uri: configFunction.invokeArn,
});

// Create a method for the config endpoint
const configMethod = new aws.apigateway.Method("config-method", {
  restApi: api.restAPI,
  resourceId: configIntegration.resourceId,
  httpMethod: "GET",
  authorization: "NONE",
});

// Grant the API Gateway permission to invoke the Lambda function
const configPermission = new aws.lambda.Permission("config-permission", {
  action: "lambda:InvokeFunction",
  function: configFunction.name,
  principal: "apigateway.amazonaws.com",
  sourceArn: pulumi.interpolate`${api.restAPI.executionArn}/*/*/config`,
});

// Create a DynamoDB table for notes
const notesTable = new aws.dynamodb.Table("notes", {
  attributes: [
    { name: "id", type: "S" },
    { name: "userId", type: "S" },
  ],
  hashKey: "id",
  globalSecondaryIndexes: [
    {
      name: "userIndex",
      hashKey: "userId",
      projectionType: "ALL",
      readCapacity: 5,
      writeCapacity: 5,
    },
  ],
  billingMode: "PROVISIONED",
  readCapacity: 5,
  writeCapacity: 5,
});

// Create a DynamoDB table for users
const usersTable = new aws.dynamodb.Table("users", {
  attributes: [
    { name: "id", type: "S" },
    { name: "email", type: "S" },
  ],
  hashKey: "id",
  globalSecondaryIndexes: [
    {
      name: "emailIndex",
      hashKey: "email",
      projectionType: "ALL",
      readCapacity: 5,
      writeCapacity: 5,
    },
  ],
  billingMode: "PROVISIONED",
  readCapacity: 5,
  writeCapacity: 5,
});

// Export the API endpoint URL
export const apiEndpoint = api.url;
export const notesTableName = notesTable.name;
export const usersTableName = usersTable.name;
