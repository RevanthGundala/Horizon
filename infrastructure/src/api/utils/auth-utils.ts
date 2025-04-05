import { WorkOS } from "@workos-inc/node";
import * as cookie from "cookie";

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
