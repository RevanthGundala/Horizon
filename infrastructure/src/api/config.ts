import * as aws from "@pulumi/aws";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { createHeaders } from "./utils/auth-utils";

/**
 * Configuration handler - returns non-sensitive configuration for the frontend
 */
export const configHandler: aws.lambda.EventHandler<APIGatewayProxyEvent, APIGatewayProxyResult> = 
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    // Handle OPTIONS request for CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: createHeaders(),
        body: '',
      };
    }

    try {
      // Only include non-sensitive configuration values here
      const config = {
        apiUrl: process.env.API_URL || '',
        environment: process.env.NODE_ENV || 'development',
      };

      return {
        statusCode: 200,
        headers: {
          ...createHeaders(),
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        body: JSON.stringify(config),
      };
    } catch (error) {
      console.error("Config error:", error);
      return {
        statusCode: 500,
        headers: createHeaders(),
        body: JSON.stringify({ error: "Failed to retrieve configuration" }),
      };
    }
};

// Export the API handler
export const configApi = {
  getConfig: configHandler,
};
