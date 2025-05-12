import { ipcMain, net } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import DatabaseService, { Block, Note } from './index';
import { AuthService } from '../auth';

// API URL for server communication
const API_URL = process.env.API_URL || '';

// Initialize database service
const db = DatabaseService.getInstance();

// Initialize auth service
const authService = AuthService.getInstance();

/**
 * Set up IPC handlers for database operations
 */
export function setupDatabaseIpcHandlers(): void {
  // General
  ipcMain.handle('db:get-user-id', () => {
    return authService.getUserId();
  });

  // Add to ipcMain handlers
  ipcMain.handle('db:user-exists', async (event, userId: string) => {
    return db.userExists(userId);
  });

  // Notes
  ipcMain.handle('db:get-notes', (_event, workspaceId?: string, parentId?: string) => {
    return db.getNotes(workspaceId, parentId);
  });

  ipcMain.handle('db:get-note', (_event, id: string) => {
    const note = db.getNote(id);
    const blocks = note ? db.getBlocks(id) : [];
    return { note, blocks };
  });

  ipcMain.handle('db:create-note', (_event, noteData: Omit<Note, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>) => {
    try {
      const id = noteData.id || uuidv4();
      const userId = noteData.user_id || authService.getUserId();
      
      // Validate required fields
      if (!userId) throw new Error('User ID is required');
      if (!noteData.workspace_id) throw new Error('Workspace ID is required');
      
      // Verify referenced entities exist
      const workspaceExists = db.getWorkspace(noteData.workspace_id);
      const userExists = db.userExists(userId);
      
      if (!workspaceExists) throw new Error(`Workspace ${noteData.workspace_id} not found`);
      if (!userExists) throw new Error(`User ${userId} not found`);
  
      const note = {
        ...noteData,
        id,
        user_id: userId,
        sync_status: 'created'
      };
      
      return db.createNote(note);
    } catch (error) {
      console.error('Error creating note:', error);
      throw error; // Rethrow for IPC to forward to renderer
    }
  }); 
  

  ipcMain.handle('db:update-note', (_event, id: string, updates: Partial<Omit<Note, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>) => {
    return db.updateNote(id, updates);
  });

  ipcMain.handle('db:delete-note', (_event, id: string) => {
    db.deleteNote(id);
    return { success: true };
  });

  // Blocks
  ipcMain.handle('db:get-blocks', (_event, noteId: string) => {
    return db.getBlocks(noteId);
  });

  ipcMain.handle('db:get-block', (_event, id: string) => {
    return db.getBlock(id);
  });

  ipcMain.handle('db:create-block', (_event, blockData: Omit<Block, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>) => {
    try {
      // Use the provided id or generate a new one
      const id = blockData.id || uuidv4();
      
      console.log(' [ELECTRON IPC] Received block data:', JSON.stringify({
        ...blockData,
        content: blockData.content ? `${blockData.content.substring(0, 50)}...` : null // Truncate content for logging
      }, null, 2));
      
      // Get the current user ID from auth service
      const authUserId = authService.getUserId();
      console.log(' [ELECTRON IPC] Auth service user ID:', authUserId);
      console.log(' [ELECTRON IPC] Block data user ID:', blockData.user_id);
      
      // Ensure we have a valid user_id - never allow empty string
      let userId = blockData.user_id;
      if (!userId || userId.trim() === '') {
        userId = authUserId || 'anonymous';
        console.log(' [ELECTRON IPC] Using fallback user ID for block:', userId);
      }
      
      // Create a sanitized block object with only the fields that exist in the database schema
      const sanitizedBlockData = {
        id,
        note_id: blockData.note_id,
        user_id: userId,
        type: blockData.type,
        content: blockData.content,
        metadata: blockData.metadata,
        order_index: blockData.order_index
      };
      
      console.log(' [ELECTRON IPC] Creating block with data:', JSON.stringify({
        ...sanitizedBlockData,
        content: sanitizedBlockData.content ? `${sanitizedBlockData.content.substring(0, 50)}...` : null // Truncate content for logging
      }, null, 2));
      
      // Create the block in the database
      const result = db.createBlock(sanitizedBlockData);
      console.log(' [ELECTRON IPC] Block created successfully:', result.id);
      
      // Process block for embeddings if it has content
      if (sanitizedBlockData.content && sanitizedBlockData.type === 'text') {
        try {
          // Send to embeddings API when online
          processBlockForEmbedding(result, userId);
        } catch (embeddingError) {
          console.error(' [ELECTRON IPC] Error processing block for embedding:', embeddingError);
          // Continue even if embedding fails - we don't want to block the UI
        }
      }
      
      return result;
    } catch (error) {
      console.error(' [ELECTRON IPC] Error creating block:', error);
      throw error;
    }
  });

  ipcMain.handle('db:update-block', (_event, id: string, updates: Partial<Omit<Block, 'id' | 'note_id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>) => {
    try {
      console.log(' [ELECTRON IPC] Updating block:', id);
      console.log(' [ELECTRON IPC] Update data:', JSON.stringify({
        ...updates,
        content: updates.content ? `${updates.content.substring(0, 50)}...` : undefined
      }, null, 2));
      
      // Create a sanitized updates object with only the fields that exist in the database schema
      const sanitizedUpdates: Partial<Omit<Block, 'id' | 'note_id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>> = {};
      
      // Only include fields that are present in the updates
      if (updates.type !== undefined) sanitizedUpdates.type = updates.type;
      if (updates.content !== undefined) sanitizedUpdates.content = updates.content;
      if (updates.metadata !== undefined) sanitizedUpdates.metadata = updates.metadata;
      if (updates.order_index !== undefined) sanitizedUpdates.order_index = updates.order_index;
      if (updates.user_id !== undefined) sanitizedUpdates.user_id = updates.user_id;
      
      console.log(' [ELECTRON IPC] Sanitized update data:', JSON.stringify({
        ...sanitizedUpdates,
        content: sanitizedUpdates.content ? `${sanitizedUpdates.content.substring(0, 50)}...` : undefined
      }, null, 2));
      
      // Update the block in the database
      const result = db.updateBlock(id, sanitizedUpdates);
      
      if (result) {
        console.log(' [ELECTRON IPC] Block updated successfully:', id);
        
        // Process block for embeddings if content was updated
        if (sanitizedUpdates.content && result.type === 'text') {
          try {
            // Get the current user ID
            const userId = authService.getUserId();
            if (userId) {
              // Send to embeddings API when online
              processBlockForEmbedding(result, userId);
            }
          } catch (embeddingError) {
            console.error(' [ELECTRON IPC] Error processing updated block for embedding:', embeddingError);
            // Continue even if embedding fails - we don't want to block the UI
          }
        }
        
        return result;
      } else {
        console.error(' [ELECTRON IPC] Block not found:', id);
        throw new Error(`Block not found: ${id}`);
      }
    } catch (error) {
      console.error(' [ELECTRON IPC] Error updating block:', error);
      throw error;
    }
  });

  ipcMain.handle('db:delete-block', (_event, id: string) => {
    db.deleteBlock(id);
    return { success: true };
  });

  ipcMain.handle('db:update-blocks-batch', (_event, blocks: Array<Block | Partial<Block> & { id: string }>) => {
    db.updateBlocksBatch(blocks);
    return { success: true };
  });

  // Workspace operations
  ipcMain.handle('db:get-workspaces', () => {
    try {
      return db.getWorkspaces();
    } catch (error) {
      console.error('Error getting workspaces:', error);
      throw error;
    }
  });

  ipcMain.handle('db:create-workspace', (_event, workspaceData: any) => {
    try {
      const id = workspaceData.id || uuidv4();
      const userId = workspaceData.user_id || authService.getUserId() || 'anonymous';
      
      const workspace = {
        ...workspaceData,
        id,
        user_id: userId
      };
      
      return db.createWorkspace(workspace);
    } catch (error) {
      console.error('Error creating workspace:', error);
      throw error;
    }
  });

  ipcMain.handle('db:update-workspace', (_event, id: string, updates: any) => {
    try {
      return db.updateWorkspace(id, updates);
    } catch (error) {
      console.error('Error updating workspace:', error);
      throw error;
    }
  });

  ipcMain.handle('db:delete-workspace', (_event, id: string) => {
    try {
      db.deleteWorkspace(id);
      return { success: true };
    } catch (error) {
      console.error('Error deleting workspace:', error);
      throw error;
    }
  });

/**
 * Process a single block for embedding
 */
async function processBlockForEmbedding(block: Block, userId: string): Promise<void> {
  try {
    // Check if we're online and authenticated
    const auth = AuthService.getInstance();
    if (!auth.isAuthenticated()) {
      console.log(' [ELECTRON IPC] Not authenticated, skipping embedding generation');
      return;
    }
    
    console.log(` [ELECTRON IPC] Processing block ${block.id} for embedding`);
    
    // Get access token
    // --- MODIFIED AUTHENTICATION CHECK ---
// Check the current authentication state known by AuthService
if (!authService.isAuthenticated()) {
  // Handle the case where the Electron app knows the user isn't authenticated
  console.error("Not authenticated according to AuthService state. Aborting chat request.");
  throw new Error("Not authenticated");
}

    
    // Send to embeddings API using Electron net.request
    await new Promise<void>((resolve, reject) => {
      const request = net.request({
        method: 'POST',
        url: `${API_URL}/api/embeddings/generate`,
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      request.on('response', (response) => {
        let body = '';
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
            console.log(` [ELECTRON IPC] Successfully processed block ${block.id} for embedding`);
            resolve();
          } else {
            console.error(` [ELECTRON IPC] Error from embeddings API: ${response.statusCode} ${response.statusMessage}`);
            reject(new Error(body));
          }
        });
      });
      request.on('error', (err) => {
        console.error(' [ELECTRON IPC] net.request error:', err);
        reject(err);
      });
      request.write(JSON.stringify({
        blockId: block.id,
        content: block.content
      }));
      request.end();
    });
  } catch (error) {
    console.error(' [ELECTRON IPC] Error processing block for embedding:', error);
  }
}

