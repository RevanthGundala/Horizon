import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { withAuth, createHeaders, handleOptions } from "../utils/middleware";
import { Client } from "pg";

// GET handler to retrieve blocks for a page
const getBlocksHandler = async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
  // Handle OPTIONS requests for CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return handleOptions(event);
  }

  const pageId = event.queryStringParameters?.pageId;
  
  if (!pageId) {
    return {
      statusCode: 400,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Page ID is required" }),
    };
  }

  try {
    // Connect to the database
    const client = new Client({
      connectionString: process.env.DB_URL,
      ssl: {
        rejectUnauthorized: false
      }
    });

    await client.connect();

    try {
      // Check if the page exists and belongs to the user
      const pageResult = await client.query(
        "SELECT * FROM pages WHERE id = $1 AND user_id = $2",
        [pageId, user.id]
      );

      if (pageResult.rows.length === 0) {
        return {
          statusCode: 404,
          headers: createHeaders(),
          body: JSON.stringify({ error: "Page not found or access denied" }),
        };
      }

      // Query the database for blocks
      const result = await client.query(
        "SELECT * FROM blocks WHERE page_id = $1 AND user_id = $2 ORDER BY order_index ASC",
        [pageId, user.id]
      );

      return {
        statusCode: 200,
        headers: createHeaders(),
        body: JSON.stringify({
          blocks: result.rows
        }),
      };
    } finally {
      // Always close the database connection
      await client.end();
    }
  } catch (error) {
    console.error("Error fetching blocks:", error);
    return {
      statusCode: 500,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Failed to fetch blocks" }),
    };
  }
};

// POST handler to create a new block
const createBlockHandler = async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
  // Handle OPTIONS requests for CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return handleOptions(event);
  }

  if (!event.body) {
    return {
      statusCode: 400,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Request body is required" }),
    };
  }

  try {
    const { pageId, type, content, metadata, orderIndex } = JSON.parse(event.body);

    if (!pageId || !type || orderIndex === undefined) {
      return {
        statusCode: 400,
        headers: createHeaders(),
        body: JSON.stringify({ error: "Page ID, type, and order index are required" }),
      };
    }

    // Connect to the database
    const client = new Client({
      connectionString: process.env.DB_URL,
      ssl: {
        rejectUnauthorized: false
      }
    });

    await client.connect();

    try {
      // Check if the page exists and belongs to the user
      const pageResult = await client.query(
        "SELECT * FROM pages WHERE id = $1 AND user_id = $2",
        [pageId, user.id]
      );

      if (pageResult.rows.length === 0) {
        return {
          statusCode: 404,
          headers: createHeaders(),
          body: JSON.stringify({ error: "Page not found or access denied" }),
        };
      }

      // Start a transaction
      await client.query('BEGIN');

      // Update the order indices of existing blocks to make room for the new block
      await client.query(
        `UPDATE blocks 
         SET order_index = order_index + 1 
         WHERE page_id = $1 AND order_index >= $2`,
        [pageId, orderIndex]
      );

      // Insert the new block
      const result = await client.query(
        `INSERT INTO blocks (page_id, user_id, type, content, metadata, order_index) 
         VALUES ($1, $2, $3, $4, $5, $6) 
         RETURNING *`,
        [pageId, user.id, type, content || '', metadata ? JSON.stringify(metadata) : null, orderIndex]
      );

      // Update the page's updated_at timestamp
      await client.query(
        `UPDATE pages SET updated_at = now() WHERE id = $1`,
        [pageId]
      );

      // Commit the transaction
      await client.query('COMMIT');

      return {
        statusCode: 201,
        headers: createHeaders(),
        body: JSON.stringify({
          block: result.rows[0]
        }),
      };
    } catch (error) {
      // Rollback the transaction in case of error
      await client.query('ROLLBACK');
      throw error;
    } finally {
      // Always close the database connection
      await client.end();
    }
  } catch (error) {
    console.error("Error creating block:", error);
    return {
      statusCode: 500,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Failed to create block" }),
    };
  }
};

