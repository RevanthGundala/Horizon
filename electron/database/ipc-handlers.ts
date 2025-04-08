import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import DatabaseService, { Page, Block } from './index';
import SyncService from './sync';
import AuthService from '../auth';

// Initialize database service
const db = DatabaseService.getInstance();
// Initialize sync service
const syncService = SyncService.getInstance();
// Initialize auth service
const authService = AuthService.getInstance();

// Set up IPC handlers for database operations
export function setupDatabaseIpcHandlers(): void {
  // Pages
  ipcMain.handle('db:get-pages', (_event, parentId?: string) => {
    return db.getPages(parentId);
  });

  ipcMain.handle('db:get-page', (_event, id: string) => {
    const page = db.getPage(id);
    const blocks = page ? db.getBlocks(id) : [];
    return { page, blocks };
  });

  ipcMain.handle('db:create-page', (_event, pageData: Omit<Page, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>) => {
    try {
      // Use the provided id or generate a new one
      const id = pageData.id || uuidv4();
      
      console.log(' [ELECTRON IPC] Received page data:', JSON.stringify(pageData, null, 2));
      
      // Get the current user ID from auth service
      const authUserId = authService.getUserId();
      console.log(' [ELECTRON IPC] Auth service user ID:', authUserId);
      console.log(' [ELECTRON IPC] Page data user ID:', pageData.user_id);
      
      // Ensure we have a valid user_id - never allow empty string
      let userId = pageData.user_id;
      if (!userId || userId.trim() === '') {
        userId = authUserId || 'anonymous';
        console.log(' [ELECTRON IPC] Using fallback user ID:', userId);
      }
      
      // Create a simplified page object with only the essential fields
      // Ensure is_favorite is a proper boolean
      const simplifiedPage = {
        id,
        title: pageData.title || 'Untitled Page',
        parent_id: pageData.parent_id,
        user_id: userId,
        is_favorite: pageData.is_favorite,
        type: pageData.type
      };
      
      console.log(' [ELECTRON IPC] Creating page with data:', JSON.stringify(simplifiedPage, null, 2));
      
      // Create the page in the database
      const result = db.createPage(simplifiedPage);
      console.log(' [ELECTRON IPC] Page created successfully:', result.id);
      
      return result;
    } catch (error) {
      console.error(' [ELECTRON IPC] Error creating page:', error);
      throw error;
    }
  });

  ipcMain.handle('db:update-page', (_event, id: string, updates: Partial<Omit<Page, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>) => {
    return db.updatePage(id, updates);
  });

  ipcMain.handle('db:delete-page', (_event, id: string) => {
    db.deletePage(id);
    return { success: true };
  });

  // Blocks
  ipcMain.handle('db:get-blocks', (_event, pageId: string) => {
    return db.getBlocks(pageId);
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
        page_id: blockData.page_id,
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
      
      return result;
    } catch (error) {
      console.error(' [ELECTRON IPC] Error creating block:', error);
      throw error;
    }
  });

  ipcMain.handle('db:update-block', (_event, id: string, updates: Partial<Omit<Block, 'id' | 'page_id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>) => {
    try {
      console.log(' [ELECTRON IPC] Updating block:', id);
      console.log(' [ELECTRON IPC] Update data:', JSON.stringify({
        ...updates,
        content: updates.content ? `${updates.content.substring(0, 50)}...` : undefined
      }, null, 2));
      
      // Create a sanitized updates object with only the fields that exist in the database schema
      const sanitizedUpdates: Partial<Omit<Block, 'id' | 'page_id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>> = {};
      
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

  // Sync status
  ipcMain.handle('db:get-pending-changes-count', () => {
    const { pages, blocks } = db.getEntitiesToSync();
    return pages.length + blocks.length;
  });
}