/**
 * Process multiple blocks for embeddings
 */
// async function processBlocksForEmbeddings(blocks: Block[], userId: string): Promise<void> {
//   try {
//     // Check if we're online and authenticated
//     const auth = AuthService.getInstance();
//     if (!auth.isAuthenticated()) {
//       console.log(' [ELECTRON IPC] Not authenticated, skipping embedding generation');
//       return;
//     }
    
//     console.log(` [ELECTRON IPC] Processing ${blocks.length} blocks for embeddings`);
    
//     // Get access token
//     const accessToken = auth.getAccessToken();
//     if (!accessToken) {
//       console.log(' [ELECTRON IPC] No access token available, skipping embedding generation');
//       return;
//     }
    
//     // Send to embeddings API
//     const response = await fetch(`${API_URL}/api/embeddings/process`, {
//       method: 'POST',
//       headers: {
//         'Content-Type': 'application/json',
//         'Cookie': accessToken
//       },
//       body: JSON.stringify({
//         blocks: blocks.map(block => ({
//           id: block.id,
//           user_id: userId,
//           content: block.content,
//           type: block.type
//         }))
//       })
//     });
    
//     if (!response.ok) {
//       console.error(` [ELECTRON IPC] Error from embeddings API: ${response.status} ${response.statusText}`);
//       return;
//     }
    
//     console.log(` [ELECTRON IPC] Successfully processed ${blocks.length} blocks for embeddings`);
//   } catch (error) {
//     console.error(' [ELECTRON IPC] Error processing blocks for embeddings:', error);
//   }
// }
}
