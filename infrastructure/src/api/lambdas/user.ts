import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { withAuth } from "../middleware/auth";
import { Client } from "pg";

// Handler that returns user data (protected by auth)
const userHandler = async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
  try {
    // Connect to the database
    const client = new Client({
      host: process.env.DB_HOST,
      port: 5432,
      database: process.env.DB_NAME || "horizon",
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD,
    });

    await client.connect();

    try {
      // Query the database for the user
      const result = await client.query(
        "SELECT * FROM users WHERE id = $1",
        [user.id]
      );

      if (result.rows.length === 0) {
        return {
          statusCode: 404,
          headers: createHeaders(),
          body: JSON.stringify({ error: "User not found in database" }),
        };
      }

      const dbUser = result.rows[0];

      // Return the user data from our database
      return {
        statusCode: 200,
        headers: createHeaders(),
        body: JSON.stringify({
          user: {
            id: dbUser.id,
            email: dbUser.email,
            firstName: dbUser.first_name || user.firstName,
            lastName: dbUser.last_name || user.lastName,
            profilePictureUrl: user.profilePictureUrl,
            createdAt: dbUser.created_at,
            // Add any other user properties from the database
          }
        }),
      };
    } finally {
      // Always close the database connection
      await client.end();
    }
  } catch (error) {
    console.error("Error fetching user from database:", error);
    return {
      statusCode: 500,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Failed to fetch user data" }),
    };
  }
};

// Wrap the handler with authentication middleware
export const handler = withAuth(userHandler);

export const userApi = {
  user: handler,
};
