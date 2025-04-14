import { Workspace, Note, Block } from "../../types";
import { ipcCall, isElectron } from "../utils/helpers";
  
  // Database service interfaces
  export interface DbWorkspacesService {
    getWorkspaces(): Promise<Workspace[] | null>;
    getWorkspace(id: string): Promise<Workspace | null>;
    createWorkspace(workspaceData: Omit<Workspace, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>): Promise<Workspace | null>;
    updateWorkspace(id: string, updates: Partial<Omit<Workspace, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>): Promise<Workspace | null>;
    deleteWorkspace(id: string): Promise<boolean>;
  }
  
  export interface DbNotesService {
    getNotes(workspaceId?: string, parentId?: string): Promise<Note[]>;
    getNote(id: string): Promise<{ note: Note; blocks: Block[] } | null>;
    createNote(noteData: Omit<Note, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>): Promise<Note | null>;
    updateNote(id: string, updates: Partial<Omit<Note, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>): Promise<Note | null>;
    deleteNote(id: string): Promise<boolean>;
  }

  
  export interface DbBlocksService {
    getBlocks(noteId: string): Promise<Block[]>;
    getBlock(id: string): Promise<Block | null>;
    createBlock(blockData: Omit<Block, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>): Promise<Block | null>;
    updateBlock(id: string, updates: Partial<Omit<Block, 'id' | 'note_id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>): Promise<Block | null>;
    deleteBlock(id: string): Promise<boolean>;
    updateBlocksBatch(blocks: Array<Block | Partial<Block> & { id: string }>): Promise<boolean>;
  }
  
  export interface DbSyncService {
    requestSync(): Promise<{ success: boolean; error?: string }>;
    getNetworkStatus(): Promise<{ isOnline: boolean }>;
    setOnlineStatus(isOnline: boolean): Promise<{ success: boolean }>;
    getPendingChangesCount(): Promise<number>;
  }
  
  // Create service instances using IPC to communicate with Electron main process
  // Create the Notes service that communicates directly with the new IPC channels
  export const dbNotes: DbNotesService = {
    getNotes: async (workspaceId?: string, parentId?: string) => {
      if (!isElectron()) {
        console.log('Running in browser mode - returning mock data for notes');
        return [];
      }
      
      try {
        return await ipcCall<Note[]>('db:get-notes', workspaceId, parentId);
      } catch (error) {
        console.error('Error getting notes:', error);
        return [];
      }
    },
  
    getNote: async (id: string) => {
      if (!isElectron()) {
        console.log('Running in browser mode - returning mock data for note');
        return null;
      }
      
      try {
        return await ipcCall<{ note: Note; blocks: Block[] }>('db:get-note', id);
      } catch (error) {
        console.error('Error getting note:', error);
        return null;
      }
    },
  
    createNote: async (noteData: Omit<Note, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>) => {
      if (!isElectron()) {
        console.log('Running in browser mode - mock note creation');
        return null;
      }
      
      try {
        console.log('[Frontend] Creating note with data:', JSON.stringify(noteData, null, 2));
        console.log('[Frontend] User ID being sent:', noteData.user_id);
        
        const result = await ipcCall<Note>('db:create-note', noteData);
        console.log('[Frontend] Note created result:', JSON.stringify(result, null, 2));
        return result;
      } catch (error) {
        console.error('Error creating note:', error);
        return null;
      }
    },
  
    updateNote: async (id: string, updates: Partial<Omit<Note, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>) => {
      if (!isElectron()) {
        console.log('Running in browser mode - mock note update');
        return null;
      }
      
      try {
        return await ipcCall<Note>('db:update-note', id, updates);
      } catch (error) {
        console.error('Error updating note:', error);
        return null;
      }
    },
  
    deleteNote: async (id: string) => {
      if (!isElectron()) {
        console.log('Running in browser mode - mock note deletion');
        return true;
      }
      
      try {
        const result = await ipcCall<{ success: boolean }>('db:delete-note', id);
        return result.success;
      } catch (error) {
        console.error('Error deleting note:', error);
        return false;
      }
    }
  };
  
  
  export const dbBlocks: DbBlocksService = {
    getBlocks: async (noteId: string) => {
      console.log('📘 [FRONTEND API] Getting blocks for note:', noteId);
      if (!isElectron()) {
        console.log('Running in browser mode - returning mock data for blocks');
        return [];
      }
      
      try {
        const blocks = await ipcCall<Block[]>('db:get-blocks', noteId);
        console.log(`📘 [FRONTEND API] Retrieved ${blocks.length} blocks for note:`, noteId);
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
  
    updateBlock: async (id: string, updates: Partial<Omit<Block, 'id' | 'note_id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>) => {
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
  
  // Create the Workspaces service that communicates with the IPC handlers
  export const dbWorkspaces: DbWorkspacesService = {
    getWorkspaces: async () => {
      if (!isElectron()) {
        console.log('Running in browser mode - returning mock data for workspaces');
        return [];
      }
      
      try {
        return await ipcCall<Workspace[]>('db:get-workspaces');
      } catch (error) {
        console.error('Error getting workspaces:', error);
        return [];
      }
    },
  
    getWorkspace: async (id: string) => {
      if (!isElectron()) {
        console.log('Running in browser mode - returning mock data for workspace');
        return null;
      }
      
      try {
        return await ipcCall<Workspace | null>('db:get-workspace', id);
      } catch (error) {
        console.error('Error getting workspace:', error);
        return null;
      }
    },
  
    createWorkspace: async (workspaceData: Omit<Workspace, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>) => {
      if (!isElectron()) {
        console.log('Running in browser mode - mock workspace creation');
        return null;
      }
      
      try {
        console.log('[Frontend] Creating workspace with data:', JSON.stringify(workspaceData, null, 2));
        console.log('[Frontend] User ID being sent:', workspaceData.user_id);
        
        const result = await ipcCall<Workspace>('db:create-workspace', workspaceData);
        console.log('[Frontend] Workspace created result:', JSON.stringify(result, null, 2));
        return result;
      } catch (error) {
        console.error('Error creating workspace:', error);
        return null;
      }
    },
  
    updateWorkspace: async (id: string, updates: Partial<Omit<Workspace, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>) => {
      if (!isElectron()) {
        console.log('Running in browser mode - mock workspace update');
        return null;
      }
      
      try {
        return await ipcCall<Workspace>('db:update-workspace', id, updates);
      } catch (error) {
        console.error('Error updating workspace:', error);
        return null;
      }
    },
  
    deleteWorkspace: async (id: string) => {
      if (!isElectron()) {
        console.log('Running in browser mode - mock workspace deletion');
        return true;
      }
      
      try {
        const result = await ipcCall<{ success: boolean }>('db:delete-workspace', id);
        return result.success;
      } catch (error) {
        console.error('Error deleting workspace:', error);
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