// PUT handler to update a block
const updateBlockHandler = async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
  // Handle OPTIONS requests for CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return handleOptions(event);
  }

  const blockId = event.pathParameters?.id;
  
  if (!blockId) {
    return {
      statusCode: 400,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Block ID is required" }),
    };
  }

  if (!event.body) {
    return {
      statusCode: 400,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Request body is required" }),
    };
  }

  try {
    const updates = JSON.parse(event.body);
    
    // Connect to the database
    const client = new Client({
      connectionString: process.env.DB_URL,
      ssl: {
        rejectUnauthorized: false
      }
    });

    await client.connect();

    try {
      // Check if the block exists and belongs to the user
      const checkResult = await client.query(
        "SELECT * FROM blocks WHERE id = $1 AND user_id = $2",
        [blockId, user.id]
      );

      if (checkResult.rows.length === 0) {
        return {
          statusCode: 404,
          headers: createHeaders(),
          body: JSON.stringify({ error: "Block not found or access denied" }),
        };
      }

      const block = checkResult.rows[0];

      // Start a transaction
      await client.query('BEGIN');

      // Build the update query dynamically based on provided fields
      const allowedFields = ['type', 'content', 'metadata', 'order_index'];
      const updateFields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      allowedFields.forEach(field => {
        const camelCaseField = field.replace(/_([a-z])/g, g => g[1].toUpperCase());
        if (updates[camelCaseField] !== undefined) {
          if (field === 'metadata' && updates[camelCaseField]) {
            updateFields.push(`${field} = $${paramIndex}`);
            values.push(JSON.stringify(updates[camelCaseField]));
          } else {
            updateFields.push(`${field} = $${paramIndex}`);
            values.push(updates[camelCaseField]);
          }
          paramIndex++;
        }
      });

      // Always update the updated_at timestamp
      updateFields.push(`updated_at = now()`);

      // Add the WHERE clause parameters
      values.push(blockId);
      values.push(user.id);

      // Execute the update if there are fields to update
      if (updateFields.length > 0) {
        const updateQuery = `
          UPDATE blocks 
          SET ${updateFields.join(', ')} 
          WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
          RETURNING *
        `;

        const result = await client.query(updateQuery, values);

        // Update the page's updated_at timestamp
        await client.query(
          `UPDATE pages SET updated_at = now() WHERE id = $1`,
          [block.page_id]
        );

        // Commit the transaction
        await client.query('COMMIT');

        return {
          statusCode: 200,
          headers: createHeaders(),
          body: JSON.stringify({
            block: result.rows[0]
          }),
        };
      } else {
        // Rollback the transaction
        await client.query('ROLLBACK');
        
        return {
          statusCode: 400,
          headers: createHeaders(),
          body: JSON.stringify({ error: "No valid fields to update" }),
        };
      }
    } catch (error) {
      // Rollback the transaction in case of error
      await client.query('ROLLBACK');
      throw error;
    } finally {
      // Always close the database connection
      await client.end();
    }
  } catch (error) {
    console.error("Error updating block:", error);
    return {
      statusCode: 500,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Failed to update block" }),
    };
  }
};

// DELETE handler to delete a block
const deleteBlockHandler = async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
  // Handle OPTIONS requests for CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return handleOptions(event);
  }

  const blockId = event.pathParameters?.id;
  
  if (!blockId) {
    return {
      statusCode: 400,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Block ID is required" }),
    };
  }

  try {
    // Connect to the database
    const client = new Client({
      connectionString: process.env.DB_URL,
      ssl: {
        rejectUnauthorized: false
      }
    });

    await client.connect();

    try {
      // Check if the block exists and belongs to the user
      const checkResult = await client.query(
        "SELECT * FROM blocks WHERE id = $1 AND user_id = $2",
        [blockId, user.id]
      );

      if (checkResult.rows.length === 0) {
        return {
          statusCode: 404,
          headers: createHeaders(),
          body: JSON.stringify({ error: "Block not found or access denied" }),
        };
      }

      const block = checkResult.rows[0];

      // Start a transaction
      await client.query('BEGIN');

      // Delete the block
      await client.query(
        "DELETE FROM blocks WHERE id = $1 AND user_id = $2",
        [blockId, user.id]
      );

      // Update the order indices of remaining blocks
      await client.query(
        `UPDATE blocks 
         SET order_index = order_index - 1 
         WHERE page_id = $1 AND order_index > $2`,
        [block.page_id, block.order_index]
      );

      // Update the page's updated_at timestamp
      await client.query(
        `UPDATE pages SET updated_at = now() WHERE id = $1`,
        [block.page_id]
      );

      // Commit the transaction
      await client.query('COMMIT');

      return {
        statusCode: 200,
        headers: createHeaders(),
        body: JSON.stringify({
          success: true,
          message: "Block deleted successfully"
        }),
      };
    } catch (error) {
      // Rollback the transaction in case of error
      await client.query('ROLLBACK');
      throw error;
    } finally {
      // Always close the database connection
      await client.end();
    }
  } catch (error) {
    console.error("Error deleting block:", error);
    return {
      statusCode: 500,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Failed to delete block" }),
    };
  }
};

