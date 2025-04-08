import { ipcMain, app } from 'electron';
import DatabaseService, { Block, Page, SyncLog } from './index';

// Define the API base URL
const API_URL = process.env.VITE_API_URL ;

class SyncService {
  private db: DatabaseService;
  private syncInterval: NodeJS.Timeout | null = null;
  private isInitialized = false;
  private isOnline = false;
  private static instance: SyncService;

  private constructor() {
    this.db = DatabaseService.getInstance();
    this.setupIpcHandlers();
  }

  public static getInstance(): SyncService {
    if (!SyncService.instance) {
      SyncService.instance = new SyncService();
    }
    return SyncService.instance;
  }

  public initialize(): void {
    if (this.isInitialized) return;
    
    // Check network status initially
    this.checkNetworkStatus();
    
    // Set up periodic sync (every 30 seconds)
    this.syncInterval = setInterval(() => {
      this.checkNetworkStatus();
      if (this.isOnline) {
        this.syncWithServer();
      }
    }, 30000);
    
    this.isInitialized = true;
    
    // Sync on app start if online
    if (this.isOnline) {
      this.syncWithServer();
    }
  }

  private setupIpcHandlers(): void {
    // Handle manual sync request from renderer
    ipcMain.handle('sync:request-sync', async () => {
      await this.checkNetworkStatus();
      if (this.isOnline) {
        return await this.syncWithServer();
      } else {
        return { success: false, error: 'Offline' };
      }
    });
    
    // Handle network status request from renderer
    ipcMain.handle('sync:get-network-status', () => {
      return { isOnline: this.isOnline };
    });
    
    // Handle online status change from renderer
    ipcMain.handle('sync:set-online-status', (_event, isOnline: boolean) => {
      this.isOnline = isOnline;
      this.db.updateNetworkStatus(isOnline);
      
      // Trigger sync if we just came online
      if (isOnline) {
        this.syncWithServer();
      }
      
      return { success: true };
    });
  }

