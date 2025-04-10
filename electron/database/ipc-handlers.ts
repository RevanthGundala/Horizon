import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import DatabaseService, { Block, Note } from './index';
import SyncService from './sync';
import AuthService from '../auth';

// API URL for server communication
const API_URL = process.env.VITE_API_URL || 'https://vihy6489c7.execute-api.us-west-2.amazonaws.com/stage';

// Initialize database service
const db = DatabaseService.getInstance();
// Initialize sync service
const syncService = SyncService.getInstance();
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
      const userId = authService.getUserId() || 'anonymous';
      
      const note = {
        ...noteData,
        id,
        user_id: userId
      };
      
      return db.createNote(note);
    } catch (error) {
      console.error('Error creating note:', error);
      throw error;
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

  // Sync
  ipcMain.handle('db:sync', async () => {
    return await syncService.syncWithServer();
  });

  // Get pending sync count
  ipcMain.handle('db:get-pending-sync-count', () => {
    const { notes, blocks } = db.getEntitiesToSync();
    return notes.length + blocks.length;
  });

  // Chat
  ipcMain.handle('chat:send-message', async (_event, messages: Array<{ role: string; content: string }>) => {
    try {
      console.log(' [ELECTRON IPC] Sending chat message');

      if(!await syncService.checkNetworkStatus()) {
        // TODO: Implement Ollama when Offline
        console.log("TODO: Implement Ollama when Offline")
        return;
      }
      
      // Check if user is authenticated
      if (!authService.isAuthenticated()) {
        console.error(' [ELECTRON IPC] User not authenticated for chat');
        throw new Error('User not authenticated');
      }
      
      // Get access token
      const accessToken = authService.getAccessToken();
      if (!accessToken) {
        console.error(' [ELECTRON IPC] No access token available for chat');
        throw new Error('No access token available');
      }
      
      // Send to chat API
      console.log(`Sending chat request to ${API_URL}/api/chat`);
      
      // If API is not available, return a friendly message
      try {
        const statusCheck = await fetch(`${API_URL}/api/status`, {
          method: 'GET'
        });
        
        if (!statusCheck.ok) {
          console.log(` [ELECTRON IPC] API unavailable for chat: ${statusCheck.status}`);
          return {
            role: 'assistant',
            content: "I'm sorry, but I'm currently unable to connect to the knowledge base. Check your internet connection and try again later."
          };
        }
      } catch (error) {
        console.log(` [ELECTRON IPC] API connection error for chat:`, error);
        return {
          role: 'assistant',
          content: "I'm sorry, but I'm currently unable to connect to the knowledge base. Check your internet connection and try again later."
        };
      }
      
      const response = await fetch(`${API_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': accessToken,
          'X-Authorization': `Bearer ${accessToken}` // Try both auth methods
        },
        body: JSON.stringify({ messages }),
      });
      
      // Check if response is ok
      if (!response.ok) {
        console.error(` [ELECTRON IPC] Chat API error: ${response.status} ${response.statusText}`);
        // Instead of throwing an error, return a friendly message
        return {
          role: 'assistant',
          content: "I'm sorry, but I encountered an error processing your request. " +
                   "This could be due to a temporary service disruption. " + 
                   "Please try again later or contact support if the issue persists."
        };
      }
      
      // Get response text
      const responseText = await response.text();
      console.log(' [ELECTRON IPC] Chat response received');
      
      // Parse the event stream and extract the assistant's message
      const events = responseText.split('\n\n').filter(Boolean);
      let assistantMessage = '';
      
      for (const event of events) {
        if (event.startsWith('data: ')) {
          try {
            const data = JSON.parse(event.substring(6));
            if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
              assistantMessage += data.choices[0].delta.content;
            }
          } catch (e) {
            console.error(' [ELECTRON IPC] Error parsing event stream:', e);
          }
        }
      }
      
      return {
        role: 'assistant',
        content: assistantMessage || 'Sorry, I could not generate a response.'
      };
    } catch (error) {
      console.error(' [ELECTRON IPC] Error in chat:', error);
      // Return a helpful message instead of throwing
      return {
        role: 'assistant',
        content: "I'm sorry, but I encountered an unexpected error. " +
                "This might be a temporary issue with the service. " +
                "Please try again later."
      };
    }
  });
}

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
    const accessToken = auth.getAccessToken();
    if (!accessToken) {
      console.log(' [ELECTRON IPC] No access token available, skipping embedding generation');
      return;
    }
    
    // Send to embeddings API
    const response = await fetch(`${API_URL}/api/embeddings/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': accessToken
      },
      body: JSON.stringify({
        blockId: block.id,
        content: block.content
      })
    });
    
    if (!response.ok) {
      console.error(` [ELECTRON IPC] Error from embeddings API: ${response.status} ${response.statusText}`);
      return;
    }
    
    console.log(` [ELECTRON IPC] Successfully processed block ${block.id} for embedding`);
  } catch (error) {
    console.error(' [ELECTRON IPC] Error processing block for embedding:', error);
  }
}

/**
 * Process multiple blocks for embeddings
 */
async function processBlocksForEmbeddings(blocks: Block[], userId: string): Promise<void> {
  try {
    // Check if we're online and authenticated
    const auth = AuthService.getInstance();
    if (!auth.isAuthenticated()) {
      console.log(' [ELECTRON IPC] Not authenticated, skipping embedding generation');
      return;
    }
    
    console.log(` [ELECTRON IPC] Processing ${blocks.length} blocks for embeddings`);
    
    // Get access token
    const accessToken = auth.getAccessToken();
    if (!accessToken) {
      console.log(' [ELECTRON IPC] No access token available, skipping embedding generation');
      return;
    }
    
    // Send to embeddings API
    const response = await fetch(`${API_URL}/api/embeddings/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': accessToken
      },
      body: JSON.stringify({
        blocks: blocks.map(block => ({
          id: block.id,
          user_id: userId,
          content: block.content,
          type: block.type
        }))
      })
    });
    
    if (!response.ok) {
      console.error(` [ELECTRON IPC] Error from embeddings API: ${response.status} ${response.statusText}`);
      return;
    }
    
    console.log(` [ELECTRON IPC] Successfully processed ${blocks.length} blocks for embeddings`);
  } catch (error) {
    console.error(' [ELECTRON IPC] Error processing blocks for embeddings:', error);
  }
}
