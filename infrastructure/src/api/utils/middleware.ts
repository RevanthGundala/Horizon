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
    
    // Check for session data in cookies first
    const cookies = parseCookies(event.headers.cookie || event.headers.Cookie); // Handle potential case difference
      
    // Use cookie session data, or bearer token, or empty string
    const sessionData = cookies["wos-session"];

    // Read FRONTEND_URL from process.env at runtime
    const frontendUrl = process.env.FRONTEND_URL;
    if (!frontendUrl) {
       console.error("FRONTEND_URL environment variable is not set.");
       // Return an error or fallback, but ideally it should always be set
       return { 
         statusCode: 500, 
         headers: createHeaders(event.headers.origin || event.headers.Origin),
         body: JSON.stringify({ error: "Internal configuration error" }) 
       };
    }


    if (!sessionData) {
      console.log('🔍 AUTH MIDDLEWARE - No session data, authentication required');
      return {
        statusCode: 302,
        headers: createHeaders(event.headers.origin || event.headers.Origin),
        body: JSON.stringify({ error: "Authentication required" }),
      };
    }
    
    console.log('🔍 AUTH MIDDLEWARE - Session data present, proceeding with authentication');

    // Check if this is an Electron request with a JWT-style token
    const isFromElectron = event.headers['X-Electron-App'] === 'true' || 
                         event.headers['x-electron-app'] === 'true';
    
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
              statusCode: 302,
              headers: createHeaders(event.headers.origin || event.headers.Origin),
              body: JSON.stringify({ error: "Authentication failed", reason: 'refresh_failed' }),
            };
          }
  
          // WorkOS doesn't export success types
          const sealedSession = (refreshResponse as any).sealedSession;
          const user = (refreshResponse as any).user;
      
          // update the cookie
          setCookie(sealedSession, event.headers.origin || event.headers.Origin, user, event, '');
      
          // Call handler with refreshed user object
          console.log('🔍 AUTH MIDDLEWARE - Session refreshed, calling handler with user:', user.id);
          return await handler(event, user);
        } catch (refreshError) {
          console.error('🔍 AUTH MIDDLEWARE - Session refresh error:', refreshError);
          return {
            statusCode: 302,
            headers: createHeaders(event.headers.origin || event.headers.Origin),
            body: JSON.stringify({ error: "Session refresh failed", details: String(refreshError) }),
          };
        }
      } catch (sessionError) {
        console.error('🔍 AUTH MIDDLEWARE - Session loading error:', sessionError);
        return {
          statusCode: 302,
          headers: createHeaders(event.headers.origin || event.headers.Origin),
          body: JSON.stringify({ error: "Invalid session", details: String(sessionError) }),
        };
      }
    } 
  };

// --- Helper Functions ---

export const createHeaders = (origin?: string) => {
  // Get the frontend URL from environment variables
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  
  // Use the provided origin or default to the frontend URL
  const allowOrigin = origin || frontendUrl;
  
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
  const origin = event.headers.origin || event.headers.Origin || process.env.FRONTEND_URL;
  
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

export const isElectronRequest = (event: APIGatewayProxyEvent) => event.headers['X-Electron-App'] === 'true' || 
event.headers['x-electron-app'] === 'true';


export function setCookie(sealedSession: string | undefined, origin: string | undefined , user: any, event: APIGatewayProxyEvent, code: string): APIGatewayProxyResult {     // Get the domain from the API URL
    const apiUrl = process.env.API_URL || "";
    const domain = apiUrl ? apiUrl.split('://').pop()?.split('/')[0] : "";
    
    // Check if request is from Electron
    const isFromElectron = origin && (origin.startsWith('electron://') || origin.includes('localhost:5173')) || 
                         isElectronRequest(event) || 
                         event.queryStringParameters?.electron === 'true';
                         
    if (!sealedSession) {
      return {  
        statusCode: 400,
        headers: createHeaders(origin || "http://localhost:5173"),
        body: JSON.stringify({ error: "No sealed session available" }),
      };
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    
    // Include session in the redirect URL for Electron app
    const redirectUrl = isFromElectron 
      ? `horizon://api/auth/callback?code=${code}&session=${encodeURIComponent(sealedSession)}`
      : frontendUrl;
  
  if (isFromElectron) {
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
}
