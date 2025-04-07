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
exports.statusApi = exports.handler = void 0;
const middleware_1 = require("../utils/middleware");
/**
 * Simple status endpoint that returns a 200 OK response
 */
const handler = (event) => __awaiter(void 0, void 0, void 0, function* () {
    // Handle OPTIONS requests for CORS preflight
    if (event.httpMethod === "OPTIONS") {
        return (0, middleware_1.handleOptions)(event);
    }
    // Get the origin from the request headers
    const origin = event.headers.origin || event.headers.Origin;
    return {
        statusCode: 200,
        headers: (0, middleware_1.createHeaders)(origin),
        body: JSON.stringify({
            status: "ok",
            message: "Horizon API is running",
            timestamp: new Date().toISOString(),
        }),
    };
});
exports.handler = handler;
exports.statusApi = {
    check: exports.handler,
};
//# sourceMappingURL=status.js.map