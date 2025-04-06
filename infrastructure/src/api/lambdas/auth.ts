import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import * as aws from "@pulumi/aws";
import { WorkOS } from "@workos-inc/node";
import { Client } from "pg";
import { parseCookies } from "../middleware/auth";

const workos = new WorkOS(process.env.WORKOS_API_KEY || "", {
  clientId: process.env.WORKOS_CLIENT_ID || "",
});

// Helper function to create consistent headers
const createHeaders = () => {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "http://localhost:5173",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token",
    "Access-Control-Allow-Credentials": "true"
  };
};

const loginHandler: aws.lambda.EventHandler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const authorizationUrl = workos.userManagement.getAuthorizationUrl({
    // Specify that we'd like AuthKit to handle the authentication flow
    provider: 'authkit',

    // The callback endpoint that WorkOS will redirect to after a user authenticates
    redirectUri: `${process.env.FRONTEND_URL || "http://localhost:5173"}/callback`,
    clientId: process.env.WORKOS_CLIENT_ID || "",
  });

  // Redirect the user to the AuthKit sign-in page
  return {
    statusCode: 302,
    headers: {
      Location: authorizationUrl,
    },
    body: '',
  };
};

const callbackHandler: aws.lambda.EventHandler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {

  const code = event.queryStringParameters?.code;

  if (!code) {
    return {
      statusCode: 400,
      headers: createHeaders(), 
      body: JSON.stringify({ error: "No code provided" }),
    };
  }

  try {
    const { user } = await workos.userManagement.authenticateWithCode({
      code,
      clientId: process.env.WORKOS_CLIENT_ID || "",
    });

    // Connect to the database
    const client = new Client({
      host: process.env.DB_HOST,
      port: 5432,
      database: process.env.DB_NAME || "horizon",
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD,
    });

    await client.connect();

    try {
      // Check if user already exists
      const existingUser = await client.query(
        "SELECT * FROM users WHERE email = $1",
        [user.email]
      );

      if (existingUser.rows.length === 0) {
        // Add the user to our users db in RDS
        await client.query(
          "INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, NOW())",
          [user.id, user.email, user.firstName || "", user.lastName || ""]
        );
        console.log(`Created new user: ${user.email}`);
      } else {
        console.log(`User already exists: ${user.email}`);
      }
    } finally {
      // Always close the database connection
      await client.end();
    }

    // Redirect the user to the homepage
    return {
      statusCode: 302,
      headers: {
        Location: `${process.env.FRONTEND_URL || "http://localhost:5173"}`,
      },
      body: '',
    };
  } catch (error) {
    console.error("Authentication error:", error);
    return {
      statusCode: 500,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Authentication failed" }),
    };
  }
};

const logoutHandler: aws.lambda.EventHandler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const cookies = parseCookies(event.headers.cookie);
  const sessionData = cookies["wos-session"] || "";

  const session = workos.userManagement.loadSealedSession({
    sessionData,
    cookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
  });

  const url = await session.getLogoutUrl();

  // Instead of using res.clearCookie, set an expired cookie in the response headers
  return {
    statusCode: 302,
    headers: {
      Location: url,
      "Set-Cookie": "wos-session=; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      ...createHeaders()
    },
    body: '',
  };
};

export const authApi = {
  login: loginHandler,
  callback: callbackHandler,
  logout: logoutHandler,
};
