import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { 
  workos, 
  isAuthSuccess, 
  createHeaders, 
  createSessionCookie, 
  createClearCookie, 
  parseCookies, 
  loadAndAuthenticateSession, 
  refreshSession 
} from "../utils/auth-utils";

/**
 * Authentication middleware for Lambda functions
 * @param handler The Lambda handler to wrap with authentication
 * @returns A new handler that includes authentication
 */
export const withAuth = (
  handler: (event: APIGatewayProxyEvent, user: any) => Promise<APIGatewayProxyResult>
) => {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const cookies = parseCookies(event.headers.cookie);
    const sessionData = cookies["wos-session"] || "";
    const frontendUrl = process.env.FRONTEND_URL || "/";

    // If no session cookie is provided, redirect to login
    if (!sessionData) {
      return {
        statusCode: 302,
        headers: createHeaders({ "Location": `${frontendUrl}/login` }),
        body: JSON.stringify({ error: "Authentication required" }),
      };
    }

    try {
      // Load and authenticate the session
      const authResult = await loadAndAuthenticateSession(sessionData);

      if (isAuthSuccess(authResult)) {
        // Pass the authenticated user to the handler
        return handler(event, authResult.user);
      }

      // If the session is invalid, attempt to refresh
      try {
        const refreshResult = await refreshSession(sessionData);

        if (!refreshResult.authenticated) {
          return {
            statusCode: 302,
            headers: createHeaders({ "Location": `${frontendUrl}/login` }),
            body: JSON.stringify({ error: "Authentication failed" }),
          };
        }

        // Update the cookie with the refreshed session
        const refreshedCookie = createSessionCookie(refreshResult.sealedSession || "");

        // Get the user from the refreshed session
        const refreshedAuthResult = await loadAndAuthenticateSession(refreshResult.sealedSession || "");

        // Check if authentication was successful
        if (!isAuthSuccess(refreshedAuthResult)) {
          return {
            statusCode: 302,
            headers: createHeaders({ 
              "Location": `${frontendUrl}/login`,
              "Set-Cookie": refreshedCookie
            }),
            body: JSON.stringify({ error: "Authentication failed after refresh" }),
          };
        }

        // Call the handler with the refreshed user
        const result = await handler(event, refreshedAuthResult.user);

        // Add the refreshed session cookie to the response
        return {
          ...result,
          headers: {
            ...result.headers,
            "Set-Cookie": refreshedCookie,
          },
        };
      } catch (e) {
        console.error("Session refresh error:", e);
        
        // Clear the cookie and redirect to login
        const clearCookie = createClearCookie();

        return {
          statusCode: 302,
          headers: createHeaders({ 
            "Location": `${frontendUrl}/login`,
            "Set-Cookie": clearCookie
          }),
          body: JSON.stringify({ error: "Authentication failed" }),
        };
      }
    } catch (error) {
      console.error("Authentication error:", error);
      
      // Clear the cookie and redirect to login
      const clearCookie = createClearCookie();

      return {
        statusCode: 302,
        headers: createHeaders({ 
          "Location": `${frontendUrl}/login`,
          "Set-Cookie": clearCookie
        }),
        body: JSON.stringify({ error: "Authentication error" }),
      };
    }
  };
};
