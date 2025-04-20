import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import * as aws from "@pulumi/aws";
import { Client } from "pg";
import { parseCookies, createHeaders, handleOptions, setCookie, isAuthSuccess } from "../utils/middleware";
import { AuthenticateWithSessionCookieSuccessResponse, WorkOS } from "@workos-inc/node";

// --- Unified Login Initiator ---
const loginHandler: aws.lambda.EventHandler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event) => {
  if (event.httpMethod === "OPTIONS") {
      return handleOptions(event); // Handles CORS Preflight
  }

  const clientId = process.env.WORKOS_CLIENT_ID || "";
  const workosApiKey = process.env.WORKOS_API_KEY || "";
  const frontendUrl = process.env.FRONTEND_URL || ""; // Your WEBSITE base URL (e.g., https://your-website.com)

  // --- Get the desired FINAL web callback URL from query param ---
  // This is sent by your website's /auth/initiate page
  const from = event.queryStringParameters?.from;
  const state = encodeURIComponent(JSON.stringify({ redirect: from }));

  // --- Check if finalRedirectUri is registered in WorkOS ---
  // You MUST add finalRedirectUri (both electron and standard versions) to your WorkOS allowed list!

  if (!clientId || !workosApiKey || !frontendUrl) {
      console.error("WorkOS config missing in environment variables.");
      return { statusCode: 500, headers: createHeaders(), body: JSON.stringify({ error: "Server configuration error" }) };
  }

  try {
      const workos = new WorkOS(workosApiKey, { clientId });

      const redirectUri = from === "electron" ? `${frontendUrl}/loginDeepUrl` : `${process.env.API_URL}/api/auth/callback`;
      console.log(`Redirecting to WorkOS Auth URL with callback to: ${redirectUri}`);

      const authorizationUrl = workos.userManagement.getAuthorizationUrl({
          provider: 'authkit',
          redirectUri, // Use the validated website callback URL
          clientId,
          // Consider adding a 'state' parameter for CSRF protection during OAuth flow
          state,
        });

      console.log(`Redirecting to WorkOS Auth URL with callback to: ${authorizationUrl}`);

      // Return 302 Redirect to WorkOS
      return {
          statusCode: 302,
          headers: {
              "Location": authorizationUrl,
              // CORS headers might not be strictly needed on a 302, but can be included via createHeaders if desired
              ...createHeaders(event.headers.origin || event.headers.Origin), // Add CORS if needed
          },
          body: ""
      };
  } catch (error) {
      console.error('Error generating WorkOS authorization URL:', error);
      return {
          statusCode: 500,
          headers: createHeaders(event.headers.origin || event.headers.Origin), // Include CORS
          body: JSON.stringify({ error: 'Failed to initiate login', details: error instanceof Error ? error.message : String(error) }),
      };
  }
};


// --- Refactored Callback Handler ---
const callbackHandler: aws.lambda.EventHandler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event) => {
  if (event.httpMethod === "OPTIONS") {
      return handleOptions(event); // Handles CORS Preflight
  }

  const code = event.queryStringParameters?.code;
  const state = JSON.parse(decodeURIComponent(event.queryStringParameters?.state || "{}"));
  console.log("Callback state:", state);
  const clientId = process.env.WORKOS_CLIENT_ID || "";
  const workosApiKey = process.env.WORKOS_API_KEY || "";
  const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD || "";
  const dbUrl = process.env.DB_URL || "";
  const origin = event.headers.origin || event.headers.Origin; // For CORS headers

  if (!code) {
      console.error("Callback Error: Missing code query parameter.");
      return { statusCode: 400, headers: createHeaders(origin), body: JSON.stringify({ error: "Missing required parameters" }) };
  }

  if (!clientId || !workosApiKey || !cookiePassword || !dbUrl) {
      console.error("WorkOS/DB config missing in environment variables for callback.");
      return { statusCode: 500, headers: createHeaders(origin), body: JSON.stringify({ error: "Server configuration error" }) };
  }


  try {
      const workos = new WorkOS(workosApiKey, { clientId });

      const { user, sealedSession } = await workos.userManagement.authenticateWithCode({
        code,
        clientId,
        session: { 
          sealSession: true,
          cookiePassword: cookiePassword,
        },
      });

      console.log(`🔍 AUTH CALLBACK - Success for user: ${user.id} (${user.email})`);

      // --- Database Logic (Keep your existing logic) ---
      const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
      await client.connect();
      try {
           const existingUser = await client.query("SELECT * FROM users WHERE email = $1", [user.email]);
           if (existingUser.rows.length === 0) {
               console.log('Creating new user in DB:', user.email);
               await client.query(
                 `INSERT INTO users (id, email, first_name, last_name, profile_picture_url, has_completed_onboarding) VALUES ($1, $2, $3, $4, $5, $6)`,
                 [
                   user.id,
                   user.email,
                   user.firstName || null,
                   user.lastName || null,
                   user.profilePictureUrl || null,
                   0
                 ]
               );
           } else {
               // Optionally update user profile fields if changed
               await client.query(
                 `UPDATE users SET first_name = $1, last_name = $2, profile_picture_url = $3 WHERE id = $4`,
                 [
                   user.firstName || null,
                   user.lastName || null,
                   user.profilePictureUrl || null,
                   user.id
                 ]
               );
               console.log('User already exists in DB, updated profile fields:', user.email);
           }
      } finally {
          await client.end();
      }
      // --- End Database Logic ---


      return setCookie({
        sealedSession,
        origin,
        user,
        event,
        code,
        state,
      });

  } catch (error) {
      console.error('Authentication callback error:', error);
      // Return JSON error to the calling web page
      return {
          statusCode: 500, // Or 400/401 depending on the error type
          headers: createHeaders(origin), // Include CORS
          body: JSON.stringify({ success: false, error: 'Authentication failed', details: error instanceof Error ? error.message : String(error) })
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
    headers["Set-Cookie"] = `wos-session=; HttpOnly; Path=/; Max-Age=0; SameSite=None; Secure`;
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
};