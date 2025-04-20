import { WorkOS, RefreshSessionResponse, AuthenticateWithSessionCookieSuccessResponse, AuthenticateWithSessionCookieFailedResponse } from "@workos-inc/node";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import * as cookie from "cookie";

// --- Authentication Middleware ---
export const withAuth = (
  handler: (event: APIGatewayProxyEvent, user: any) => Promise<APIGatewayProxyResult>
) => {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Handle OPTIONS requests for CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return handleOptions(event);
    }

    console.log("AUTH MIDDLEWARE - Starting authentication process");

    // Check for session data in cookies first
    const cookies = parseCookies(event.headers.cookie || event.headers.Cookie); // Handle potential case difference
      
    // Use cookie session data, or bearer token, or empty string
    const sessionData = cookies["wos-session"];

    if (!sessionData) {
      console.log('🔍 AUTH MIDDLEWARE - No session data, authentication required');
      return {
        statusCode: 401,
        headers: createHeaders(event.headers.origin || event.headers.Origin),
        body: JSON.stringify({ error: "Authentication required" }),
      };
    }
    
    console.log('🔍 AUTH MIDDLEWARE - Session data present, proceeding with authentication');
    
    const workos = new WorkOS(process.env.WORKOS_API_KEY || "", {
      clientId: process.env.WORKOS_CLIENT_ID || "",
    });
      
    try {
        const session = workos.userManagement.loadSealedSession({
          sessionData,
          cookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
        });
        
        const authResult = await session.authenticate();
  
        if (isAuthSuccess(authResult)) {
          const userObject = (authResult as AuthenticateWithSessionCookieSuccessResponse).user;
          console.log('🔍 AUTH MIDDLEWARE - User authenticated successfully with WorkOS:', userObject.id);
          return await handler(event, userObject);
        }
  
        // If session is invalid, refresh
        try {
          console.log('🔍 AUTH MIDDLEWARE - Authentication failed, trying refresh');
          const refreshResponse = await session.refresh({
            cookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
          });
      
          if (!isRefreshSuccess(refreshResponse)) {
            console.log('🔍 AUTH MIDDLEWARE - Refresh failed', JSON.stringify(refreshResponse));
            return {
              statusCode: 500,
              headers: createHeaders(event.headers.origin || event.headers.Origin),
              body: JSON.stringify({ error: "Authentication failed", reason: 'refresh_failed' }),
            };
          }
  
          // WorkOS doesn't export success types
          const sealedSession = (refreshResponse as any).sealedSession;
          const user = (refreshResponse as any).user;
      
          // update the cookie
          setCookie({
            sealedSession,
            origin: event.headers.origin || event.headers.Origin,
            user,
            event,
            code: '',
            state: { redirect: '' },
          });
      
          // Call handler with refreshed user object
          console.log('🔍 AUTH MIDDLEWARE - Session refreshed, calling handler with user:', user.id);
          return await handler(event, user);
        } catch (refreshError) {
          console.error('🔍 AUTH MIDDLEWARE - Session refresh error:', refreshError);
          return {
            statusCode: 500,
            headers: createHeaders(event.headers.origin || event.headers.Origin),
            body: JSON.stringify({ error: "Session refresh failed", details: String(refreshError) }),
          };
        }
      } catch (sessionError) {
        console.error('🔍 AUTH MIDDLEWARE - Session loading error:', sessionError);
        return {
          statusCode: 500,
          headers: createHeaders(event.headers.origin || event.headers.Origin),
          body: JSON.stringify({ error: "Invalid session", details: String(sessionError) }),
        };
      }
    } 
  };

// --- Helper Functions ---

export const createHeaders = (origin?: string) => {
  // Get the frontend URL from environment variables
  const frontendUrl = process.env.FRONTEND_URL || "";
  const chatUrl = process.env.CHAT_URL || ""; 
  // Use the provided origin or default to the frontend URL
  const allowOrigin = origin || frontendUrl || chatUrl;
  
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token, Cookie",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Expose-Headers": "Content-Type, Content-Length"
  };
};

// Handler for OPTIONS requests (CORS preflight)
export const handleOptions = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Get the origin from the request headers
  const origin = event.headers.origin || event.headers.Origin || process.env.FRONTEND_URL || process.env.CHAT_URL;
  
  return {
    statusCode: 200,
    headers: createHeaders(origin),
    body: ""
  };
};


function isRefreshSuccess(result: RefreshSessionResponse) {
  return result?.authenticated === true && result.sealedSession !== undefined;
}

export function isAuthSuccess(result: AuthenticateWithSessionCookieSuccessResponse | AuthenticateWithSessionCookieFailedResponse) {
  return result?.authenticated === true && result.user !== undefined;
}

export const parseCookies = (cookieHeader?: string): Record<string, string | undefined> => {
  return cookieHeader ? cookie.parse(cookieHeader) : {};
};

interface SetCookieOptions {
  sealedSession: string | undefined;
  origin: string | undefined;
  user: any;
  event: APIGatewayProxyEvent;
  code: string;
  state: { redirect: string };
}

export function setCookie(options: SetCookieOptions): APIGatewayProxyResult {  
    const chatUrl = process.env.CHAT_URL || "";
    if(!chatUrl) {
      return {  
        statusCode: 400,
        headers: createHeaders(options.origin || chatUrl),
        body: JSON.stringify({ error: "Chat URL not configured" }),
      };
    }
    if (!options.sealedSession) {
      return {  
        statusCode: 400,
        headers: createHeaders(options.origin || chatUrl),
        body: JSON.stringify({ error: "No sealed session available" }),
      };
    }
    const maxAgeSeconds = 7 * 24 * 60 * 60; // 7 days in seconds

    const frontendUrl = process.env.FRONTEND_URL || "";
    if (options.state.redirect === "electron") {
      const headers = {
        "Set-Cookie": `wos-session=${options.sealedSession}; HttpOnly; Path=/; SameSite=None; Secure; Max-Age=${maxAgeSeconds}`,
        "Access-Control-Allow-Origin": options.origin || "http://localhost:5173",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Expose-Headers": "Set-Cookie",
      };
      console.log("BACKEND DEBUG: Electron redirect state:", headers);
      return {
        statusCode: 200,
        headers,
        body: "",
      };
    }
    // Redirect user back to website if request is from web
    console.log("BACKEND DEBUG: Redirecting to settings page");
  return {
    statusCode: 302,
    headers: {
      "Set-Cookie": `wos-session=${options.sealedSession}; HttpOnly; Path=/; SameSite=None; Secure; Max-Age=${maxAgeSeconds}`,
      "Location": `${frontendUrl}/settings`,
      "Access-Control-Allow-Origin": options.origin || "http://localhost:5173",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Expose-Headers": "Set-Cookie",
    },
    body: "",
  };
}
