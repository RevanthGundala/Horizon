import * as aws from "@pulumi/aws";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { withAuth } from "../middleware/auth";
import { createHeaders } from "../utils/auth-utils";

/**
 * Protected endpoint to get the current user's profile
 */
const getUserHandler = async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 200,
    headers: createHeaders(),
    body: JSON.stringify({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
      }
    }),
  };
};

// Wrap the handler with authentication middleware
export const handler = withAuth(getUserHandler);

// Export the API handlers
export const userApi = {
  getProfile: handler,
};
