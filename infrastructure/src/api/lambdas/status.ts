import * as aws from "@pulumi/aws";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { createHeaders, handleOptions } from "../utils/middleware";

/**
 * Simple status endpoint that returns a 200 OK response
 */
export const handler: aws.lambda.EventHandler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Handle OPTIONS requests for CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return handleOptions(event);
  }

  // Get the origin from the request headers
  const origin = event.headers.origin || event.headers.Origin;
  
  return {
    statusCode: 200,
    headers: createHeaders(origin),
    body: JSON.stringify({
      status: "ok",
      message: "Horizon API is running",
      timestamp: new Date().toISOString(),
    }),
  };
};

export const statusApi = {
  check: handler,
};
