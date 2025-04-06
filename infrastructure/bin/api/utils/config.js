"use strict";
// Configuration for the API
// This file centralizes all configuration values and makes them available throughout the application
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
// In a real deployment, these would be environment variables in Lambda
// For Pulumi, we're using this to avoid initialization errors during build time
exports.config = {
    // WorkOS configuration
    workosApiKey: process.env.WORKOS_API_KEY || "",
    workosClientId: process.env.WORKOS_CLIENT_ID || "",
    workosCookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
    // Frontend URL for CORS and redirects
    frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
    // API URL
    apiUrl: process.env.API_URL || "",
    // Fireworks API key
    fireworksApiKey: process.env.FIREWORKS_API_KEY || "",
    // Database configuration
    dbHost: process.env.DB_HOST || "",
    dbName: process.env.DB_NAME || "horizon",
    dbUser: process.env.DB_USER || "postgres",
    dbPassword: process.env.DB_PASSWORD || "",
};
//# sourceMappingURL=config.js.map