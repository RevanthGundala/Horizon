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
exports.authApi = void 0;
const pg_1 = require("pg");
const middleware_1 = require("../utils/middleware");
const node_1 = require("@workos-inc/node");
const loginHandler = (event) => __awaiter(void 0, void 0, void 0, function* () {
    // Handle OPTIONS requests for CORS preflight
    if (event.httpMethod === "OPTIONS") {
        return (0, middleware_1.handleOptions)(event);
    }
    const clientId = process.env.WORKOS_CLIENT_ID || "";
    try {
        const workos = new node_1.WorkOS(process.env.WORKOS_API_KEY || "", {
            clientId,
        });
        // Create the authorization URL
        const authorizationUrl = workos.userManagement.getAuthorizationUrl({
            // Specify that we'd like AuthKit to handle the authentication flow
            provider: 'authkit',
            // The callback endpoint that WorkOS will redirect to after a user authenticates
            redirectUri: `${process.env.API_URL}/api/auth/callback`,
            clientId,
        });
        console.log('Authorization URL:', authorizationUrl);
        return {
            statusCode: 302,
            headers: {
                "Location": authorizationUrl,
                "Access-Control-Allow-Origin": "*",
            },
            body: ""
        };
    }
    catch (error) {
        console.error('Error generating authorization URL:', error);
        return {
            statusCode: 500,
            headers: (0, middleware_1.createHeaders)(),
            body: JSON.stringify({
                error: 'Failed to generate authorization URL',
                details: error instanceof Error ? error.message : String(error)
            }),
        };
    }
});
const callbackHandler = (event) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    // Handle OPTIONS requests for CORS preflight
    if (event.httpMethod === "OPTIONS") {
        return (0, middleware_1.handleOptions)(event);
    }
    // Get the origin from the request headers
    const origin = event.headers.origin || event.headers.Origin;
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const code = (_a = event.queryStringParameters) === null || _a === void 0 ? void 0 : _a.code;
    const clientId = process.env.WORKOS_CLIENT_ID || "";
    if (!code) {
        return {
            statusCode: 400,
            headers: (0, middleware_1.createHeaders)(origin),
            body: JSON.stringify({ error: "No code provided" }),
        };
    }
    try {
        const workos = new node_1.WorkOS(process.env.WORKOS_API_KEY || "", {
            clientId,
        });
        const { user, sealedSession } = yield workos.userManagement.authenticateWithCode({
            code,
            clientId,
            session: {
                sealSession: true,
                cookiePassword: process.env.WORKOS_COOKIE_PASSWORD || "",
            }
        });
        console.log("WorkOS user:", user);
        // Connect to the database
        const client = new pg_1.Client({
            connectionString: process.env.DB_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });
        yield client.connect();
        try {
            // Check if user already exists by email
            const existingUser = yield client.query("SELECT * FROM users WHERE email = $1", [user.email]);
            if (existingUser.rows.length === 0) {
                // Insert the user with the WorkOS ID
                yield client.query("INSERT INTO users (id, email) VALUES ($1, $2)", [user.id, user.email]);
                console.log(`Created new user: ${user.email} with ID: ${user.id}`);
            }
            else {
                console.log(`User already exists: ${user.email}`);
            }
        }
        finally {
            // Always close the database connection
            yield client.end();
        }
        // Get the domain from the API URL
        const apiUrl = process.env.API_URL || "";
        const domain = apiUrl ? (_b = apiUrl.split('://').pop()) === null || _b === void 0 ? void 0 : _b.split('/')[0] : "";
        // Redirect the user to the homepage
        return {
            statusCode: 302,
            headers: {
                "Location": frontendUrl,
                "Set-Cookie": `wos-session=${sealedSession}; HttpOnly; Path=/; SameSite=None; Secure${domain ? `; Domain=${domain}` : ''}`,
                "Access-Control-Allow-Origin": origin || frontendUrl,
                "Access-Control-Allow-Credentials": "true",
                "Access-Control-Expose-Headers": "Set-Cookie",
            },
            body: "",
        };
    }
    catch (error) {
        console.error('Authentication error:', error);
        // Get the origin here to avoid closure issues
        const origin = event.headers.origin || event.headers.Origin;
        const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
        return {
            statusCode: 302,
            headers: {
                "Location": `${frontendUrl}/login?error=authentication_failed`,
                "Access-Control-Allow-Origin": origin || frontendUrl,
                "Access-Control-Allow-Credentials": "true",
            },
            body: "",
        };
    }
});
const meHandler = (event) => __awaiter(void 0, void 0, void 0, function* () {
    // This handler is wrapped by withAuth middleware, so if we get here, the user is authenticated
    try {
        // Get the session cookie
        const cookies = (0, middleware_1.parseCookies)(event.headers.cookie || event.headers.Cookie);
        const sessionData = cookies["wos-session"] || "";
        console.log("Session data:", sessionData);
        if (!sessionData) {
            return {
                statusCode: 401,
                headers: (0, middleware_1.createHeaders)(event.headers.origin || event.headers.Origin),
                body: JSON.stringify({
                    authenticated: false,
                    error: "No session cookie found"
                }),
            };
        }
        // Load and authenticate the session
        const authResult = yield (0, middleware_1.loadAndAuthenticateSession)(sessionData);
        console.log("Auth result:", authResult);
        if (!authResult || !authResult.user || !authResult.user.id) {
            return {
                statusCode: 401,
                headers: (0, middleware_1.createHeaders)(event.headers.origin || event.headers.Origin),
                body: JSON.stringify({
                    authenticated: false,
                    error: "Invalid session"
                }),
            };
        }
        console.log("Authenticated user:", authResult.user);
        return {
            statusCode: 200,
            headers: (0, middleware_1.createHeaders)(event.headers.origin || event.headers.Origin),
            body: JSON.stringify({
                userId: authResult.user.id
            }),
        };
    }
    catch (error) {
        console.error("Error in me handler:", error);
        return {
            statusCode: 500,
            headers: (0, middleware_1.createHeaders)(event.headers.origin || event.headers.Origin),
            body: JSON.stringify({
                authenticated: false,
                error: "Server error"
            }),
        };
    }
});
const logoutHandler = (event) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    // Handle OPTIONS requests for CORS preflight
    if (event.httpMethod === "OPTIONS") {
        return (0, middleware_1.handleOptions)(event);
    }
    // Get the origin and frontend URL
    const origin = event.headers.origin || event.headers.Origin;
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const apiUrl = process.env.API_URL || "";
    // Extract domain from API URL if available
    const apiDomain = apiUrl ? (_a = apiUrl.split('://').pop()) === null || _a === void 0 ? void 0 : _a.split('/')[0] : "";
    console.log("Logout request received, origin:", origin);
    console.log("Cookies in logout request:", event.headers.cookie || event.headers.Cookie);
    // Create headers object
    const headers = {
        "Location": `${frontendUrl}/login`,
        "Access-Control-Allow-Origin": origin || frontendUrl,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Expose-Headers": "Set-Cookie",
    };
    // Set cookie clearing header with domain attribute matching how it was set
    if (apiDomain) {
        headers["Set-Cookie"] = `wos-session=; HttpOnly; Path=/; Max-Age=0; SameSite=None; Secure; Domain=${apiDomain}`;
    }
    else {
        headers["Set-Cookie"] = "wos-session=; HttpOnly; Path=/; Max-Age=0; SameSite=None; Secure";
    }
    // Return success with cookie clearing headers
    return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ success: true }),
    };
});
exports.authApi = {
    login: loginHandler,
    callback: callbackHandler,
    logout: logoutHandler,
    me: meHandler,
};
//# sourceMappingURL=auth.js.map