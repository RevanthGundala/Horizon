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
const node_1 = require("@workos-inc/node");
const pg_1 = require("pg");
const auth_1 = require("../middleware/auth");
const config_1 = require("../utils/config");
const workos = new node_1.WorkOS(config_1.config.workosApiKey, {
    clientId: config_1.config.workosClientId,
});
// Helper function to create consistent headers
const createHeaders = () => {
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": config_1.config.frontendUrl,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token",
        "Access-Control-Allow-Credentials": "true"
    };
};
const loginHandler = (event) => __awaiter(void 0, void 0, void 0, function* () {
    const authorizationUrl = workos.userManagement.getAuthorizationUrl({
        // Specify that we'd like AuthKit to handle the authentication flow
        provider: 'authkit',
        // The callback endpoint that WorkOS will redirect to after a user authenticates
        redirectUri: `${config_1.config.frontendUrl}/callback`,
        clientId: config_1.config.workosClientId,
    });
    // Redirect the user to the AuthKit sign-in page
    return {
        statusCode: 302,
        headers: {
            Location: authorizationUrl,
        },
        body: '',
    };
});
const callbackHandler = (event) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const code = (_a = event.queryStringParameters) === null || _a === void 0 ? void 0 : _a.code;
    if (!code) {
        return {
            statusCode: 400,
            headers: createHeaders(),
            body: JSON.stringify({ error: "No code provided" }),
        };
    }
    try {
        const { user } = yield workos.userManagement.authenticateWithCode({
            code,
            clientId: config_1.config.workosClientId,
        });
        // Connect to the database
        const client = new pg_1.Client({
            host: config_1.config.dbHost,
            port: 5432,
            database: config_1.config.dbName || "horizon",
            user: config_1.config.dbUser || "postgres",
            password: config_1.config.dbPassword,
        });
        yield client.connect();
        try {
            // Check if user already exists
            const existingUser = yield client.query("SELECT * FROM users WHERE email = $1", [user.email]);
            if (existingUser.rows.length === 0) {
                // Add the user to our users db in RDS
                yield client.query("INSERT INTO users (id, email, name, created_at) VALUES ($1, $2, $3, NOW())", [user.id, user.email, user.firstName || "", user.lastName || ""]);
                console.log(`Created new user: ${user.email}`);
            }
            else {
                console.log(`User already exists: ${user.email}`);
            }
        }
        finally {
            // Always close the database connection
            yield client.end();
        }
        // Redirect the user to the homepage
        return {
            statusCode: 302,
            headers: {
                Location: `${config_1.config.frontendUrl}`,
            },
            body: '',
        };
    }
    catch (error) {
        console.error("Authentication error:", error);
        return {
            statusCode: 500,
            headers: createHeaders(),
            body: JSON.stringify({ error: "Authentication failed" }),
        };
    }
});
const logoutHandler = (event) => __awaiter(void 0, void 0, void 0, function* () {
    const cookies = (0, auth_1.parseCookies)(event.headers.cookie);
    const sessionData = cookies["wos-session"] || "";
    const session = workos.userManagement.loadSealedSession({
        sessionData,
        cookiePassword: config_1.config.workosCookiePassword,
    });
    const url = yield session.getLogoutUrl();
    // Instead of using res.clearCookie, set an expired cookie in the response headers
    return {
        statusCode: 302,
        headers: Object.assign({ Location: url, "Set-Cookie": "wos-session=; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT" }, createHeaders()),
        body: '',
    };
});
exports.authApi = {
    login: loginHandler,
    callback: callbackHandler,
    logout: logoutHandler,
};
//# sourceMappingURL=auth.js.map