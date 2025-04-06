"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.userApi = exports.handler = void 0;
const auth_1 = require("../middleware/auth");
const pg_1 = require("pg");
// Helper function to create consistent headers
function createHeaders() {
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": process.env.FRONTEND_URL || "http://localhost:5173",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token",
        "Access-Control-Allow-Credentials": "true"
    };
}
// Handler that returns user data (protected by auth)
const userHandler = (event, user) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Connect to the database
        const client = new pg_1.Client({
            host: process.env.DB_HOST,
            port: 5432,
            database: process.env.DB_NAME || "horizon",
            user: process.env.DB_USER || "postgres",
            password: process.env.DB_PASSWORD,
        });
        yield client.connect();
        try {
            // Query the database for the user
            const result = yield client.query("SELECT * FROM users WHERE id = $1", [user.id]);
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
        }
        finally {
            // Always close the database connection
            yield client.end();
        }
    }
    catch (error) {
        console.error("Error fetching user from database:", error);
        return {
            statusCode: 500,
            headers: createHeaders(),
            body: JSON.stringify({ error: "Failed to fetch user data" }),
        };
    }
});
// Wrap the handler with authentication middleware
exports.handler = (0, auth_1.withAuth)(userHandler);
exports.userApi = {
    user: exports.handler,
};
//# sourceMappingURL=user.js.map