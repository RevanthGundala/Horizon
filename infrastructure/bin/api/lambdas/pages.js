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
exports.pagesApi = exports.deletePage = exports.updatePage = exports.createPage = exports.getPage = exports.getAllPages = void 0;
const middleware_1 = require("../utils/middleware");
const pg_1 = require("pg");
// GET handler to retrieve pages for a user
const getPagesHandler = (event, user) => __awaiter(void 0, void 0, void 0, function* () {
    // Handle OPTIONS requests for CORS preflight
    if (event.httpMethod === "OPTIONS") {
        return (0, middleware_1.handleOptions)(event);
    }
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
            // Get query parameters
            const queryParams = event.queryStringParameters || {};
            const parentId = queryParams.parentId || null;
            // Query the database for pages
            let query = "SELECT * FROM pages WHERE user_id = $1";
            const queryParams2 = [user.id];
            if (parentId) {
                query += " AND parent_id = $2";
                queryParams2.push(parentId);
            }
            else {
                query += " AND parent_id IS NULL";
            }
            query += " ORDER BY updated_at DESC";
            const result = yield client.query(query, queryParams2);
            return {
                statusCode: 200,
                headers: (0, middleware_1.createHeaders)(),
                body: JSON.stringify({
                    pages: result.rows
                }),
            };
        }
        finally {
            // Always close the database connection
            yield client.end();
        }
    }
    catch (error) {
        console.error("Error fetching pages:", error);
        return {
            statusCode: 500,
            headers: (0, middleware_1.createHeaders)(),
            body: JSON.stringify({ error: "Failed to fetch pages" }),
        };
    }
});
// GET handler to retrieve a single page by ID
const getPageHandler = (event, user) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    // Handle OPTIONS requests for CORS preflight
    if (event.httpMethod === "OPTIONS") {
        return (0, middleware_1.handleOptions)(event);
    }
    const pageId = (_a = event.pathParameters) === null || _a === void 0 ? void 0 : _a.id;
    if (!pageId) {
        return {
            statusCode: 400,
            headers: (0, middleware_1.createHeaders)(),
            body: JSON.stringify({ error: "Page ID is required" }),
        };
    }
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
            // Query the database for the page
            const pageResult = yield client.query("SELECT * FROM pages WHERE id = $1 AND user_id = $2", [pageId, user.id]);
            if (pageResult.rows.length === 0) {
                return {
                    statusCode: 404,
                    headers: (0, middleware_1.createHeaders)(),
                    body: JSON.stringify({ error: "Page not found" }),
                };
            }
            const page = pageResult.rows[0];
            // Get blocks for this page
            const blocksResult = yield client.query("SELECT * FROM blocks WHERE page_id = $1 AND user_id = $2 ORDER BY order_index ASC", [pageId, user.id]);
            // Return the page with its blocks
            return {
                statusCode: 200,
                headers: (0, middleware_1.createHeaders)(),
                body: JSON.stringify({
                    page,
                    blocks: blocksResult.rows
                }),
            };
        }
        finally {
            // Always close the database connection
            yield client.end();
        }
    }
    catch (error) {
        console.error("Error fetching page:", error);
        return {
            statusCode: 500,
            headers: (0, middleware_1.createHeaders)(),
            body: JSON.stringify({ error: "Failed to fetch page" }),
        };
    }
});
// POST handler to create a new page
const createPageHandler = (event, user) => __awaiter(void 0, void 0, void 0, function* () {
    // Handle OPTIONS requests for CORS preflight
    if (event.httpMethod === "OPTIONS") {
        return (0, middleware_1.handleOptions)(event);
    }
    if (!event.body) {
        return {
            statusCode: 400,
            headers: (0, middleware_1.createHeaders)(),
            body: JSON.stringify({ error: "Request body is required" }),
        };
    }
    try {
        const { title, parentId, type = 'page' } = JSON.parse(event.body);
        if (!title) {
            return {
                statusCode: 400,
                headers: (0, middleware_1.createHeaders)(),
                body: JSON.stringify({ error: "Title is required" }),
            };
        }
        // Connect to the database
        const client = new pg_1.Client({
            connectionString: process.env.DB_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });
        yield client.connect();
        try {
            // Start a transaction
            yield client.query('BEGIN');
            // Insert the new page
            const pageResult = yield client.query(`INSERT INTO pages (user_id, parent_id, title, type) 
         VALUES ($1, $2, $3, $4) 
         RETURNING *`, [user.id, parentId || null, title, type]);
            const newPage = pageResult.rows[0];
            // Create an initial empty block for the page
            yield client.query(`INSERT INTO blocks (page_id, user_id, type, content, order_index) 
         VALUES ($1, $2, $3, $4, $5)`, [newPage.id, user.id, 'paragraph', '', 0]);
            // Commit the transaction
            yield client.query('COMMIT');
            return {
                statusCode: 201,
                headers: (0, middleware_1.createHeaders)(),
                body: JSON.stringify({
                    page: newPage
                }),
            };
        }
        catch (error) {
            // Rollback the transaction in case of error
            yield client.query('ROLLBACK');
            throw error;
        }
        finally {
            // Always close the database connection
            yield client.end();
        }
    }
    catch (error) {
        console.error("Error creating page:", error);
        return {
            statusCode: 500,
            headers: (0, middleware_1.createHeaders)(),
            body: JSON.stringify({ error: "Failed to create page" }),
        };
    }
});
// PUT handler to update a page
const updatePageHandler = (event, user) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    // Handle OPTIONS requests for CORS preflight
    if (event.httpMethod === "OPTIONS") {
        return (0, middleware_1.handleOptions)(event);
    }
    const pageId = (_a = event.pathParameters) === null || _a === void 0 ? void 0 : _a.id;
    if (!pageId) {
        return {
            statusCode: 400,
            headers: (0, middleware_1.createHeaders)(),
            body: JSON.stringify({ error: "Page ID is required" }),
        };
    }
    if (!event.body) {
        return {
            statusCode: 400,
            headers: (0, middleware_1.createHeaders)(),
            body: JSON.stringify({ error: "Request body is required" }),
        };
    }
    try {
        const updates = JSON.parse(event.body);
        // Connect to the database
        const client = new pg_1.Client({
            connectionString: process.env.DB_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });
        yield client.connect();
        try {
            // Check if the page exists and belongs to the user
            const checkResult = yield client.query("SELECT * FROM pages WHERE id = $1 AND user_id = $2", [pageId, user.id]);
            if (checkResult.rows.length === 0) {
                return {
                    statusCode: 404,
                    headers: (0, middleware_1.createHeaders)(),
                    body: JSON.stringify({ error: "Page not found or access denied" }),
                };
            }
            // Build the update query dynamically based on provided fields
            const allowedFields = ['title', 'parent_id', 'is_favorite', 'type'];
            const updateFields = [];
            const values = [];
            let paramIndex = 1;
            allowedFields.forEach(field => {
                const camelCaseField = field.replace(/_([a-z])/g, g => g[1].toUpperCase());
                if (updates[camelCaseField] !== undefined) {
                    updateFields.push(`${field} = $${paramIndex}`);
                    values.push(updates[camelCaseField]);
                    paramIndex++;
                }
            });
            // Always update the updated_at timestamp
            updateFields.push(`updated_at = now()`);
            // Add the WHERE clause parameters
            values.push(pageId);
            values.push(user.id);
            // Execute the update if there are fields to update
            if (updateFields.length > 0) {
                const updateQuery = `
          UPDATE pages 
          SET ${updateFields.join(', ')} 
          WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
          RETURNING *
        `;
                const result = yield client.query(updateQuery, values);
                return {
                    statusCode: 200,
                    headers: (0, middleware_1.createHeaders)(),
                    body: JSON.stringify({
                        page: result.rows[0]
                    }),
                };
            }
            else {
                return {
                    statusCode: 400,
                    headers: (0, middleware_1.createHeaders)(),
                    body: JSON.stringify({ error: "No valid fields to update" }),
                };
            }
        }
        finally {
            // Always close the database connection
            yield client.end();
        }
    }
    catch (error) {
        console.error("Error updating page:", error);
        return {
            statusCode: 500,
            headers: (0, middleware_1.createHeaders)(),
            body: JSON.stringify({ error: "Failed to update page" }),
        };
    }
});
// DELETE handler to delete a page
const deletePageHandler = (event, user) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    // Handle OPTIONS requests for CORS preflight
    if (event.httpMethod === "OPTIONS") {
        return (0, middleware_1.handleOptions)(event);
    }
    const pageId = (_a = event.pathParameters) === null || _a === void 0 ? void 0 : _a.id;
    if (!pageId) {
        return {
            statusCode: 400,
            headers: (0, middleware_1.createHeaders)(),
            body: JSON.stringify({ error: "Page ID is required" }),
        };
    }
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
            // Check if the page exists and belongs to the user
            const checkResult = yield client.query("SELECT * FROM pages WHERE id = $1 AND user_id = $2", [pageId, user.id]);
            if (checkResult.rows.length === 0) {
                return {
                    statusCode: 404,
                    headers: (0, middleware_1.createHeaders)(),
                    body: JSON.stringify({ error: "Page not found or access denied" }),
                };
            }
            // Start a transaction
            yield client.query('BEGIN');
            // Delete all blocks associated with the page
            yield client.query("DELETE FROM blocks WHERE page_id = $1", [pageId]);
            // Delete the page
            yield client.query("DELETE FROM pages WHERE id = $1 AND user_id = $2", [pageId, user.id]);
            // Commit the transaction
            yield client.query('COMMIT');
            return {
                statusCode: 200,
                headers: (0, middleware_1.createHeaders)(),
                body: JSON.stringify({
                    success: true,
                    message: "Page deleted successfully"
                }),
            };
        }
        catch (error) {
            // Rollback the transaction in case of error
            yield client.query('ROLLBACK');
            throw error;
        }
        finally {
            // Always close the database connection
            yield client.end();
        }
    }
    catch (error) {
        console.error("Error deleting page:", error);
        return {
            statusCode: 500,
            headers: (0, middleware_1.createHeaders)(),
            body: JSON.stringify({ error: "Failed to delete page" }),
        };
    }
});
// Wrap the handlers with authentication middleware
exports.getAllPages = (0, middleware_1.withAuth)(getPagesHandler);
exports.getPage = (0, middleware_1.withAuth)(getPageHandler);
exports.createPage = (0, middleware_1.withAuth)(createPageHandler);
exports.updatePage = (0, middleware_1.withAuth)(updatePageHandler);
exports.deletePage = (0, middleware_1.withAuth)(deletePageHandler);
exports.pagesApi = {
    getAllPages: exports.getAllPages,
    getPage: exports.getPage,
    createPage: exports.createPage,
    updatePage: exports.updatePage,
    deletePage: exports.deletePage
};
//# sourceMappingURL=pages.js.map