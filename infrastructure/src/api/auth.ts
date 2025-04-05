import * as aws from "@pulumi/aws";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import * as querystring from "querystring";
import { 
  workos, 
  createHeaders, 
  createSessionCookie, 
  createClearCookie, 
  parseCookies, 
  loadAndAuthenticateSession 
} from "./utils/auth-utils";

// Helper function to create standardized responses
const createResponse = (
  statusCode: number, 
  body: any, 
  cookies?: string[], 
  location?: string
): APIGatewayProxyResult => {
  const headers = createHeaders();

  // Add cookies if provided
  if (cookies && cookies.length > 0) {
    headers["Set-Cookie"] = cookies.join("; ");
  }

  // Add location header for redirects
  if (location) {
    headers["Location"] = location;
  }

  return {
    statusCode,
    headers,
    body: JSON.stringify(body),
  };
};

/**
 * Login handler - redirects to WorkOS authentication page
 */
export const loginHandler: aws.lambda.EventHandler<APIGatewayProxyEvent, APIGatewayProxyResult> = 
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const redirectUri = process.env.REDIRECT_URI || "";
    const clientId = process.env.WORKOS_CLIENT_ID || "";

    try {
      const authorizationUrl = workos.userManagement.getAuthorizationUrl({
        provider: "authkit",
        redirectUri,
        clientId,
      });

      // Redirect to WorkOS auth page
      return createResponse(302, {}, [], authorizationUrl);
    } catch (error) {
      console.error("Login error:", error);
      return createResponse(500, { error: "Failed to initiate login process" });
    }
};

/**
 * Callback handler - processes the authentication code from WorkOS
 */
export const callbackHandler: aws.lambda.EventHandler<APIGatewayProxyEvent, APIGatewayProxyResult> = 
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Get the code from query parameters
    const queryParams = event.queryStringParameters || {};
    const code = queryParams.code || "";
    const frontendUrl = process.env.FRONTEND_URL || "/";

    if (!code) {
      return createResponse(400, { error: "No code provided" });
    }

    try {
      const authenticateResponse = await workos.userManagement.authenticateWithCode({
        clientId: process.env.WORKOS_CLIENT_ID || "",
        code,
        session: {
          sealSession: true,
          cookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
        },
      });

      const { user, sealedSession } = authenticateResponse;

      // Create secure cookie with the session
      const sessionCookie = createSessionCookie(sealedSession || "");

      // Redirect to the frontend with the session cookie
      return createResponse(302, { success: true, user }, [sessionCookie], frontendUrl);
    } catch (error) {
      console.error("Authentication error:", error);
      return createResponse(302, { error: "Authentication failed" }, [], `${frontendUrl}/login`);
    }
};

/**
 * Logout handler - clears the session cookie and redirects to WorkOS logout
 */
export const logoutHandler: aws.lambda.EventHandler<APIGatewayProxyEvent, APIGatewayProxyResult> = 
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const cookies = parseCookies(event.headers.cookie);
      const sessionData = cookies["wos-session"] || "";
      const frontendUrl = process.env.FRONTEND_URL || "/";

      if (!sessionData) {
        return createResponse(302, {}, [], frontendUrl);
      }

      const session = workos.userManagement.loadSealedSession({
        sessionData,
        cookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
      });

      const logoutUrl = await session.getLogoutUrl();

      // Clear the session cookie
      const clearCookie = createClearCookie();

      return createResponse(302, {}, [clearCookie], logoutUrl);
    } catch (error) {
      console.error("Logout error:", error);
      const frontendUrl = process.env.FRONTEND_URL || "/";
      
      // Clear the cookie anyway
      const clearCookie = createClearCookie();

      return createResponse(302, {}, [clearCookie], frontendUrl);
    }
};

// Export the API handlers
export const authApi = {
  login: loginHandler,
  callback: callbackHandler,
  logout: logoutHandler,
};
