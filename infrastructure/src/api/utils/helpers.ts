import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import type { Pool } from "pg";
import { WorkOS } from "@workos-inc/node";
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

// Define payload type for WorkOS JWTs
interface WorkOSJwtPayload extends JWTPayload {
  sub: string; // user ID
}
export async function getUserId(token: string) {
  const workos = new WorkOS(process.env.WORKOS_API_KEY || "");
  const clientId = process.env.WORKOS_CLIENT_ID || "";
  const jwksUrl = workos.userManagement.getJwksUrl(clientId);
  const JWKS = createRemoteJWKSet(new URL(jwksUrl));

  // STEP 3: Verify the JWT
  // You MUST replace 'EXPECTED_WORKOS_ISSUER' with the actual issuer identifier from WorkOS docs
  const expectedIssuer = 'https://api.workos.com'; // COMMON DEFAULT - VERIFY THIS in WorkOS Docs

  const { payload } = await jwtVerify<WorkOSJwtPayload>(token, JWKS, {
      issuer: expectedIssuer,
      audience: clientId, // Verify audience matches your client ID
  });

  // STEP 4: Extract User ID (Subject claim)
  const userId = payload.sub;

  if (!userId) {
    console.error("JWT validated but 'sub' (User ID) claim is missing.");
    return null;
  }

  return userId;
}


// dynamic pg pool initializer; no closure capture for pool
export function getPool(): Pool {
  const g = globalThis as any;
  if (!g.__pgPool) {
    const { Pool } = require("pg");
    g.__pgPool = new Pool({
      connectionString: process.env.DB_URL || "",
      ssl: { rejectUnauthorized: false },
    });
  }
  return g.__pgPool as Pool;
}