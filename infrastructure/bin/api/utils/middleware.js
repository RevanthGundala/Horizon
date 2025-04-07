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
exports.refreshSession = exports.loadAndAuthenticateSession = exports.parseCookies = exports.createClearCookie = exports.createSessionCookie = exports.withAuth = exports.handleOptions = exports.createHeaders = void 0;
exports.isAuthSuccess = isAuthSuccess;
const node_1 = require("@workos-inc/node");
const cookie = __importStar(require("cookie"));
const createHeaders = (origin) => {
    // Get the frontend URL from environment variables
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    // Use the provided origin or default to the frontend URL
    const allowOrigin = origin || frontendUrl;
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Amz-Date, X-Api-Key, X-Amz-Security-Token",
        "Access-Control-Allow-Credentials": "true"
    };
};
exports.createHeaders = createHeaders;
// Handler for OPTIONS requests (CORS preflight)
const handleOptions = (event) => __awaiter(void 0, void 0, void 0, function* () {
    // Get the origin from the request headers
    const origin = event.headers.origin || event.headers.Origin || process.env.FRONTEND_URL;
    return {
        statusCode: 200,
        headers: (0, exports.createHeaders)(origin),
        body: ""
    };
});
exports.handleOptions = handleOptions;
// --- Authentication Middleware ---
const withAuth = (handler) => {
    return (event) => __awaiter(void 0, void 0, void 0, function* () {
        // Handle OPTIONS requests for CORS preflight
        if (event.httpMethod === "OPTIONS") {
            return (0, exports.handleOptions)(event);
        }
        const cookies = (0, exports.parseCookies)(event.headers.cookie || event.headers.Cookie); // Handle potential case difference
        const sessionData = cookies["wos-session"] || "";
        // Read FRONTEND_URL from process.env at runtime
        const frontendUrl = process.env.FRONTEND_URL;
        if (!frontendUrl) {
            console.error("FRONTEND_URL environment variable is not set.");
            // Return an error or fallback, but ideally it should always be set
            return {
                statusCode: 500,
                headers: (0, exports.createHeaders)(event.headers.origin || event.headers.Origin),
                body: JSON.stringify({ error: "Internal configuration error" })
            };
        }
        const loginRedirectUrl = `${frontendUrl}/login`;
        if (!sessionData) {
            return {
                statusCode: 302,
                headers: (0, exports.createHeaders)(event.headers.origin || event.headers.Origin),
                body: JSON.stringify({ error: "Authentication required" }),
            };
        }
        try {
            // Use the potentially updated loadAndAuthenticateSession function
            const authResult = yield (0, exports.loadAndAuthenticateSession)(sessionData);
            if (isAuthSuccess(authResult)) {
                return handler(event, authResult.user);
            }
            // Attempt refresh
            try {
                // Use the potentially updated refreshSession function
                const refreshResult = yield (0, exports.refreshSession)(sessionData);
                if (!refreshResult.authenticated || !refreshResult.sealedSession) {
                    // Clear cookie if refresh fails completely
                    const clearCookieHeader = (0, exports.createClearCookie)();
                    return {
                        statusCode: 302,
                        headers: (0, exports.createHeaders)(event.headers.origin || event.headers.Origin),
                        body: JSON.stringify({ error: "Authentication failed" }),
                    };
                }
                const refreshedCookie = (0, exports.createSessionCookie)(refreshResult.sealedSession);
                const refreshedAuthResult = yield (0, exports.loadAndAuthenticateSession)(refreshResult.sealedSession);
                if (!isAuthSuccess(refreshedAuthResult)) {
                    // Clear cookie even if refresh *seemed* ok but auth failed
                    const clearCookieHeader = (0, exports.createClearCookie)();
                    return {
                        statusCode: 302,
                        headers: (0, exports.createHeaders)(event.headers.origin || event.headers.Origin),
                        body: JSON.stringify({ error: "Authentication failed after refresh" }),
                    };
                }
                const result = yield handler(event, refreshedAuthResult.user);
                return Object.assign(Object.assign({}, result), { headers: Object.assign(Object.assign(Object.assign({}, result.headers), (0, exports.createHeaders)(event.headers.origin || event.headers.Origin)), { "Set-Cookie": refreshedCookie }) });
            }
            catch (e) {
                console.error("Session refresh error:", e);
                const clearCookieHeader = (0, exports.createClearCookie)();
                return {
                    statusCode: 302,
                    headers: (0, exports.createHeaders)(event.headers.origin || event.headers.Origin),
                    body: JSON.stringify({ error: "Authentication failed during refresh" }),
                };
            }
        }
        catch (error) {
            console.error("Authentication error:", error);
            const clearCookieHeader = (0, exports.createClearCookie)();
            return {
                statusCode: 302,
                headers: (0, exports.createHeaders)(event.headers.origin || event.headers.Origin),
                body: JSON.stringify({ error: "Authentication error" }),
            };
        }
    });
};
exports.withAuth = withAuth;
// --- Helper Functions ---
function isAuthSuccess(result) {
    return (result === null || result === void 0 ? void 0 : result.authenticated) === true && result.user !== undefined;
}
const createSessionCookie = (sealedSession) => {
    // Add checks if needed
    return cookie.serialize("wos-session", sealedSession || "", { /* ... */});
};
exports.createSessionCookie = createSessionCookie;
const createClearCookie = () => {
    return cookie.serialize("wos-session", "", { /* ... maxAge: 0 ... */});
};
exports.createClearCookie = createClearCookie;
const parseCookies = (cookieHeader) => {
    return cookieHeader ? cookie.parse(cookieHeader) : {};
};
exports.parseCookies = parseCookies;
const loadAndAuthenticateSession = (sessionData) => __awaiter(void 0, void 0, void 0, function* () {
    if (!sessionData) { /* ... */ }
    // Read cookie password from process.env at runtime
    const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD;
    if (!cookiePassword) {
        throw new Error("WORKOS_COOKIE_PASSWORD environment variable is not set.");
    }
    try {
        const workos = new node_1.WorkOS(process.env.WORKOS_API_KEY || "", {
            clientId: process.env.WORKOS_CLIENT_ID || "",
        });
        const session = workos.userManagement.loadSealedSession({
            sessionData,
            cookiePassword, // Use the runtime value
        });
        return yield session.authenticate();
    }
    catch (error) { /* ... */ }
});
exports.loadAndAuthenticateSession = loadAndAuthenticateSession;
const refreshSession = (sessionData) => __awaiter(void 0, void 0, void 0, function* () {
    // Read cookie password from process.env at runtime
    const cookiePassword = process.env.WORKOS_COOKIE_PASSWORD;
    if (!cookiePassword) {
        throw new Error("WORKOS_COOKIE_PASSWORD environment variable is not set.");
    }
    try {
        const workos = new node_1.WorkOS(process.env.WORKOS_API_KEY || "", {
            clientId: process.env.WORKOS_CLIENT_ID || "",
        });
        const session = workos.userManagement.loadSealedSession({
            sessionData,
            cookiePassword, // Use the runtime value
        });
        return yield session.refresh();
    }
    catch (error) { /* ... */ }
});
exports.refreshSession = refreshSession;
//# sourceMappingURL=middleware.js.map