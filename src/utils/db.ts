// Types for the local database
export interface Page {
  id: string;
  title: string;
  parent_id: string | null;
  user_id: string;
  is_favorite: number;
  type: string | null;
  created_at: string;
  updated_at: string;
  sync_status: 'synced' | 'pending' | 'conflict';
  server_updated_at: string | null;
  // Removed client_updated_at field to match backend schema
}

export interface Block {
  id: string;
  page_id: string;
  user_id: string;
  type: string;
  content: string | null;
  metadata: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
  sync_status: 'synced' | 'pending' | 'conflict';
  server_updated_at: string | null;
  // Removed client_updated_at field to match backend schema
}

// Database service interfaces
export interface DbPagesService {
  getPages(parentId?: string): Promise<Page[]>;
  getPage(id: string): Promise<{ page: Page; blocks: Block[] } | null>;
  createPage(pageData: Omit<Page, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>): Promise<Page | null>;
  updatePage(id: string, updates: Partial<Omit<Page, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>): Promise<Page | null>;
  deletePage(id: string): Promise<boolean>;
}

export interface DbBlocksService {
  getBlocks(pageId: string): Promise<Block[]>;
  getBlock(id: string): Promise<Block | null>;
  createBlock(blockData: Omit<Block, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>): Promise<Block | null>;
  updateBlock(id: string, updates: Partial<Omit<Block, 'id' | 'page_id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>): Promise<Block | null>;
  deleteBlock(id: string): Promise<boolean>;
  updateBlocksBatch(blocks: Array<Block | Partial<Block> & { id: string }>): Promise<boolean>;
}

export interface DbSyncService {
  requestSync(): Promise<{ success: boolean; error?: string }>;
  getNetworkStatus(): Promise<{ isOnline: boolean }>;
  setOnlineStatus(isOnline: boolean): Promise<{ success: boolean }>;
  getPendingChangesCount(): Promise<number>;
}

// Helper to check if we're running in Electron
const isElectron = () => {
  return window.electron !== undefined;
};

const ipcCall = <T = any>(channel: string, ...args: any[]): Promise<T> =>
  window.electron.ipcRenderer.invoke(channel, ...args);

// Create service instances using IPC to communicate with Electron main process
export const dbPages: DbPagesService = {
  getPages: async (parentId?: string) => {
    if (!isElectron()) {
      console.log('Running in browser mode - returning mock data for pages');
      return [];
    }
    
    try {
      return await ipcCall<Page[]>('db:get-pages', parentId);
    } catch (error) {
      console.error('Error getting pages:', error);
      return [];
    }
  },

  getPage: async (id: string) => {
    if (!isElectron()) {
      console.log('Running in browser mode - returning mock data for page');
      return null;
    }
    
    try {
      return await ipcCall<{ page: Page; blocks: Block[] }>('db:get-page', id);
    } catch (error) {
      console.error('Error getting page:', error);
      return null;
    }
  },

  createPage: async (pageData: Omit<Page, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>) => {
    if (!isElectron()) {
      console.log('Running in browser mode - mock page creation');
      return null;
    }
    
    try {
      console.log('[Frontend] Creating page with data:', JSON.stringify(pageData, null, 2));
      console.log('[Frontend] User ID being sent:', pageData.user_id);
      
      const result = await ipcCall<Page>('db:create-page', pageData);
      console.log('[Frontend] Page created result:', JSON.stringify(result, null, 2));
      return result;
    } catch (error) {
      console.error('Error creating page:', error);
      return null;
    }
  },

  updatePage: async (id: string, updates: Partial<Omit<Page, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>) => {
    if (!isElectron()) {
      console.log('Running in browser mode - mock page update');
      return null;
    }
    
    try {
      return await ipcCall<Page>('db:update-page', id, updates);
    } catch (error) {
      console.error('Error updating page:', error);
      return null;
    }
  },

  deletePage: async (id: string) => {
    if (!isElectron()) {
      console.log('Running in browser mode - mock page deletion');
      return true;
    }
    
    try {
      const result = await ipcCall<{ success: boolean }>('db:delete-page', id);
      return result.success;
    } catch (error) {
      console.error('Error deleting page:', error);
      return false;
    }
  }
};

export const dbBlocks: DbBlocksService = {
  getBlocks: async (pageId: string) => {
    console.log('📘 [FRONTEND API] Getting blocks for page:', pageId);
    if (!isElectron()) {
      console.log('Running in browser mode - returning mock data for blocks');
      return [];
    }
    
    try {
      const blocks = await ipcCall<Block[]>('db:get-blocks', pageId);
      console.log(`📘 [FRONTEND API] Retrieved ${blocks.length} blocks for page:`, pageId);
      return blocks;
    } catch (error) {
      console.error('📘 [FRONTEND API] Error getting blocks:', error);
      throw error;
    }
  },

  getBlock: async (id: string) => {
    console.log('📘 [FRONTEND API] Getting block by ID:', id);
    if (!isElectron()) {
      console.log('Running in browser mode - returning mock data for block');
      return null;
    }
    
    try {
      const block = await ipcCall<Block>('db:get-block', id);
      console.log('📘 [FRONTEND API] Retrieved block:', block?.id);
      return block;
    } catch (error) {
      console.error('📘 [FRONTEND API] Error getting block:', error);
      throw error;
    }
  },

  createBlock: async (blockData: Omit<Block, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>) => {
    console.log('📘 [FRONTEND API] Creating block with ID:', blockData.id);
    console.log('📘 [FRONTEND API] Block data:', {
      ...blockData,
      content: blockData.content ? `${blockData.content.substring(0, 50)}... (${blockData.content.length} chars)` : null
    });
    
    if (!isElectron()) {
      console.log('Running in browser mode - mock block creation');
      return null;
    }
    
    try {
      const result = await ipcCall<Block>('db:create-block', blockData);
      console.log('📘 [FRONTEND API] Block created successfully:', result?.id);
      return result;
    } catch (error) {
      console.error('📘 [FRONTEND API] Error creating block:', error);
      throw error;
    }
  },

  updateBlock: async (id: string, updates: Partial<Omit<Block, 'id' | 'page_id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>) => {
    console.log('📘 [FRONTEND API] Updating block:', id);
    console.log('📘 [FRONTEND API] Update data:', {
      ...updates,
      content: updates.content ? `${updates.content.substring(0, 50)}... (${updates.content.length} chars)` : undefined
    });
    
    if (!isElectron()) {
      console.log('Running in browser mode - mock block update');
      return null;
    }
    
    try {
      const result = await ipcCall<Block>('db:update-block', id, updates);
      console.log('📘 [FRONTEND API] Block updated successfully:', result?.id);
      return result;
    } catch (error) {
      console.error('📘 [FRONTEND API] Error updating block:', error);
      throw error;
    }
  },

  deleteBlock: async (id: string) => {
    console.log('📘 [FRONTEND API] Deleting block:', id);
    if (!isElectron()) {
      console.log('Running in browser mode - mock block deletion');
      return true;
    }
    
    try {
      await ipcCall<{ success: boolean }>('db:delete-block', id);
      console.log('📘 [FRONTEND API] Block deleted successfully:', id);
      return true;
    } catch (error) {
      console.error('📘 [FRONTEND API] Error deleting block:', error);
      throw error;
    }
  },

  updateBlocksBatch: async (blocks: Array<Block | Partial<Block> & { id: string }>) => {
    console.log(`📘 [FRONTEND API] Batch updating ${blocks.length} blocks`);
    if (!isElectron()) {
      console.log('Running in browser mode - mock blocks batch update');
      return true;
    }
    
    try {
      const result = await ipcCall<{ success: boolean }>('db:update-blocks-batch', blocks);
      console.log('📘 [FRONTEND API] Blocks batch updated successfully');
      return result.success;
    } catch (error) {
      console.error('📘 [FRONTEND API] Error batch updating blocks:', error);
      throw error;
    }
  }
};

export const dbSync: DbSyncService = {
  requestSync: async () => {
    if (!isElectron()) {
      console.log('Running in browser mode - mock sync request');
      return { success: true };
    }
    
    try {
      return await ipcCall<{ success: boolean; error?: string }>('sync:request-sync');
    } catch (error) {
      console.error('Error requesting sync:', error);
      return { success: false, error: String(error) };
    }
  },

  getNetworkStatus: async () => {
    if (!isElectron()) {
      console.log('Running in browser mode - assuming online');
      return { isOnline: true };
    }
    
    try {
      return await ipcCall<{ isOnline: boolean }>('sync:get-network-status');
    } catch (error) {
      console.error('Error getting network status:', error);
      return { isOnline: true };
    }
  },

  setOnlineStatus: async (isOnline: boolean) => {
    if (!isElectron()) {
      console.log('Running in browser mode - mock setting online status');
      return { success: true };
    }
    
    try {
      return await ipcCall<{ success: boolean }>('sync:set-online-status', isOnline);
    } catch (error) {
      console.error('Error setting online status:', error);
      return { success: false };
    }
  },

  getPendingChangesCount: async () => {
    if (!isElectron()) {
      console.log('Running in browser mode - mock pending changes count');
      return 0;
    }
    
    try {
      return await ipcCall<number>('db:get-pending-sync-count');
    } catch (error) {
      console.error('Error getting pending changes count:', error);
      return 0;
    }
  }
};

// Network status detection
export const setupNetworkDetection = (): void => {
  // Update network status when it changes
  const updateNetworkStatus = async (): Promise<void> => {
    const isOnline = navigator.onLine;
    await dbSync.setOnlineStatus(isOnline);
  };

  // Set up event listeners for online/offline events
  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);

  // Initial check
  updateNetworkStatus();
};
