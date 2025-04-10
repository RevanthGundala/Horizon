import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import * as aws from "@pulumi/aws";
import { Client } from "pg";
import { parseCookies, createHeaders, handleOptions, loadAndAuthenticateSession } from "../utils/middleware";
import { WorkOS } from "@workos-inc/node";

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
    
    console.log('Using redirectUri:', "horizon://api/auth/callback");
    
    console.log('Authorization URL:', authorizationUrl);

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
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  const code = event.queryStringParameters?.code;
  const clientId = process.env.WORKOS_CLIENT_ID || "";

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
    console.log('Authenticating with code:', code);
    
    const { user, sealedSession } = await workos.userManagement.authenticateWithCode({
      code,
      clientId,
      session: {
        sealSession: true,
        cookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
      }
    });
    
    console.log('Authentication successful with redirect URI: horizon://api/auth/callback');

    console.log("WorkOS user:", user);

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
        // Insert the user with the WorkOS ID
        await client.query(
          "INSERT INTO users (id, email) VALUES ($1, $2)",
          [user.id, user.email]
        );
        console.log(`Created new user: ${user.email} with ID: ${user.id}`);
      } else {
        console.log(`User already exists: ${user.email}`);
      }
    } finally {
      // Always close the database connection
      await client.end();
    }

    // Get the domain from the API URL
    const apiUrl = process.env.API_URL || "";
    const domain = apiUrl ? apiUrl.split('://').pop()?.split('/')[0] : "";
    
    // Always redirect to the custom protocol if it's from Electron
    // Our custom protocol is registered with WorkOS as: horizon://api/auth/callback
    const isFromElectron = origin && (origin.startsWith('electron://') || origin.includes('localhost:5173'));
    if (!sealedSession) {
      throw new Error('No sealed session available');
    }
    
    // Include session in the redirect URL for Electron app
    const redirectUrl = isFromElectron 
      ? `horizon://api/auth/callback?code=${code}&session=${encodeURIComponent(sealedSession)}`
      : frontendUrl;
    
    console.log(`Redirecting to ${redirectUrl} (isFromElectron: ${isFromElectron})`);
    console.log(`Using registered redirect URI: horizon://api/auth/callback`);
    
    // If this is an Electron request, return the session data in the response body
    // This helps with issues where the Set-Cookie header might not be properly processed by Electron's fetch API
    const isElectronRequest = event.headers['X-Electron-App'] === 'true' || 
                             event.headers['x-electron-app'] === 'true';
                             
    console.log('Is Electron request:', isElectronRequest, 'Headers:', event.headers);
    
    if (isElectronRequest) {
      console.log('Sending session data in response body for Electron app');
      return {
        statusCode: 200,
        headers: {
          "Set-Cookie": `wos-session=${sealedSession}; HttpOnly; Path=/; SameSite=None; Secure${domain ? `; Domain=${domain}` : ''}`,
          "Access-Control-Allow-Origin": origin || '*',
          "Access-Control-Allow-Credentials": "true",
          "Access-Control-Expose-Headers": "Set-Cookie",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          success: true,
          userId: user.id,
          email: user.email,
          sealedSession: sealedSession
        }),
      };
    }
    
    // For web browser, redirect as normal with cookie
    return {
      statusCode: 302,
      headers: {
        "Location": redirectUrl,
        "Set-Cookie": `wos-session=${sealedSession}; HttpOnly; Path=/; SameSite=None; Secure${domain ? `; Domain=${domain}` : ''}`,
        "Access-Control-Allow-Origin": origin || frontendUrl,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Expose-Headers": "Set-Cookie",
      },
      body: "",
    };
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

    console.log("Session data:", sessionData);
    
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
    
    // Load and authenticate the session
    const authResult = await loadAndAuthenticateSession(sessionData);

    console.log("Auth result:", authResult);
    
    if (!authResult || !authResult.user || !authResult.user.id) {
      return {
        statusCode: 401,
        headers: createHeaders(event.headers.origin || event.headers.Origin),
        body: JSON.stringify({ 
          authenticated: false,
          error: "Invalid session"
        }),
      };
    }

    console.log("Authenticated user:", authResult.user);
    
    return {
      statusCode: 200,
      headers: createHeaders(event.headers.origin || event.headers.Origin),
      body: JSON.stringify({ 
        userId: authResult.user.id
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

  console.log("Logout request received, origin:", origin);
  console.log("Cookies in logout request:", event.headers.cookie || event.headers.Cookie);

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