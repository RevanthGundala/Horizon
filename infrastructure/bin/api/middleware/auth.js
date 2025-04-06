"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
exports.refreshSession = exports.loadAndAuthenticateSession = exports.parseCookies = exports.createClearCookie = exports.createSessionCookie = exports.createHeaders = exports.workos = exports.getWorkOSClient = exports.withAuth = void 0;
exports.isAuthSuccess = isAuthSuccess;
const node_1 = require("@workos-inc/node");
const cookie = __importStar(require("cookie"));
const config_1 = require("../utils/config");
/**
 * Authentication middleware for Lambda functions
 * @param handler The Lambda handler to wrap with authentication
 * @returns A new handler that includes authentication
 */
const withAuth = (handler) => {
    return (event) => __awaiter(void 0, void 0, void 0, function* () {
        const cookies = (0, exports.parseCookies)(event.headers.cookie);
        const sessionData = cookies["wos-session"] || "";
        const frontendUrl = config_1.config.frontendUrl || "/";
        // If no session cookie is provided, redirect to login
        if (!sessionData) {
            return {
                statusCode: 302,
                headers: (0, exports.createHeaders)({ "Location": `${frontendUrl}/login` }),
                body: JSON.stringify({ error: "Authentication required" }),
            };
        }
        try {
            // Load and authenticate the session
            const authResult = yield (0, exports.loadAndAuthenticateSession)(sessionData);
            if (isAuthSuccess(authResult)) {
                // Pass the authenticated user to the handler
                return handler(event, authResult.user);
            }
            // If the session is invalid, attempt to refresh
            try {
                const refreshResult = yield (0, exports.refreshSession)(sessionData);
                if (!refreshResult.authenticated) {
                    return {
                        statusCode: 302,
                        headers: (0, exports.createHeaders)({ "Location": `${frontendUrl}/login` }),
                        body: JSON.stringify({ error: "Authentication failed" }),
                    };
                }
                // Update the cookie with the refreshed session
                const refreshedCookie = (0, exports.createSessionCookie)(refreshResult.sealedSession || "");
                // Get the user from the refreshed session
                const refreshedAuthResult = yield (0, exports.loadAndAuthenticateSession)(refreshResult.sealedSession || "");
                // Check if authentication was successful
                if (!isAuthSuccess(refreshedAuthResult)) {
                    return {
                        statusCode: 302,
                        headers: (0, exports.createHeaders)({
                            "Location": `${frontendUrl}/login`,
                            "Set-Cookie": refreshedCookie
                        }),
                        body: JSON.stringify({ error: "Authentication failed after refresh" }),
                    };
                }
                // Call the handler with the refreshed user
                const result = yield handler(event, refreshedAuthResult.user);
                // Add the refreshed session cookie to the response
                return Object.assign(Object.assign({}, result), { headers: Object.assign(Object.assign({}, result.headers), { "Set-Cookie": refreshedCookie }) });
            }
            catch (e) {
                console.error("Session refresh error:", e);
                // Clear the cookie and redirect to login
                const clearCookie = (0, exports.createClearCookie)();
                return {
                    statusCode: 302,
                    headers: (0, exports.createHeaders)({
                        "Location": `${frontendUrl}/login`,
                        "Set-Cookie": clearCookie
                    }),
                    body: JSON.stringify({ error: "Authentication failed" }),
                };
            }
        }
        catch (error) {
            console.error("Authentication error:", error);
            // Clear the cookie and redirect to login
            const clearCookie = (0, exports.createClearCookie)();
            return {
                statusCode: 302,
                headers: (0, exports.createHeaders)({
                    "Location": `${frontendUrl}/login`,
                    "Set-Cookie": clearCookie
                }),
                body: JSON.stringify({ error: "Authentication error" }),
            };
        }
    });
};
exports.withAuth = withAuth;
// Initialize WorkOS client - this will only be used at runtime in Lambda
// At build time, we just create a placeholder that will be replaced with the actual values
const getWorkOSClient = () => {
    return new node_1.WorkOS(config_1.config.workosApiKey, {
        clientId: config_1.config.workosClientId,
    });
};
exports.getWorkOSClient = getWorkOSClient;
// Use a getter function to ensure we only create the client when needed
exports.workos = (0, exports.getWorkOSClient)();
// Type guard to check if authentication was successful
function isAuthSuccess(result) {
    return result.authenticated === true && result.user !== undefined;
}
// Helper function to create standardized headers
const createHeaders = (additionalHeaders = {}) => {
    // For development, allow localhost:5173 explicitly
    const frontendUrl = config_1.config.frontendUrl || "http://localhost:5173";
    return Object.assign({ "Content-Type": "application/json", "Access-Control-Allow-Origin": frontendUrl, "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token", "Access-Control-Allow-Credentials": "true" }, additionalHeaders);
};
exports.createHeaders = createHeaders;
// Create a session cookie
const createSessionCookie = (sealedSession) => {
    return cookie.serialize("wos-session", sealedSession || "", {
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60, // 7 days
    });
};
exports.createSessionCookie = createSessionCookie;
// Create a clear cookie to remove the session
const createClearCookie = () => {
    return cookie.serialize("wos-session", "", {
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 0,
    });
};
exports.createClearCookie = createClearCookie;
// Parse cookies from request headers
const parseCookies = (cookieHeader) => {
    return cookieHeader ? cookie.parse(cookieHeader) : {};
};
exports.parseCookies = parseCookies;
// Load and authenticate a session
const loadAndAuthenticateSession = (sessionData) => __awaiter(void 0, void 0, void 0, function* () {
    if (!sessionData) {
        return { authenticated: false, reason: "no_session_cookie_provided" };
    }
    try {
        const session = exports.workos.userManagement.loadSealedSession({
            sessionData,
            cookiePassword: config_1.config.workosCookiePassword,
        });
        return yield session.authenticate();
    }
    catch (error) {
        console.error("Session authentication error:", error);
        return { authenticated: false, reason: "authentication_error" };
    }
});
exports.loadAndAuthenticateSession = loadAndAuthenticateSession;
// Refresh a session
const refreshSession = (sessionData) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const session = exports.workos.userManagement.loadSealedSession({
            sessionData,
            cookiePassword: config_1.config.workosCookiePassword,
        });
        return yield session.refresh();
    }
    catch (error) {
        console.error("Session refresh error:", error);
        return { authenticated: false, reason: "refresh_error" };
    }
});
exports.refreshSession = refreshSession;
//# sourceMappingURL=auth.js.map