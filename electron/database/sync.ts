import { ipcMain, app } from 'electron';
import DatabaseService, { Block, Page, SyncLog } from './index';
import AuthService from '../auth';

// Define the API base URL
const API_URL = process.env.VITE_API_URL || 'https://vihy6489c7.execute-api.us-west-2.amazonaws.com/stage';

class SyncService {
  private db: DatabaseService;
  private auth: AuthService;
  private syncInterval: NodeJS.Timeout | null = null;
  private isInitialized = false;
  private isOnline = false;
  private static instance: SyncService;

  private constructor() {
    this.db = DatabaseService.getInstance();
    this.auth = AuthService.getInstance();
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
      if (this.isOnline && this.auth.isAuthenticated()) {
        this.syncWithServer();
      }
    }, 30000);
    
    this.isInitialized = true;
    
    // Sync on app start if online and authenticated
    if (this.isOnline && this.auth.isAuthenticated()) {
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
      
      // Trigger sync if we just came online
      if (isOnline) {
        this.syncWithServer();
      }
      
      return { success: true };
    });
  }

  public async checkNetworkStatus(): Promise<boolean> {
    try {
      // Try to fetch a small resource from the API
      const response = await fetch(`${API_URL}/api/status`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      
      this.isOnline = response.ok;
      return this.isOnline;
    } catch (error) {
      this.isOnline = false;
      console.log('Network check failed, device appears to be offline');
      return false;
    }
  }

  public async syncWithServer(): Promise<{ success: boolean; error?: string }> {
    if (!this.isOnline) {
      return { success: false, error: 'Offline' };
    }
    
    // Check if user is authenticated
    if (!this.auth.isAuthenticated()) {
      return { success: false, error: 'Not authenticated' };
    }
    
    try {
      // Get access token (cookie)
      const accessToken = this.auth.getAccessToken();
      if (!accessToken) {
        return { success: false, error: 'No access token available' };
      }
      
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
      // Check authentication first
      if (!this.auth.isAuthenticated()) {
        console.log('Not authenticated, skipping sync log processing');
        return;
      }
      
      // Get access token
      const accessToken = this.auth.getAccessToken();
      if (!accessToken) {
        console.log('No access token available, skipping sync log processing');
        return;
      }
      
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
      
      // Send request to API
      const response = await fetch(`${API_URL}${endpoint}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Cookie': accessToken
        },
        body: method !== 'DELETE' ? JSON.stringify(payload) : undefined
      });
      
      if (!response.ok) {
        // Handle authentication errors specifically
        if (response.status === 401 || response.status === 302) {
          console.log('Authentication error during sync log processing, user needs to log in');
          return;
        }
        
        const errorText = await response.text();
        console.error(`API Error (${response.status}): ${errorText}`);
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }
      
      // Update sync log status to success
      this.db.updateSyncLogStatus(log.id, 'success');
      
      // If successful, mark entity as synced
      if (response.status !== 204) { // No content
        const data = await response.json();
        const updatedAt = data.updatedAt || new Date().toISOString();
        this.db.markEntityAsSynced(log.entity_type, log.entity_id, updatedAt);
      } else {
        this.db.markEntityAsSynced(log.entity_type, log.entity_id, new Date().toISOString());
      }
    } catch (error) {
      console.error(`Error processing sync log ${log.id}:`, error);
      this.db.updateSyncLogStatus(log.id, 'error', String(error));
    }
  }

  private async pullUpdatesFromServer(): Promise<void> {
    console.log('Pulling updates from server:', API_URL);
    
    try {
      // Check authentication first
      if (!this.auth.isAuthenticated()) {
        console.log('Not authenticated, skipping sync');
        return;
      }
      
      // Get access token
      const accessToken = this.auth.getAccessToken();
      if (!accessToken) {
        console.log('No access token available, skipping sync');
        return;
      }
      
      // Fetch pages from server
      const pagesResponse = await fetch(`${API_URL}/api/pages`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': accessToken
        }
      });
      
      if (!pagesResponse.ok) {
        // Handle authentication errors specifically
        if (pagesResponse.status === 401 || pagesResponse.status === 302) {
          console.log('Authentication error during sync, user needs to log in');
          return;
        }
        
        const errorText = await pagesResponse.text();
        console.error(`API Error (${pagesResponse.status}): ${errorText}`);
        throw new Error(`Failed to fetch pages: ${pagesResponse.status} ${pagesResponse.statusText}`);
      }
      
      // Check if the response is valid JSON
      let pagesData;
      try {
        pagesData = await pagesResponse.json();
      } catch (error) {
        console.error('Failed to parse API response:', error);
        throw new Error('Invalid API response format');
      }
      
      // Validate the response structure
      if (!pagesData || !Array.isArray(pagesData.pages)) {
        console.error('Unexpected API response structure:', pagesData);
        throw new Error('Unexpected API response structure');
      }
      
      const serverPages = pagesData.pages as Page[];
      
      // Get all local pages
      const localPages = this.db.getPages();
      const localPagesMap = new Map<string, Page>();
      
      localPages.forEach(page => {
        localPagesMap.set(page.id, page);
      });
      
      // Process server pages
      for (const serverPage of serverPages) {
        const localPage = localPagesMap.get(serverPage.id);
        
        if (!localPage) {
          // New page from server, create locally
          const newPage = {
            ...serverPage,
            sync_status: 'synced' as const,
            server_updated_at: serverPage.updated_at
          };
          
          // Use direct SQL to bypass sync log creation
          const stmt = this.db.getDb().prepare(`
            INSERT INTO pages (id, title, parent_id, user_id, is_favorite, type, created_at, updated_at, sync_status, server_updated_at)
            VALUES (@id, @title, @parent_id, @user_id, @is_favorite, @type, @created_at, @updated_at, @sync_status, @server_updated_at)
          `);
          
          stmt.run(newPage);
          
          // Pull blocks for this page
          await this.pullBlocksForPage(serverPage.id);
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
            
            // Pull blocks for this page
            await this.pullBlocksForPage(serverPage.id);
          }
        }
        
        // Remove from map to track what's been processed
        localPagesMap.delete(serverPage.id);
      }
      
      // Any remaining pages in the map don't exist on the server
      // If they're not pending sync, they were deleted on the server
      for (const [id, page] of localPagesMap.entries()) {
        if (page.sync_status !== 'pending') {
          this.db.deletePage(id);
        }
      }
    } catch (error) {
      console.error('Error pulling updates from server:', error);
    }
  }

  private async pullBlocksForPage(pageId: string): Promise<void> {
    try {
      // Check authentication first
      if (!this.auth.isAuthenticated()) {
        console.log('Not authenticated, skipping block sync');
        return;
      }
      
      // Get access token
      const accessToken = this.auth.getAccessToken();
      if (!accessToken) {
        console.log('No access token available, skipping block sync');
        return;
      }
      
      // Fetch blocks for this page from the server
      const blocksResponse = await fetch(`${API_URL}/api/pages/${pageId}/blocks`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': accessToken
        }
      });
      
      if (!blocksResponse.ok) {
        // Handle authentication errors specifically
        if (blocksResponse.status === 401 || blocksResponse.status === 302) {
          console.log('Authentication error during block sync, user needs to log in');
          return;
        }
        
        const errorText = await blocksResponse.text();
        console.error(`API Error (${blocksResponse.status}): ${errorText}`);
        throw new Error(`Failed to fetch blocks: ${blocksResponse.status} ${blocksResponse.statusText}`);
      }
      
      // Check if the response is valid JSON
      let blocksData;
      try {
        blocksData = await blocksResponse.json();
      } catch (error) {
        console.error('Failed to parse API response:', error);
        throw new Error('Invalid API response format');
      }
      
      // Validate the response structure
      if (!blocksData || !Array.isArray(blocksData.blocks)) {
        console.error('Unexpected API response structure:', blocksData);
        throw new Error('Unexpected API response structure');
      }
      
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