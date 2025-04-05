import * as aws from "@pulumi/aws";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { withAuth } from "./middleware/auth";

/**
 * Example of a protected endpoint that requires authentication
 */
const protectedHandler = async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token"
    },
    body: JSON.stringify({
      message: "This is a protected endpoint",
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      },
      timestamp: new Date().toISOString(),
    }),
  };
};

// Wrap the handler with authentication middleware
export const handler = withAuth(protectedHandler);

export const protectedApi = {
  getData: handler,
};
