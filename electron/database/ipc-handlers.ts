import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import DatabaseService, { Page, Block } from './index';

// Initialize database service
const db = DatabaseService.getInstance();

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
    // Use the provided id or generate a new one
    const id = pageData.id || uuidv4();
    return db.createPage({ ...pageData, id });
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
    // Use the provided id or generate a new one
    const id = blockData.id || uuidv4();
    return db.createBlock({ ...blockData, id });
  });

  ipcMain.handle('db:update-block', (_event, id: string, updates: Partial<Omit<Block, 'id' | 'page_id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>) => {
    return db.updateBlock(id, updates);
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
