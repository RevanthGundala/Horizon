import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as random from "@pulumi/random";

// Import our Lambda handlers
import { statusApi } from "./api/lambdas/status";
import { userApi } from "./api/lambdas/user";
import { chatApi } from "./api/lambdas/chat";
import { authApi } from "./api/lambdas/auth";

// Get environment variables from Pulumi config
const config = new pulumi.Config();
const apiUrl = config.require("API_URL");
const fireworksApiKey = config.requireSecret("FIREWORKS_API_KEY");
const frontendUrl = config.require("FRONTEND_URL");
const workosApiKey = config.requireSecret("WORKOS_API_KEY");
const workosClientId = config.requireSecret("WORKOS_CLIENT_ID");
const workosPassword = config.requireSecret("WORKOS_COOKIE_PASSWORD");

// Create a VPC for the RDS instance
const vpc = new awsx.ec2.Vpc("horizon-vpc", {
  numberOfAvailabilityZones: 2,
  natGateways: {
    strategy: "Single",
  },
});

// Create a security group for the RDS instance
const dbSecurityGroup = new aws.ec2.SecurityGroup("db-security-group", {
  vpcId: vpc.vpcId,
  ingress: [
    {
      protocol: "tcp",
      fromPort: 5432,
      toPort: 5432,
      cidrBlocks: ["0.0.0.0/0"], // In production, restrict this to your Lambda functions
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
});

// Create a subnet group for the RDS instance
const dbSubnetGroup = new aws.rds.SubnetGroup("db-subnet-group", {
  subnetIds: vpc.privateSubnetIds,
});

// Generate a random password for the database
const dbPassword = new random.RandomPassword("db-password", {
  length: 16,
  special: false,
});

// Create an RDS PostgreSQL instance
const db = new aws.rds.Instance("horizon-db", {
  engine: "postgres",
  instanceClass: "db.t3.micro",
  allocatedStorage: 20,
  name: "horizon",
  username: "postgres",
  password: dbPassword.result,
  skipFinalSnapshot: true,
  vpcSecurityGroupIds: [dbSecurityGroup.id],
  dbSubnetGroupName: dbSubnetGroup.name,
  parameterGroupName: "default.postgres14",
  engineVersion: "14.6",
});

// Create a Lambda function to initialize the database schema
const dbInitFunction = new aws.lambda.CallbackFunction("db-init", {
  callback: async () => {
    const { Client } = require("pg");
    
    const client = new Client({
      host: process.env.DB_HOST,
      port: 5432,
      database: "horizon",
      user: "postgres",
      password: process.env.DB_PASSWORD,
    });
    
    try {
      await client.connect();
      
      // Create extension for UUID generation and vector operations
      await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
      await client.query(`CREATE EXTENSION IF NOT EXISTS "pgvector";`);
      
      // Create users table
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          email TEXT UNIQUE NOT NULL,
          password_hash TEXT,
          created_at TIMESTAMP DEFAULT now()
        );
      `);
      
      // Create pages table
      await client.query(`
        CREATE TABLE IF NOT EXISTS pages (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          parent_id UUID REFERENCES pages(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          is_favorite BOOLEAN DEFAULT false,
          type TEXT DEFAULT 'page',
          created_at TIMESTAMP DEFAULT now(),
          updated_at TIMESTAMP DEFAULT now()
        );
      `);
      
      // Create blocks table
      await client.query(`
        CREATE TABLE IF NOT EXISTS blocks (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          page_id UUID REFERENCES pages(id) ON DELETE CASCADE,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          content TEXT,
          metadata JSONB,
          order_index INTEGER NOT NULL,
          created_at TIMESTAMP DEFAULT now(),
          updated_at TIMESTAMP DEFAULT now()
        );
      `);
      
      // Create embeddings table
      await client.query(`
        CREATE TABLE IF NOT EXISTS embeddings (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          block_id UUID REFERENCES blocks(id) ON DELETE CASCADE,
          user_id UUID REFERENCES users(id) ON DELETE CASCADE,
          embedding VECTOR(1536),
          created_at TIMESTAMP DEFAULT now()
        );
      `);
      
      // Create index on embeddings
      await client.query(`
        CREATE INDEX IF NOT EXISTS embeddings_vector_idx 
        ON embeddings USING ivfflat (embedding vector_l2_ops) 
        WITH (lists = 100);
      `);
      
      // Create databases table
      await client.query(`
        CREATE TABLE IF NOT EXISTS databases (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          page_id UUID REFERENCES pages(id),
          user_id UUID REFERENCES users(id),
          name TEXT
        );
      `);
      
      // Create records table
      await client.query(`
        CREATE TABLE IF NOT EXISTS records (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          database_id UUID REFERENCES databases(id),
          values JSONB
        );
      `);
      
      return { success: true };
    } catch (error) {
      console.error("Error initializing database:", error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    } finally {
      await client.end();
    }
  },
  environment: {
    variables: {
      DB_HOST: db.endpoint,
      DB_PASSWORD: dbPassword.result,
    }
  },
  runtime: "nodejs16.x",
  timeout: 300,
  vpcConfig: {
    subnetIds: vpc.privateSubnetIds,
    securityGroupIds: [dbSecurityGroup.id],
  },
});

// Common environment variables for all Lambda functions
const env = {
  variables: {
    WORKOS_API_KEY: workosApiKey,
    WORKOS_CLIENT_ID: workosClientId,
    WORKOS_COOKIE_PASSWORD: workosPassword,
    FRONTEND_URL: frontendUrl,
    FIREWORKS_API_KEY: fireworksApiKey,
    API_URL: apiUrl,
    // Add database connection info
    DB_HOST: db.endpoint,
    DB_NAME: "horizon",
    DB_USER: "postgres",
    DB_PASSWORD: dbPassword.result,
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
        environment: env,
      }),
    },
    {
      path: "/auth/callback",
      method: "GET",
      eventHandler: new aws.lambda.CallbackFunction("callback-handler", {
        callback: authApi.callback,
        environment: env,
      }),
    },
    {
      path: "/auth/logout",
      method: "GET",
      eventHandler: new aws.lambda.CallbackFunction("logout-handler", {
        callback: authApi.logout,
        environment: env,
      }),
    },
    {
      path: "/user",
      method: "GET",
      eventHandler: new aws.lambda.CallbackFunction("user-profile-handler", {
        callback: userApi.user,
        environment: env,
      }),
    },
    // Chat endpoints
    {
      path: "/chat",
      method: "POST",
      eventHandler: new aws.lambda.CallbackFunction("chat-handler", {
        callback: chatApi.chat,
        environment: env,
        timeout: 60, // Longer timeout for streaming responses
        memorySize: 512, // More memory for processing chat requests
      }),
    },
    {
      path: "/chat/tool",
      method: "POST",
      eventHandler: new aws.lambda.CallbackFunction("tool-execution-handler", {
        callback: chatApi.executeTool,
        environment: env,
      }),
    },
  ],
});

// Trigger the DB initialization Lambda after the database is created
const dbInitTrigger = new aws.cloudwatch.EventRule("db-init-trigger", {
  description: "Trigger DB initialization after RDS is created",
  scheduleExpression: "rate(1 day)",
  isEnabled: false, // We'll manually enable it once
});

const dbInitTarget = new aws.cloudwatch.EventTarget("db-init-target", {
  rule: dbInitTrigger.name,
  arn: dbInitFunction.arn,
});

const dbInitPermission = new aws.lambda.Permission("db-init-permission", {
  action: "lambda:InvokeFunction",
  function: dbInitFunction.name,
  principal: "events.amazonaws.com",
  sourceArn: dbInitTrigger.arn,
});

// Export the API endpoint URL and database connection info
export const apiEndpoint = api.url;
export const dbEndpoint = db.endpoint;
export const dbName = "horizon";
export const dbUser = "postgres";
// Note: We don't export the password for security reasons
