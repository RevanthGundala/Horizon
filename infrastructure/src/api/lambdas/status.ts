import * as aws from "@pulumi/aws";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

/**
 * Simple status endpoint that returns a 200 OK response
 */
export const handler: aws.lambda.EventHandler<APIGatewayProxyEvent, APIGatewayProxyResult> = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token"
    },
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
