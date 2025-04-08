// Types for the local database
export interface Page {
  id: string;
  title: string;
  parent_id: string | null;
  user_id: string;
  is_favorite: boolean;
  type: string | null;
  created_at: string;
  updated_at: string;
  sync_status: 'synced' | 'pending' | 'conflict';
  server_updated_at: string | null;
  client_updated_at: string | null;
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
  client_updated_at: string | null;
}

// Type definitions for the Electron API
declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        invoke(channel: string, ...args: any[]): Promise<any>;
        send(channel: string, data: any): void;
        receive(channel: string, func: (...args: any[]) => void): void;
        on(channel: string, callback: (...args: any[]) => void): void;
        removeListener(channel: string, callback: (...args: any[]) => void): void;
      };
    };
  }
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

// Create service instances using IPC to communicate with Electron main process
export const dbPages: DbPagesService = {
  getPages: async (parentId?: string) => {
    if (!isElectron()) {
      console.log('Running in browser mode - returning mock data for pages');
      return [];
    }
    
    try {
      return await window.electron.ipcRenderer.invoke('db:get-pages', parentId);
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
      return await window.electron.ipcRenderer.invoke('db:get-page', id);
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
      return await window.electron.ipcRenderer.invoke('db:create-page', pageData);
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
      return await window.electron.ipcRenderer.invoke('db:update-page', id, updates);
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
      const result = await window.electron.ipcRenderer.invoke('db:delete-page', id);
      return result.success;
    } catch (error) {
      console.error('Error deleting page:', error);
      return false;
    }
  }
};

export const dbBlocks: DbBlocksService = {
  getBlocks: async (pageId: string) => {
    if (!isElectron()) {
      console.log('Running in browser mode - returning mock data for blocks');
      return [];
    }
    
    try {
      return await window.electron.ipcRenderer.invoke('db:get-blocks', pageId);
    } catch (error) {
      console.error('Error getting blocks:', error);
      return [];
    }
  },

  getBlock: async (id: string) => {
    if (!isElectron()) {
      console.log('Running in browser mode - returning mock data for block');
      return null;
    }
    
    try {
      return await window.electron.ipcRenderer.invoke('db:get-block', id);
    } catch (error) {
      console.error('Error getting block:', error);
      return null;
    }
  },

  createBlock: async (blockData: Omit<Block, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>) => {
    if (!isElectron()) {
      console.log('Running in browser mode - mock block creation');
      return null;
    }
    
    try {
      return await window.electron.ipcRenderer.invoke('db:create-block', blockData);
    } catch (error) {
      console.error('Error creating block:', error);
      return null;
    }
  },

  updateBlock: async (id: string, updates: Partial<Omit<Block, 'id' | 'page_id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>) => {
    if (!isElectron()) {
      console.log('Running in browser mode - mock block update');
      return null;
    }
    
    try {
      return await window.electron.ipcRenderer.invoke('db:update-block', id, updates);
    } catch (error) {
      console.error('Error updating block:', error);
      return null;
    }
  },

  deleteBlock: async (id: string) => {
    if (!isElectron()) {
      console.log('Running in browser mode - mock block deletion');
      return true;
    }
    
    try {
      const result = await window.electron.ipcRenderer.invoke('db:delete-block', id);
      return result.success;
    } catch (error) {
      console.error('Error deleting block:', error);
      return false;
    }
  },

  updateBlocksBatch: async (blocks: Array<Block | Partial<Block> & { id: string }>) => {
    if (!isElectron()) {
      console.log('Running in browser mode - mock blocks batch update');
      return true;
    }
    
    try {
      const result = await window.electron.ipcRenderer.invoke('db:update-blocks-batch', blocks);
      return result.success;
    } catch (error) {
      console.error('Error updating blocks batch:', error);
      return false;
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
      return await window.electron.ipcRenderer.invoke('sync:request-sync');
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
      return await window.electron.ipcRenderer.invoke('sync:get-network-status');
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
      return await window.electron.ipcRenderer.invoke('sync:set-online-status', isOnline);
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
      return await window.electron.ipcRenderer.invoke('db:get-pending-changes-count');
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
