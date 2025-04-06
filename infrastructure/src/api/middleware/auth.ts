import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { WorkOS } from "@workos-inc/node";
import * as cookie from "cookie";

// REMOVE: import { config } from './config'; // <-- Remove this line

// --- WorkOS Client Handling (Lazy Initialization) ---
// Store the client instance once created
let workosClientInstance: WorkOS | null = null;

function getWorkOSClient(): WorkOS {
  // Check if the client has already been initialized
  if (workosClientInstance) {
    return workosClientInstance;
  }

  // Read environment variables AT RUNTIME
  const apiKey = process.env.WORKOS_API_KEY;
  const clientId = process.env.WORKOS_CLIENT_ID;

  // Validate that environment variables are present (critical for runtime)
  if (!apiKey) {
    throw new Error("WORKOS_API_KEY environment variable is not set.");
  }
  if (!clientId) {
    throw new Error("WORKOS_CLIENT_ID environment variable is not set.");
  }

  // Create and store the instance
  workosClientInstance = new WorkOS(apiKey, { clientId });
  return workosClientInstance;
}

export const createHeaders = () => {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": process.env.frontendUrl || "",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token",
    "Access-Control-Allow-Credentials": "true"
  };
};

// --- Authentication Middleware ---
export const withAuth = (
  handler: (event: APIGatewayProxyEvent, user: any) => Promise<APIGatewayProxyResult>
) => {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const cookies = parseCookies(event.headers.cookie || event.headers.Cookie); // Handle potential case difference
    const sessionData = cookies["wos-session"] || "";

    // Read FRONTEND_URL from process.env at runtime
    const frontendUrl = process.env.FRONTEND_URL;
    if (!frontendUrl) {
       console.error("FRONTEND_URL environment variable is not set.");
       // Return an error or fallback, but ideally it should always be set
       return { statusCode: 500, body: JSON.stringify({ error: "Internal configuration error" }) };
    }

    const loginRedirectUrl = `${frontendUrl}/login`;

    if (!sessionData) {
      return {
        statusCode: 302,
        headers: createHeaders(frontendUrl, { "Location": loginRedirectUrl }), // Pass frontendUrl to createHeaders
        body: JSON.stringify({ error: "Authentication required" }),
      };
    }

    try {
      // Use the potentially updated loadAndAuthenticateSession function
      const authResult = await loadAndAuthenticateSession(sessionData);

      if (isAuthSuccess(authResult)) {
        return handler(event, authResult.user);
      }

      // Attempt refresh
      try {
        // Use the potentially updated refreshSession function
        const refreshResult = await refreshSession(sessionData);

        if (!refreshResult.authenticated || !refreshResult.sealedSession) {
          // Clear cookie if refresh fails completely
           const clearCookieHeader = createClearCookie();
           return {
             statusCode: 302,
             headers: createHeaders(frontendUrl, {
               "Location": loginRedirectUrl,
               "Set-Cookie": clearCookieHeader,
              }),
             body: JSON.stringify({ error: "Authentication failed" }),
           };
        }

        const refreshedCookie = createSessionCookie(refreshResult.sealedSession);
        const refreshedAuthResult = await loadAndAuthenticateSession(refreshResult.sealedSession);

        if (!isAuthSuccess(refreshedAuthResult)) {
          // Clear cookie even if refresh *seemed* ok but auth failed
          const clearCookieHeader = createClearCookie();
          return {
            statusCode: 302,
            headers: createHeaders(frontendUrl, {
              "Location": loginRedirectUrl,
              "Set-Cookie": refreshedCookie, // Send the new (but failed) cookie just in case? Or clear? Let's clear.
              // "Set-Cookie": clearCookieHeader
            }),
            body: JSON.stringify({ error: "Authentication failed after refresh" }),
          };
        }

        const result = await handler(event, refreshedAuthResult.user);
        return {
          ...result,
          headers: {
            ...result.headers, // Preserve original handler headers
            ...createHeaders(frontendUrl), // Add standard CORS/etc headers
            "Set-Cookie": refreshedCookie, // Add the Set-Cookie header
          },
        };
      } catch (e) {
        console.error("Session refresh error:", e);
        const clearCookieHeader = createClearCookie();
        return {
          statusCode: 302,
          headers: createHeaders(frontendUrl, {
             "Location": loginRedirectUrl,
             "Set-Cookie": clearCookieHeader
          }),
          body: JSON.stringify({ error: "Authentication failed during refresh" }),
        };
      }
    } catch (error) {
      console.error("Authentication error:", error);
      const clearCookieHeader = createClearCookie();
      return {
        statusCode: 302,
        headers: createHeaders(frontendUrl, {
           "Location": loginRedirectUrl,
           "Set-Cookie": clearCookieHeader
        }),
        body: JSON.stringify({ error: "Authentication error" }),
      };
    }
  };
};

// --- Helper Functions ---

export function isAuthSuccess(result: any): result is { authenticated: true; user: any } {
  return result?.authenticated === true && result.user !== undefined;
}

export const createSessionCookie = (sealedSession: string): string => {
   // Add checks if needed
   return cookie.serialize("wos-session", sealedSession || "", { /* ... */ });
};

export const createClearCookie = (): string => {
   return cookie.serialize("wos-session", "", { /* ... maxAge: 0 ... */ });
};

export const parseCookies = (cookieHeader?: string): Record<string, string> => {
  return cookieHeader ? cookie.parse(cookieHeader) : {};
};

export const loadAndAuthenticateSession = async (sessionData: string): Promise<any> => {
  if (!sessionData) { /* ... */ }

  // Read cookie password from process.env at runtime
  const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD;
  if (!cookiePassword) {
    throw new Error("WORKOS_COOKIE_PASSWORD environment variable is not set.");
  }

  try {
    const workos = getWorkOSClient(); // Get the lazily initialized client
    const session = workos.userManagement.loadSealedSession({
      sessionData,
      cookiePassword, // Use the runtime value
    });
    return await session.authenticate();
  } catch (error) { /* ... */ }
};

export const refreshSession = async (sessionData: string): Promise<any> => {
   // Read cookie password from process.env at runtime
   const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD;
   if (!cookiePassword) {
     throw new Error("WORKOS_COOKIE_PASSWORD environment variable is not set.");
   }

   try {
     const workos = getWorkOSClient(); // Get the lazily initialized client
     const session = workos.userManagement.loadSealedSession({
       sessionData,
       cookiePassword, // Use the runtime value
     });
     return await session.refresh();
   } catch (error) { /* ... */ }
}