  private async checkNetworkStatus(): Promise<void> {
    try {
      // Try to fetch a small resource from the API
      const response = await fetch(`${API_URL}/api/status`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      
      this.isOnline = response.ok;
    } catch (error) {
      this.isOnline = false;
    }
    
    // Update database with current status
    this.db.updateNetworkStatus(this.isOnline);
  }

  public async syncWithServer(): Promise<{ success: boolean; error?: string }> {
    if (!this.isOnline) {
      return { success: false, error: 'Offline' };
    }
    
    try {
      // Get all pending sync logs
      const pendingSyncLogs = this.db.getPendingSyncLogs();
      
      // Process each sync log
      for (const log of pendingSyncLogs) {
        await this.processSyncLog(log);
      }
      
      // Pull updates from server
      await this.pullUpdatesFromServer();
      
      return { success: true };
    } catch (error) {
      console.error('Sync error:', error);
      return { success: false, error: String(error) };
    }
  }

  private async processSyncLog(log: SyncLog): Promise<void> {
    try {
      let endpoint = '';
      let method = 'POST';
      const payload = JSON.parse(log.payload);
      
      // Determine endpoint and method based on entity type and action
      if (log.entity_type === 'page') {
        endpoint = '/api/pages';
        if (log.action === 'update') {
          endpoint += `/${log.entity_id}`;
          method = 'PUT';
        } else if (log.action === 'delete') {
          endpoint += `/${log.entity_id}`;
          method = 'DELETE';
        }
      } else if (log.entity_type === 'block') {
        endpoint = '/api/blocks';
        if (log.action === 'update') {
          endpoint += `/${log.entity_id}`;
          method = 'PUT';
        } else if (log.action === 'delete') {
          endpoint += `/${log.entity_id}`;
          method = 'DELETE';
        }
      }
      
      // Skip if no valid endpoint
      if (!endpoint) {
        this.db.updateSyncLogStatus(log.id, 'error', 'Invalid entity type or action');
        return;
      }
      
      // Prepare request
      const options: any = {
        method,
        headers: { 'Content-Type': 'application/json' },
      };
      
      // Add body for non-DELETE requests
      if (method !== 'DELETE') {
        options.body = JSON.stringify(payload);
      }
      
      // Send request
      const response = await fetch(`${API_URL}${endpoint}`, options);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} ${errorText}`);
      }
      
      // For non-DELETE requests, get the response data
      if (method !== 'DELETE') {
        const data = await response.json();
        const entity = log.entity_type === 'page' ? data.page : data.block;
        
        if (entity) {
          // Mark entity as synced
          this.db.markEntityAsSynced(
            log.entity_type,
            log.entity_id,
            entity.updated_at
          );
        }
      }
      
      // Mark sync log as successful
      this.db.updateSyncLogStatus(log.id, 'success');
    } catch (error) {
      console.error(`Error processing sync log ${log.id}:`, error);
      this.db.updateSyncLogStatus(log.id, 'error', String(error));
    }
  }

  private async pullUpdatesFromServer(): Promise<void> {
    try {
      // Get all pages
      const pagesResponse = await fetch(`${API_URL}/api/pages`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (!pagesResponse.ok) {
        throw new Error(`Failed to fetch pages: ${pagesResponse.statusText}`);
      }
      
      const pagesData = await pagesResponse.json();
      const serverPages = pagesData.pages as Page[];
      
      // Process pages
      for (const serverPage of serverPages) {
        const localPage = this.db.getPage(serverPage.id);
        
        if (!localPage) {
          // New page from server, create locally
          const newPage = {
            id: serverPage.id,
            title: serverPage.title,
            parent_id: serverPage.parent_id,
            user_id: serverPage.user_id,
            is_favorite: serverPage.is_favorite,
            type: serverPage.type,
            created_at: serverPage.created_at,
            updated_at: serverPage.updated_at,
            sync_status: 'synced' as const,
            server_updated_at: serverPage.updated_at
          };
          
          // Use direct SQL to bypass sync log creation
          const stmt = this.db.getDb().prepare(`
            INSERT INTO pages (id, title, parent_id, user_id, is_favorite, type, created_at, updated_at, sync_status, server_updated_at)
            VALUES (@id, @title, @parent_id, @user_id, @is_favorite, @type, @created_at, @updated_at, @sync_status, @server_updated_at)
          `);
          
          stmt.run(newPage);
        } else if (localPage.sync_status !== 'pending') {
          // Page exists locally and is not pending sync
          // Check if server version is newer
          const serverUpdatedAt = new Date(serverPage.updated_at).getTime();
          const localUpdatedAt = new Date(localPage.updated_at).getTime();
          
          if (serverUpdatedAt > localUpdatedAt) {
            // Server version is newer, update local
            const updatedPage = {
              ...serverPage,
              sync_status: 'synced' as const,
              server_updated_at: serverPage.updated_at
            };
            
            // Use direct SQL to bypass sync log creation
            const stmt = this.db.getDb().prepare(`
              UPDATE pages 
              SET title = @title, 
                  parent_id = @parent_id, 
                  is_favorite = @is_favorite, 
                  type = @type, 
                  updated_at = @updated_at,
                  sync_status = @sync_status,
                  server_updated_at = @server_updated_at
              WHERE id = @id
            `);
            
            stmt.run(updatedPage);
          }
        }
        
        // Now fetch blocks for this page
        await this.pullBlocksForPage(serverPage.id);
      }
    } catch (error) {
      console.error('Error pulling updates from server:', error);
    }
  }

  private async pullBlocksForPage(pageId: string): Promise<void> {
    try {
      const blocksResponse = await fetch(`${API_URL}/api/blocks?pageId=${pageId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (!blocksResponse.ok) {
        throw new Error(`Failed to fetch blocks: ${blocksResponse.statusText}`);
      }
      
      const blocksData = await blocksResponse.json();
      const serverBlocks = blocksData.blocks as Block[];
      
      // Get local blocks for this page
      const localBlocks = this.db.getBlocks(pageId);
      const localBlocksMap = new Map<string, Block>();
      
      localBlocks.forEach(block => {
        localBlocksMap.set(block.id, block);
      });
      
      // Process server blocks
      for (const serverBlock of serverBlocks) {
        const localBlock = localBlocksMap.get(serverBlock.id);
        
        if (!localBlock) {
          // New block from server, create locally
          const newBlock = {
            ...serverBlock,
            sync_status: 'synced' as const,
            server_updated_at: serverBlock.updated_at
          };
          
          // Use direct SQL to bypass sync log creation
          const stmt = this.db.getDb().prepare(`
            INSERT INTO blocks (id, page_id, user_id, type, content, metadata, order_index, created_at, updated_at, sync_status, server_updated_at)
            VALUES (@id, @page_id, @user_id, @type, @content, @metadata, @order_index, @created_at, @updated_at, @sync_status, @server_updated_at)
          `);
          
          stmt.run(newBlock);
        } else if (localBlock.sync_status !== 'pending') {
          // Block exists locally and is not pending sync
          // Check if server version is newer
          const serverUpdatedAt = new Date(serverBlock.updated_at).getTime();
          const localUpdatedAt = new Date(localBlock.updated_at).getTime();
          
          if (serverUpdatedAt > localUpdatedAt) {
            // Server version is newer, update local
            const updatedBlock = {
              ...serverBlock,
              sync_status: 'synced' as const,
              server_updated_at: serverBlock.updated_at
            };
            
            // Use direct SQL to bypass sync log creation
            const stmt = this.db.getDb().prepare(`
              UPDATE blocks 
              SET type = @type, 
                  content = @content, 
                  metadata = @metadata, 
                  order_index = @order_index, 
                  updated_at = @updated_at,
                  sync_status = @sync_status,
                  server_updated_at = @server_updated_at
              WHERE id = @id
            `);
            
            stmt.run(updatedBlock);
          }
        }
        
        // Remove from map to track what's been processed
        localBlocksMap.delete(serverBlock.id);
      }
      
      // Any remaining blocks in the map don't exist on the server
      // If they're not pending sync, they were deleted on the server
      for (const [id, block] of localBlocksMap.entries()) {
        if (block.sync_status !== 'pending') {
          this.db.deleteBlock(id);
        }
      }
    } catch (error) {
      console.error(`Error pulling blocks for page ${pageId}:`, error);
    }
  }

  public shutdown(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}

export default SyncService;