// PUT handler to update multiple blocks at once
const updateBlocksHandler = async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
  // Handle OPTIONS requests for CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return handleOptions(event);
  }

  if (!event.body) {
    return {
      statusCode: 400,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Request body is required" }),
    };
  }

  try {
    const { pageId, blocks } = JSON.parse(event.body);

    if (!pageId || !blocks || !Array.isArray(blocks) || blocks.length === 0) {
      return {
        statusCode: 400,
        headers: createHeaders(),
        body: JSON.stringify({ error: "Page ID and blocks array are required" }),
      };
    }

    // Connect to the database
    const client = new Client({
      connectionString: process.env.DB_URL,
      ssl: {
        rejectUnauthorized: false
      }
    });

    await client.connect();

    try {
      // Check if the page exists and belongs to the user
      const pageResult = await client.query(
        "SELECT * FROM pages WHERE id = $1 AND user_id = $2",
        [pageId, user.id]
      );

      if (pageResult.rows.length === 0) {
        return {
          statusCode: 404,
          headers: createHeaders(),
          body: JSON.stringify({ error: "Page not found or access denied" }),
        };
      }

      // Start a transaction
      await client.query('BEGIN');

      const updatedBlocks = [];
      const createdBlocks = [];
      const deletedBlockIds = [];

      // Process each block in the array
      for (const block of blocks) {
        if (block._action === 'delete' && block.id) {
          // Delete block
          await client.query(
            "DELETE FROM blocks WHERE id = $1 AND user_id = $2 AND page_id = $3",
            [block.id, user.id, pageId]
          );
          deletedBlockIds.push(block.id);
        } else if (block._action === 'create') {
          // Create new block
          const { type, content, metadata, orderIndex } = block;
          
          if (!type || orderIndex === undefined) {
            // Rollback and return error
            await client.query('ROLLBACK');
            return {
              statusCode: 400,
              headers: createHeaders(),
              body: JSON.stringify({ error: "Type and order index are required for new blocks" }),
            };
          }
          
          const result = await client.query(
            `INSERT INTO blocks (page_id, user_id, type, content, metadata, order_index) 
             VALUES ($1, $2, $3, $4, $5, $6) 
             RETURNING *`,
            [pageId, user.id, type, content || '', metadata ? JSON.stringify(metadata) : null, orderIndex]
          );
          
          createdBlocks.push(result.rows[0]);
        } else if (block.id) {
          // Update existing block
          const allowedFields = ['type', 'content', 'metadata', 'order_index'];
          const updateFields: string[] = [];
          const values: any[] = [];
          let paramIndex = 1;

          allowedFields.forEach(field => {
            const camelCaseField = field.replace(/_([a-z])/g, g => g[1].toUpperCase());
            if (block[camelCaseField] !== undefined) {
              if (field === 'metadata' && block[camelCaseField]) {
                updateFields.push(`${field} = $${paramIndex}`);
                values.push(JSON.stringify(block[camelCaseField]));
              } else {
                updateFields.push(`${field} = $${paramIndex}`);
                values.push(block[camelCaseField]);
              }
              paramIndex++;
            }
          });

          // Only update if there are fields to update
          if (updateFields.length > 0) {
            // Always update the updated_at timestamp
            updateFields.push(`updated_at = now()`);

            // Add the WHERE clause parameters
            values.push(block.id);
            values.push(user.id);
            values.push(pageId);

            const updateQuery = `
              UPDATE blocks 
              SET ${updateFields.join(', ')} 
              WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1} AND page_id = $${paramIndex + 2}
              RETURNING *
            `;

            const result = await client.query(updateQuery, values);
            
            if (result.rows.length > 0) {
              updatedBlocks.push(result.rows[0]);
            }
          }
        }
      }

      // Reindex all blocks to ensure order_index is consistent
      const allBlocks = await client.query(
        "SELECT * FROM blocks WHERE page_id = $1 AND user_id = $2 ORDER BY order_index ASC",
        [pageId, user.id]
      );
      
      for (let i = 0; i < allBlocks.rows.length; i++) {
        await client.query(
          "UPDATE blocks SET order_index = $1 WHERE id = $2",
          [i, allBlocks.rows[i].id]
        );
      }

      // Update the page's updated_at timestamp
      await client.query(
        `UPDATE pages SET updated_at = now() WHERE id = $1`,
        [pageId]
      );

      // Commit the transaction
      await client.query('COMMIT');

      return {
        statusCode: 200,
        headers: createHeaders(),
        body: JSON.stringify({
          updated: updatedBlocks,
          created: createdBlocks,
          deleted: deletedBlockIds
        }),
      };
    } catch (error) {
      // Rollback the transaction in case of error
      await client.query('ROLLBACK');
      throw error;
    } finally {
      // Always close the database connection
      await client.end();
    }
  } catch (error) {
    console.error("Error updating blocks:", error);
    return {
      statusCode: 500,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Failed to update blocks" }),
    };
  }
};

// Wrap the handlers with authentication middleware
export const getBlocks = withAuth(getBlocksHandler);
export const createBlock = withAuth(createBlockHandler);
export const updateBlock = withAuth(updateBlockHandler);
export const deleteBlock = withAuth(deleteBlockHandler);
export const updateBlocks = withAuth(updateBlocksHandler);

export const blocksApi = {
  getBlocks,
  createBlock,
  updateBlock,
  deleteBlock,
  updateBlocks
};
