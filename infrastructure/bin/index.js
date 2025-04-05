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
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersTableName = exports.notesTableName = exports.apiEndpoint = void 0;
const aws = __importStar(require("@pulumi/aws"));
const awsx = __importStar(require("@pulumi/awsx"));
// Import our Lambda handlers
const status_1 = require("./api/status");
// Create an API Gateway
const api = new awsx.classic.apigateway.API("horizon-api", {
    routes: [
        // Status endpoint
        {
            path: "/status",
            method: "GET",
            eventHandler: status_1.statusApi.check,
        },
        // Add other routes as they are implemented
    ],
});
// Create a DynamoDB table for notes
const notesTable = new aws.dynamodb.Table("notes", {
    attributes: [
        { name: "id", type: "S" },
        { name: "userId", type: "S" },
    ],
    hashKey: "id",
    globalSecondaryIndexes: [
        {
            name: "userIndex",
            hashKey: "userId",
            projectionType: "ALL",
            readCapacity: 5,
            writeCapacity: 5,
        },
    ],
    billingMode: "PROVISIONED",
    readCapacity: 5,
    writeCapacity: 5,
});
// Create a DynamoDB table for users
const usersTable = new aws.dynamodb.Table("users", {
    attributes: [
        { name: "id", type: "S" },
        { name: "email", type: "S" },
    ],
    hashKey: "id",
    globalSecondaryIndexes: [
        {
            name: "emailIndex",
            hashKey: "email",
            projectionType: "ALL",
            readCapacity: 5,
            writeCapacity: 5,
        },
    ],
    billingMode: "PROVISIONED",
    readCapacity: 5,
    writeCapacity: 5,
});
// Export the API endpoint URL
exports.apiEndpoint = api.url;
exports.notesTableName = notesTable.name;
exports.usersTableName = usersTable.name;
//# sourceMappingURL=index.js.map