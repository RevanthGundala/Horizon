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
const middleware_1 = require("../utils/middleware");
const pg_1 = require("pg");
// Handler that returns user data (protected by auth)
const userHandler = (event, user) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Connect to the database
        const client = new pg_1.Client({
            connectionString: process.env.DB_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });
        yield client.connect();
        try {
            // Query the database for the user
            const result = yield client.query("SELECT * FROM users WHERE id = $1", [user.id]);
            if (result.rows.length === 0) {
                return {
                    statusCode: 404,
                    headers: (0, middleware_1.createHeaders)(),
                    body: JSON.stringify({ error: "User not found in database" }),
                };
            }
            const dbUser = result.rows[0];
            // Return the user data from our database
            return {
                statusCode: 200,
                headers: (0, middleware_1.createHeaders)(),
                body: JSON.stringify({
                    user: {
                        id: dbUser.id,
                        email: dbUser.email,
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
            headers: (0, middleware_1.createHeaders)(),
            body: JSON.stringify({ error: "Failed to fetch user data" }),
        };
    }
});
// Wrap the handler with authentication middleware
exports.handler = (0, middleware_1.withAuth)(userHandler);
exports.userApi = {
    user: exports.handler,
};
//# sourceMappingURL=user.js.map