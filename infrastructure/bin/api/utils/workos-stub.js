"use strict";
// WorkOS stub for Pulumi deployment
// This file provides minimal stubs for WorkOS functionality to satisfy Pulumi's closure compiler
// The actual WorkOS client will be initialized at runtime in the Lambda functions
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
exports.getWorkOSClient = exports.WorkOSStub = void 0;
class WorkOSStub {
    constructor() {
        this.userManagement = {
            getAuthorizationUrl: (options) => 'https://auth.workos.com/authorize',
            authenticateWithCode: () => __awaiter(this, void 0, void 0, function* () {
                return ({
                    user: {
                        id: 'stub-user-id',
                        email: 'user@example.com',
                        firstName: 'Test',
                        lastName: 'User',
                        profilePictureUrl: 'https://example.com/avatar.png'
                    },
                    sealedSession: 'stub-session'
                });
            }),
            loadSealedSession: (options) => __awaiter(this, void 0, void 0, function* () {
                return ({
                    getLogoutUrl: () => __awaiter(this, void 0, void 0, function* () { return 'https://example.com/logout'; })
                });
            })
        };
    }
}
exports.WorkOSStub = WorkOSStub;
const getWorkOSClient = () => {
    // During runtime, this will use the actual WorkOS client
    // During Pulumi compilation, it will use the stub
    try {
        // Try to load the real WorkOS client
        const { WorkOS } = require('@workos-inc/node');
        const apiKey = process.env.WORKOS_API_KEY;
        if (!apiKey) {
            console.warn('WorkOS API key not found, using stub');
            return new WorkOSStub();
        }
        return new WorkOS(apiKey);
    }
    catch (error) {
        console.warn('Failed to load WorkOS client, using stub:', error);
        return new WorkOSStub();
    }
};
exports.getWorkOSClient = getWorkOSClient;
//# sourceMappingURL=workos-stub.js.map