import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import * as aws from "@pulumi/aws";
import { createHeaders, handleOptions, getPool, getUserId } from "../utils/helpers";
import { WorkOS } from "@workos-inc/node";
import { URL } from 'url';



// --- Refactored Callback Handler ---
const tokenHandler: aws.lambda.EventHandler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event) => {
  console.log("Token handler reached")
  if (event.httpMethod === "OPTIONS") {
      return handleOptions(event); // Handles CORS Preflight
  }



  const origin = event.headers.origin || event.headers.Origin; // For CORS headers

  const body = event.body ? JSON.parse(event.body) : {};
  const { code, from } = body;

  const clientId = process.env.WORKOS_CLIENT_ID || "";
  const workosApiKey = process.env.WORKOS_API_KEY || "";
  const dbUrl = process.env.DB_URL || "";

  if (!code) {
      console.error("Callback Error: Missing code query parameter.");
      return { statusCode: 400, headers: createHeaders(origin), body: JSON.stringify({ error: "Missing required parameters" }) };
  }

  if (!clientId || !workosApiKey || !dbUrl) {
      console.error("WorkOS/DB config missing in environment variables for callback.");
      return { statusCode: 500, headers: createHeaders(origin), body: JSON.stringify({ error: "Server configuration error" }) };
  }


  try {
      const workos = new WorkOS(workosApiKey, { clientId });

      const { user, accessToken, refreshToken } = await workos.userManagement.authenticateWithCode({
        code,
        clientId,
      });

      console.log(`🔍 AUTH CALLBACK - Success for user: ${user.id} (${user.email})`);

      // --- Database Logic (Keep your existing logic) ---
      // Upsert user record: insert or update existing based on email
      await getPool().query(
        `
        INSERT INTO users (
            id,
            email,
            first_name,
            last_name,
            profile_picture_url,
            has_completed_onboarding
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (email) DO UPDATE SET
            first_name = EXCLUDED.first_name,
            last_name = EXCLUDED.last_name,
            profile_picture_url = EXCLUDED.profile_picture_url
        `,
        [
            user.id,
            user.email,
            user.firstName || null,
            user.lastName || null,
            user.profilePictureUrl || null,
            0
        ]
      );

    if (from?.redirect === "electron") {
      return {
        statusCode: 200,
        headers: createHeaders(origin),
        body: JSON.stringify({ accessToken, refreshToken }),
      };
    }
    // Redirect user back to website if request is from web
  // return {
  //   statusCode: 302,
  //   headers: {
  //     "Location": `${frontendUrl}/settings`,
  //     "Access-Control-Allow-Origin": origin || "http://localhost:5173",
  //     "Access-Control-Allow-Credentials": "true",
  //     "Access-Control-Expose-Headers": "Set-Cookie",
  //   },
  //   body: "",
  // };
  return {
    statusCode: 500,
    headers: createHeaders(origin),
    body: JSON.stringify({ success: false, error: 'Failed to redirect user' }),
  };

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

// Handler that returns user data (protected by auth)
const meHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // STEP 1: Extract JWT from Authorization header
  const authHeader = event.headers.Authorization || event.headers.authorization;
  let token: string | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7); // Remove 'Bearer ' prefix
  }

  if (!token) {
      console.log("No JWT found in Authorization header.");
      return {
          statusCode: 401,
          headers: createHeaders(),
          body: JSON.stringify({ error: "Unauthorized: Missing bearer token." }),
      };
  }

  const clientId = process.env.WORKOS_CLIENT_ID;
  if (!clientId) {
      console.error("WORKOS_CLIENT_ID environment variable is not set.");
      return {
          statusCode: 500, 
          headers: createHeaders(),
          body: JSON.stringify({ error: "Internal server configuration error." }),
      };
  }

  try {
      const userId = await getUserId(token);
      if (!userId) {
          console.error("JWT validated but 'sub' (User ID) claim is missing.");
          return {
              statusCode: 401,
              headers: createHeaders(),
              body: JSON.stringify({ error: "Unauthorized: Invalid token claims." }),
          };
      } 

      console.log(`JWT validated successfully for user ID: ${userId}`);

      // STEP 5: Query YOUR database using the validated User ID
      const result = await getPool().query(
          "SELECT id, email, first_name, last_name, profile_picture_url, has_completed_onboarding FROM users WHERE id = $1",
          [userId]
      );

      if (result.rows.length === 0) {
          console.error(`User with validated ID ${userId} not found in the database.`);
          return {
              statusCode: 404,
              headers: createHeaders(),
              body: JSON.stringify({ error: "User not found in application database" }),
          };
      }

      const dbUser = result.rows[0];

      // STEP 6: Return the user data from your database
      return {
          statusCode: 200,
          headers: createHeaders(),
          body: JSON.stringify({
              user: {
                  id: dbUser.id,
                  email: dbUser.email,
                  firstName: dbUser.first_name,
                  lastName: dbUser.last_name,
                  profilePictureUrl: dbUser.profile_picture_url,
                  hasCompletedOnboarding: dbUser.has_completed_onboarding
              }
          }),
      };

  } catch (error: any) {
      // Catch JWT validation errors (expired, invalid signature, wrong issuer/audience)
      // or other errors
      console.error("Error during JWT validation or processing:", error.message || error);
      return {
          statusCode: 401, // Typically 401 for authentication/token validation errors
          headers: createHeaders(),
          body: JSON.stringify({ error: `Unauthorized: ${error.message}` }), // Provide specific error in logs, generic one to client
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
  callback: tokenHandler,
  me: meHandler,
  logout: logoutHandler,
};