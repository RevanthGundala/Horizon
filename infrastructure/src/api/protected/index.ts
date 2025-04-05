import * as aws from "@pulumi/aws";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { withAuth } from "../middleware/auth";
import { createHeaders } from "../utils/auth-utils";

/**
 * Example of a protected endpoint that requires authentication
 */
const protectedHandler = async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 200,
    headers: createHeaders(),
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

// Export the API handlers
export const protectedApi = {
  getData: handler,
};
