import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import * as aws from "@pulumi/aws";
import { Client } from "pg";
import { parseCookies, createHeaders, handleOptions, setCookie, isAuthSuccess } from "../utils/middleware";
import { AuthenticateWithSessionCookieSuccessResponse, WorkOS } from "@workos-inc/node";

const loginHandler: aws.lambda.EventHandler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Handle OPTIONS requests for CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return handleOptions(event);
  }
  
  const clientId = process.env.WORKOS_CLIENT_ID || "";
  
  try {
    const workos = new WorkOS(process.env.WORKOS_API_KEY || "", {
      clientId,
    });
    
    // Create the authorization URL
    const authorizationUrl = workos.userManagement.getAuthorizationUrl({
      // Specify that we'd like AuthKit to handle the authentication flow
      provider: 'authkit',
      // Use the exact redirect URI that's registered with WorkOS
      // This must match what's in your WorkOS dashboard exactly
      redirectUri: "horizon://api/auth/callback",
      clientId,
    });
    
    return {
      statusCode: 302,
      headers: {
        "Location": authorizationUrl,
        "Access-Control-Allow-Origin": "*",
      },
      body: ""
    }; 
  } catch (error) {
    console.error('Error generating authorization URL:', error);
    return {
      statusCode: 500,
      headers: createHeaders(),
      body: JSON.stringify({ 
        error: 'Failed to generate authorization URL',
        details: error instanceof Error ? error.message : String(error)
      }),
    };
  }
};

const callbackHandler: aws.lambda.EventHandler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Handle OPTIONS requests for CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return handleOptions(event);
  }

  // Get the origin from the request headers
  const origin = event.headers.origin || event.headers.Origin;
  const code = event.queryStringParameters?.code;
  const clientId = process.env.WORKOS_CLIENT_ID || "";
  const redirectUri = event.queryStringParameters?.redirect_uri;
  
  if (!code) {
    return {
      statusCode: 400,
      headers: createHeaders(origin), 
      body: JSON.stringify({ error: "No code provided" }),
    };
  }

  try {
    const workos = new WorkOS(process.env.WORKOS_API_KEY || "", {
      clientId,
    }); 
    
    const authOptions: any = {
      code,
      clientId,
      session: {
        sealSession: true,
        cookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
      }
    };
    
    // Always include the redirectUri if provided - this is required for the WorkOS flow
    if (redirectUri) {
      authOptions.redirectUri = redirectUri;
    } else {
      // Default redirect URI for web browser flow
      authOptions.redirectUri = `${process.env.API_URL}/api/auth/callback`;
    }
    
    const { user, sealedSession } = await workos.userManagement.authenticateWithCode(authOptions);
    
    console.log('🔍 AUTH CALLBACK - Authentication successful, user:', JSON.stringify({
      id: user.id,
      email: user.email,
      hasSession: !!sealedSession
    }));
    
    // Connect to the database
    const client = new Client({
      connectionString: process.env.DB_URL,
      ssl: {
        rejectUnauthorized: false
      }
    });

    await client.connect();

    try {
      // Check if user already exists by email
      const existingUser = await client.query(
        "SELECT * FROM users WHERE email = $1",
        [user.email]
      );
      
      if (existingUser.rows.length === 0) {
        console.log('🔍 AUTH CALLBACK - Creating new user in database:', user.email);
        // Insert the user with the WorkOS ID
        await client.query(
          "INSERT INTO users (id, email) VALUES ($1, $2)",
          [user.id, user.email]
        );
      } else {
        console.log('🔍 AUTH CALLBACK - User already exists in database:', user.email);
      }
    } finally {
      // Always close the database connection
      await client.end();
    }

    return setCookie(sealedSession, origin, user, event, code); 
  } catch (error) {
    console.error('Authentication error:', error);
    // Get the origin here to avoid closure issues
    const origin = event.headers.origin || event.headers.Origin;
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    
    return {
      statusCode: 302,
      headers: {
        "Location": `${frontendUrl}/login?error=authentication_failed`,
        "Access-Control-Allow-Origin": origin || frontendUrl,
        "Access-Control-Allow-Credentials": "true",
      },
      body: "",
    };
  }
};

const meHandler: aws.lambda.EventHandler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // This handler is wrapped by withAuth middleware, so if we get here, the user is authenticated
  try {
    // Get the session cookie
    const cookies = parseCookies(event.headers.cookie || event.headers.Cookie);
    const sessionData = cookies["wos-session"] || "";

    if (!sessionData) {
      return {
        statusCode: 401,
        headers: createHeaders(event.headers.origin || event.headers.Origin),
        body: JSON.stringify({ 
          authenticated: false,
          error: "No session cookie found"
        }),
      };
    }

    const workos = new WorkOS(process.env.WORKOS_API_KEY || "", {
      clientId: process.env.WORKOS_CLIENT_ID || "",
    });

    const session = workos.userManagement.loadSealedSession({
      sessionData,
      cookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
    });
    
    const authResult = await session.authenticate();
    
    if (!authResult || !isAuthSuccess(authResult)) {
      return {
        statusCode: 401,
        headers: createHeaders(event.headers.origin || event.headers.Origin),
        body: JSON.stringify({ 
          authenticated: false,
          error: "Invalid session"
        }),
      };
    }
    
    return {
      statusCode: 200,
      headers: createHeaders(event.headers.origin || event.headers.Origin),
      body: JSON.stringify({ 
        userId: (authResult as AuthenticateWithSessionCookieSuccessResponse).user.id
      }),
    };
  } catch (error) {
    console.error("Error in me handler:", error);
    return {
      statusCode: 500,
      headers: createHeaders(event.headers.origin || event.headers.Origin),
      body: JSON.stringify({ 
        authenticated: false,
        error: "Server error"
      }),
    };
  }
};

const logoutHandler: aws.lambda.EventHandler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Handle OPTIONS requests for CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return handleOptions(event);
  }

  // Get the origin and frontend URL
  const origin = event.headers.origin || event.headers.Origin;
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const apiUrl = process.env.API_URL || "";
  
  // Extract domain from API URL if available
  const apiDomain = apiUrl ? apiUrl.split('://').pop()?.split('/')[0] : "";

  // Create headers object
  const headers: Record<string, string> = {
    "Location": `${frontendUrl}/login`,
    "Access-Control-Allow-Origin": origin || frontendUrl,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Expose-Headers": "Set-Cookie",
  };
  
  // Set cookie clearing header with domain attribute matching how it was set
  if (apiDomain) {
    headers["Set-Cookie"] = `wos-session=; HttpOnly; Path=/; Max-Age=0; SameSite=None; Secure; Domain=${apiDomain}`;
  } else {
    headers["Set-Cookie"] = "wos-session=; HttpOnly; Path=/; Max-Age=0; SameSite=None; Secure";
  }
  
  // Return success with cookie clearing headers
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true }),
  };
};

export const authApi = {
  login: loginHandler,
  callback: callbackHandler,
  logout: logoutHandler,
  me: meHandler,
};