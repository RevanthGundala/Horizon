import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { WorkOS } from "@workos-inc/node";
import * as cookie from "cookie";

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

// Initialize WorkOS client
export const workos = new WorkOS(process.env.WORKOS_API_KEY || "", {
  clientId: process.env.WORKOS_CLIENT_ID || "",
});

// Type guard to check if authentication was successful
export function isAuthSuccess(result: any): result is { authenticated: true; user: any } {
  return result.authenticated === true && result.user !== undefined;
}

// Helper function to create standardized headers
export const createHeaders = (
  additionalHeaders: Record<string, string> = {}
): Record<string, string> => {
  // For development, allow localhost:5173 explicitly
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": frontendUrl,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token",
    "Access-Control-Allow-Credentials": "true", // Important for cookies
    ...additionalHeaders,
  };
};

// Create a session cookie
export const createSessionCookie = (sealedSession: string): string => {
  return cookie.serialize("wos-session", sealedSession || "", {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });
};

// Create a clear cookie to remove the session
export const createClearCookie = (): string => {
  return cookie.serialize("wos-session", "", {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 0,
  });
};

// Parse cookies from request headers
export const parseCookies = (cookieHeader?: string): Record<string, string> => {
  return cookieHeader ? cookie.parse(cookieHeader) : {};
};

// Load and authenticate a session
export const loadAndAuthenticateSession = async (sessionData: string): Promise<any> => {
  if (!sessionData) {
    return { authenticated: false, reason: "no_session_cookie_provided" };
  }

  try {
    const session = workos.userManagement.loadSealedSession({
      sessionData,
      cookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
    });

    return await session.authenticate();
  } catch (error) {
    console.error("Session authentication error:", error);
    return { authenticated: false, reason: "authentication_error" };
  }
};

// Refresh a session
export const refreshSession = async (sessionData: string): Promise<any> => {
  try {
    const session = workos.userManagement.loadSealedSession({
      sessionData,
      cookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
    });

    return await session.refresh();
  } catch (error) {
    console.error("Session refresh error:", error);
    return { authenticated: false, reason: "refresh_error" };
  }
};
