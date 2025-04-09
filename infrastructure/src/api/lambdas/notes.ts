import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { withAuth, createHeaders, handleOptions } from "../utils/middleware";
import { Client } from "pg";

// GET handler to retrieve notes for a user
const getNotesHandler = async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
  // Handle OPTIONS requests for CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return handleOptions(event);
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
      // Get query parameters
      const queryParams = event.queryStringParameters || {};
      const parentId = queryParams.parentId || null;
      
      // Query the database for notes
      let query = "SELECT * FROM notes WHERE user_id = $1";
      const queryParams2 = [user.id];
      
      if (parentId) {
        query += " AND parent_id = $2";
        queryParams2.push(parentId);
      } else {
        query += " AND parent_id IS NULL";
      }
      
      query += " ORDER BY updated_at DESC";
      
      const result = await client.query(query, queryParams2);

      return {
        statusCode: 200,
        headers: createHeaders(),
        body: JSON.stringify({
          notes: result.rows
        }),
      };
    } finally {
      // Always close the database connection
      await client.end();
    }
  } catch (error) {
    console.error("Error fetching notes:", error);
    return {
      statusCode: 500,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Failed to fetch notes" }),
    };
  }
};

// GET handler to retrieve a single note by ID
const getNoteHandler = async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
  // Handle OPTIONS requests for CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return handleOptions(event);
  }

  const noteId = event.pathParameters?.id;
  
  if (!noteId) {
    return {
      statusCode: 400,
      headers: createHeaders(),
      body: JSON.stringify({ error: "note ID is required" }),
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
      // Query the database for the note
      const noteResult = await client.query(
        "SELECT * FROM notes WHERE id = $1 AND user_id = $2",
        [noteId, user.id]
      );

      if (noteResult.rows.length === 0) {
        return {
          statusCode: 404,
          headers: createHeaders(),
          body: JSON.stringify({ error: "Note not found" }),
        };
      }

      const note = noteResult.rows[0];

      // Get blocks for this note
      const blocksResult = await client.query(
        "SELECT * FROM blocks WHERE note_id = $1 AND user_id = $2 ORDER BY order_index ASC",
        [noteId, user.id]
      );

      // Return the note with its blocks
      return {
        statusCode: 200,
        headers: createHeaders(),
        body: JSON.stringify({
          note,
          blocks: blocksResult.rows
        }),
      };
    } finally {
      // Always close the database connection
      await client.end();
    }
  } catch (error) {
    console.error("Error fetching note:", error);
    return {
      statusCode: 500,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Failed to fetch note" }),
    };
  }
};

// POST handler to create a new note
const createNoteHandler = async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
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
    const { title, parentId, type = 'note' } = JSON.parse(event.body);

    if (!title) {
      return {
        statusCode: 400,
        headers: createHeaders(),
        body: JSON.stringify({ error: "Title is required" }),
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
      // Start a transaction
      await client.query('BEGIN');

      // Insert the new note
      const noteResult = await client.query(
        `INSERT INTO notes (user_id, parent_id, title, type) 
         VALUES ($1, $2, $3, $4) 
         RETURNING *`,
        [user.id, parentId || null, title, type]
      );

      const newNote = noteResult.rows[0];

      // Create an initial empty block for the note
      await client.query(
        `INSERT INTO blocks (note_id, user_id, type, content, order_index) 
         VALUES ($1, $2, $3, $4, $5)`,
        [newNote.id, user.id, 'paragraph', '', 0]
      );

      // Commit the transaction
      await client.query('COMMIT');

      return {
        statusCode: 201,
        headers: createHeaders(),
        body: JSON.stringify({
          note: newNote
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
    console.error("Error creating note:", error);
    return {
      statusCode: 500,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Failed to create note" }),
    };
  }
};

// PUT handler to update a note
const updateNoteHandler = async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
  // Handle OPTIONS requests for CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return handleOptions(event);
  }

  const noteId = event.pathParameters?.id;
  
  if (!noteId) {
    return {
      statusCode: 400,
      headers: createHeaders(),
      body: JSON.stringify({ error: "note ID is required" }),
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
      // Check if the note exists and belongs to the user
      const checkResult = await client.query(
        "SELECT * FROM notes WHERE id = $1 AND user_id = $2",
        [noteId, user.id]
      );

      if (checkResult.rows.length === 0) {
        return {
          statusCode: 404,
          headers: createHeaders(),
          body: JSON.stringify({ error: "note not found or access denied" }),
        };
      }

      // Build the update query dynamically based on provided fields
      const allowedFields = ['title', 'parent_id', 'is_favorite', 'type'];
      const updateFields: string[] = [];
      const values: any[] = [];
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
      values.push(noteId);
      values.push(user.id);

      // Execute the update if there are fields to update
      if (updateFields.length > 0) {
        const updateQuery = `
          UPDATE notes 
          SET ${updateFields.join(', ')} 
          WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
          RETURNING *
        `;

        const result = await client.query(updateQuery, values);

        return {
          statusCode: 200,
          headers: createHeaders(),
          body: JSON.stringify({
            note: result.rows[0]
          }),
        };
      } else {
        return {
          statusCode: 400,
          headers: createHeaders(),
          body: JSON.stringify({ error: "No valid fields to update" }),
        };
      }
    } finally {
      // Always close the database connection
      await client.end();
    }
  } catch (error) {
    console.error("Error updating note:", error);
    return {
      statusCode: 500,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Failed to update note" }),
    };
  }
};

// DELETE handler to delete a note
const deleteNoteHandler = async (event: APIGatewayProxyEvent, user: any): Promise<APIGatewayProxyResult> => {
  // Handle OPTIONS requests for CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return handleOptions(event);
  }

  const noteId = event.pathParameters?.id;
  
  if (!noteId) {
    return {
      statusCode: 400,
      headers: createHeaders(),
      body: JSON.stringify({ error: "note ID is required" }),
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
      // Check if the note exists and belongs to the user
      const checkResult = await client.query(
        "SELECT * FROM notes WHERE id = $1 AND user_id = $2",
        [noteId, user.id]
      );

      if (checkResult.rows.length === 0) {
        return {
          statusCode: 404,
          headers: createHeaders(),
          body: JSON.stringify({ error: "note not found or access denied" }),
        };
      }

      // Start a transaction
      await client.query('BEGIN');

      // Delete all blocks associated with the note
      await client.query(
        "DELETE FROM blocks WHERE note_id = $1",
        [noteId]
      );

      // Delete the note
      await client.query(
        "DELETE FROM notes WHERE id = $1 AND user_id = $2",
        [noteId, user.id]
      );

      // Commit the transaction
      await client.query('COMMIT');

      return {
        statusCode: 200,
        headers: createHeaders(),
        body: JSON.stringify({
          success: true,
          message: "note deleted successfully"
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
    console.error("Error deleting note:", error);
    return {
      statusCode: 500,
      headers: createHeaders(),
      body: JSON.stringify({ error: "Failed to delete note" }),
    };
  }
};

// Wrap the handlers with authentication middleware
export const getAllNotes = withAuth(getNotesHandler);
export const getNote = withAuth(getNoteHandler);
export const createNote = withAuth(createNoteHandler);
export const updateNote = withAuth(updateNoteHandler);
export const deleteNote = withAuth(deleteNoteHandler);

export const notesApi = {
  getAllNotes,
  getNote,
  createNote,
  updateNote,
  deleteNote
};
