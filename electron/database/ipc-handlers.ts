import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
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

  // Sync
  ipcMain.handle('db:sync', async () => {
    return await syncService.syncWithServer();
  });

  // Get pending sync count
  ipcMain.handle('db:get-pending-sync-count', () => {
    const { notes, blocks } = db.getEntitiesToSync();
    return notes.length + blocks.length;
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

  // Chat
  ipcMain.handle('chat:send-message', async (_event, messages: Array<{ role: string; content: string }>) => {
    try {
      console.log(' [ELECTRON IPC] Sending chat message');

      if(!await syncService.checkNetworkStatus()) {
        // Return offline message
        console.log(" [ELECTRON IPC] Device is offline, cannot send chat message");
        return {
          role: 'assistant',
          content: "I'm sorry, but you appear to be offline. Please check your internet connection and try again."
        };
      }
      
      // Check if user is authenticated - if not, use demo endpoint
      if (!authService.isAuthenticated()) {
        console.log(' [ELECTRON IPC] User not authenticated for chat, using demo endpoint');
        return {
          role: 'assistant',
          content: "I'm sorry, but you need to be logged in to use the full chat feature. Please log in and try again."
        };
      }
      
      // Get access token
      const accessToken = authService.getAccessToken();
      if (!accessToken) {
        console.error(' [ELECTRON IPC] No access token available for chat');
        return {
          role: 'assistant',
          content: "I'm sorry, but I couldn't authenticate your session. Please try logging in again."
        };
      }
      
      // Send to chat API with retries
      console.log(`Sending chat request to ${API_URL}/api/chat`);
      
      // Check API availability with a short timeout and retry
      let apiCheckAttempt = 0;
      const maxApiCheckAttempts = 2;
      
      while (apiCheckAttempt < maxApiCheckAttempts) {
        try {
          console.log(` [ELECTRON IPC] API status check attempt ${apiCheckAttempt + 1}/${maxApiCheckAttempts}`);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
          
          const statusCheck = await fetch(`${API_URL}/api/status`, {
            method: 'GET',
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (statusCheck.ok) {
            console.log(` [ELECTRON IPC] API status check successful`);
            break;
          } else {
            console.log(` [ELECTRON IPC] API unavailable for chat: ${statusCheck.status}`);
            // Try next attempt
            apiCheckAttempt++;
            if (apiCheckAttempt < maxApiCheckAttempts) {
              await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay before retry
            }
          }
        } catch (error: any) {
          console.log(` [ELECTRON IPC] API connection error for chat:`, error);
          // Try next attempt
          apiCheckAttempt++;
          if (apiCheckAttempt < maxApiCheckAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay before retry
          }
        }
      }
      
      // Main chat request with retries
      let attempts = 0;
      const maxAttempts = 3;
      let lastError = null;
      
      while (attempts < maxAttempts) {
        attempts++;
        console.log(` [ELECTRON IPC] Chat API request attempt ${attempts}/${maxAttempts}`);
        
        try {
          // Use AbortController for timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
          
          // Debug: Log the exact URL and token being used
          console.log(` [ELECTRON IPC] Sending request to: ${API_URL}/api/chat`);
          
          const chatEndpoint = `${API_URL}/api/chat`;
          
          const response = await fetch(chatEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': `wos-session=${accessToken}`, // Standard auth header
              'Accept': 'application/json', // Expect JSON back
            },
            body: JSON.stringify({ 
              messages,
              timeout: 25,
              temperature: 0.7,
              stream: false // Disable streaming for now
            }),
            signal: controller.signal
          }); 
          
          clearTimeout(timeoutId);
          
          // Check if response is ok
          if (!response.ok) {
            const statusCode = response.status;
            console.error(` [ELECTRON IPC] Chat API error: ${statusCode} ${response.statusText}`);
            
            // Log detailed info for 302 redirects
            if (statusCode === 302) {
              console.log(` [ELECTRON IPC] 🔍 DEBUGGING REDIRECT - Status Code: ${statusCode}`);
              console.log(` [ELECTRON IPC] 🔍 Response headers:`, Object.fromEntries([...response.headers]));
              console.log(` [ELECTRON IPC] 🔍 Cookie used: wos-session=${accessToken ? accessToken.substring(0, 10) + '...' : 'null'}`);
              
              // Get the location header to see where it's trying to redirect
              const location = response.headers.get('location');
              if (location) {
                console.log(` [ELECTRON IPC] 🔍 Redirect location: ${location}`);
              }
              
              // Try to get response body even from error responses
              try {
                const errorBody = await response.text();
                console.log(` [ELECTRON IPC] 🔍 Redirect response body: ${errorBody}`);
              } catch (e) {
                console.log(` [ELECTRON IPC] 🔍 Couldn't read redirect response body: ${e}`);
              }
            }
            
            // Special handling for specific status codes
            if (statusCode === 401 || statusCode === 403) {
              // Authentication issue - no need to retry
              return {
                role: 'assistant',
                content: "I'm sorry, but your session has expired. Please log in again to continue using the chat feature."
              };
            }
            
            if (statusCode === 429) {
              // Rate limit - wait longer before retrying
              console.log(` [ELECTRON IPC] Rate limited, waiting before retry`);
              await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
              continue;
            }
            
            if (statusCode >= 500) {
              // Server error - may be worth retrying
              lastError = new Error(`Server error (${statusCode})`);
              // Exponential backoff
              await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
              continue;
            }
            
            // Other errors - provide appropriate message based on status code
            return {
              role: 'assistant',
              content: "I'm sorry, but I encountered an error processing your request. " +
                       "This could be due to a temporary service disruption. " + 
                       "Please try again later or contact support if the issue persists."
            };
          }
          
          // Log response details
          console.log(` [ELECTRON IPC] Response status: ${response.status} ${response.statusText}`);
          console.log(` [ELECTRON IPC] Response headers:`, Object.fromEntries([...response.headers]));
          
          // Get response text
          const responseText = await response.text();
          console.log(' [ELECTRON IPC] Chat response received');
          
          // Debug: Log a preview of the response content
          console.log(` [ELECTRON IPC] Response text (first 100 chars): ${responseText.substring(0, 100)}...`);
          
          // Check if the response is empty
          if (!responseText || responseText.trim() === '') {
            console.error(' [ELECTRON IPC] Empty response received');
            if (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
              continue;
            } else {
              return {
                role: 'assistant',
                content: "I'm sorry, but I received an empty response from our servers. This might be a temporary issue. Please try again later."
              };
            }
          }
          
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
          
          // Check if we successfully parsed any content
          if (assistantMessage) {
            return {
              role: 'assistant',
              content: assistantMessage
            };
          } else {
            // If no content was parsed but we got a response, try to use a different parsing approach
            try {
              // Attempt to parse as a direct JSON response
              const jsonResponse = JSON.parse(responseText);
              if (jsonResponse.text || jsonResponse.content || jsonResponse.message) {
                return {
                  role: 'assistant',
                  content: jsonResponse.text || jsonResponse.content || jsonResponse.message
                };
              }
            } catch (e) {
              // Not JSON or unexpected format
              console.error(' [ELECTRON IPC] Could not parse response as JSON:', e);
            }
            
            // Use the response text directly as a last resort
            // Strip any non-textual elements that might be in the response
            const cleanedText = responseText.replace(/^data:\s*|[\{\}\[\]"']/g, '').trim();
            if (cleanedText) {
              return {
                role: 'assistant',
                content: cleanedText.length > 1000 ? 
                  cleanedText.substring(0, 1000) + "... (response truncated)" : 
                  cleanedText
              };
            }
            
            // If we get here, we couldn't extract a useful response
            if (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
              continue;
            }
          }
          
        } catch (error: any) {
          console.error(` [ELECTRON IPC] Error on attempt ${attempts}:`, error);
          lastError = error;
          
          // Check if it's a timeout or abort error
          if (error.name === 'AbortError') {
            console.log(' [ELECTRON IPC] Request timed out, retrying...');
          }
          
          // Wait before retrying with exponential backoff
          if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
            continue;
          }
        }
      }
      
      // If we've exhausted all retries
      console.error(' [ELECTRON IPC] All retry attempts failed:', lastError);
      
      // Use local fallback response when API is down
      const userMessage = messages[messages.length - 1]?.content || '';
      const isGreeting = /^(hi|hello|hey|greetings|howdy)/i.test(userMessage);
      const isQuestion = /\?$/.test(userMessage);
      const isAboutNotes = /note|editor|document|writing|text|content|save|edit/i.test(userMessage);
      const isAboutWorkspace = /workspace|folder|organize|project/i.test(userMessage);
      const isAboutSync = /sync|offline|connection|internet|cloud/i.test(userMessage);
      
      // Determine response based on message content
      let localResponse = '';
      
      if (isGreeting) {
        localResponse = "Hello! I'm currently operating in offline mode due to server connectivity issues. " +
                       "I can help with basic information about using the app, but my capabilities are limited until the server connection is restored.";
      } else if (isAboutNotes) {
        localResponse = "You can create and edit notes even while offline. Your changes will be saved locally and will sync when the server connection is restored.";
      } else if (isAboutWorkspace) {
        localResponse = "Workspaces help you organize your notes. You can create multiple workspaces and add notes to them.";
      } else if (isAboutSync) {
        localResponse = "The app is currently having trouble connecting to the sync server. Your changes are being saved locally and will sync automatically when the connection is restored.";
      } else if (isQuestion) {
        localResponse = "I'm sorry, I can't answer that question right now because I'm operating in offline mode due to server connectivity issues. Please try again later when the server connection is restored.";
      } else {
        localResponse = "I'm sorry, but I'm having trouble connecting to our servers after multiple attempts. " +
                       "I'm operating in a limited offline mode for now. Your work is still being saved locally " +
                       "and will sync when connectivity is restored.";
      }
      
      return {
        role: 'assistant',
        content: localResponse
      };
      
    } catch (error: any) {
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
