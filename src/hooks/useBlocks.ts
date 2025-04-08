import { useQuery, useMutation, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import { Store, useStore } from '@tanstack/react-store';
import { useEffect } from 'react';
import { 
  Block as ApiBlock, 
  BlockInsert,
  BlockUpdate,
  getBlocks as fetchBlocks,
  createBlock as createBlockApi,
  updateBlock as updateBlockApi,
  deleteBlock as deleteBlockApi,
  updateBlocks as updateBlocksApi,
  CreateBlockRequest,
  UpdateBlockRequest,
  BatchUpdateBlocksRequest
} from '../utils/api/blocks';
import { Json } from '../types/db';
import { Block, dbBlocks, dbSync } from '../utils/db';
import { v4 as uuidv4 } from 'uuid';

// Define the store state
interface BlocksState {
  blocks: Record<string, Block>;
  pageId: string | null;
  pendingChanges: {
    updated: Record<string, Block>;
    created: Record<string, Omit<Block, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'> & { tempId: string }>;
    deleted: string[];
  };
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
}

// Define the type for a pending created block
type PendingCreatedBlock = Omit<Block, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'> & { tempId: string };

// Initial state
const initialState: BlocksState = {
  blocks: {},
  pageId: null,
  pendingChanges: {
    updated: {},
    created: {},
    deleted: []
  },
  isLoading: false,
  isSaving: false,
  error: null
};

// Create the store
export const blockStore = new Store(initialState);

// Query keys
export const blocksKeys = {
  all: ['blocks'] as const,
  lists: () => [...blocksKeys.all, 'list'] as const,
  list: (filters: { pageId: string }) => [...blocksKeys.lists(), filters] as const,
  details: () => [...blocksKeys.all, 'detail'] as const,
  detail: (id: string) => [...blocksKeys.details(), id] as const,
};

// Selectors
export const getBlocksSelector = (state: BlocksState): Block[] => {
  // Combine current blocks with pending changes
  const allBlocks = { ...state.blocks };
  
  // Remove deleted blocks
  state.pendingChanges.deleted.forEach((id: string) => {
    delete allBlocks[id];
  });
  
  // Add updated blocks
  Object.values(state.pendingChanges.updated).forEach((block: Block) => {
    allBlocks[block.id] = block;
  });
  
  // Convert to array and sort by order_index
  return Object.values(allBlocks)
    .sort((a: Block, b: Block) => a.order_index - b.order_index);
};

export const getPendingChangesCountSelector = (state: BlocksState): number => {
  const { pendingChanges } = state;
  return Object.keys(pendingChanges.updated).length + 
         Object.keys(pendingChanges.created).length + 
         pendingChanges.deleted.length;
};

// Store actions
export const setBlocks = (blocks: Block[], pageId: string): void => {
  // Convert blocks array to record for faster lookups
  const blocksRecord: Record<string, Block> = {};
  blocks.forEach(block => {
    blocksRecord[block.id] = block;
  });
  
  blockStore.setState((state) => ({
    ...state,
    blocks: blocksRecord,
    pageId,
    // Reset pending changes when loading new blocks
    pendingChanges: {
      updated: {},
      created: {},
      deleted: []
    }
  }));
};

export const updateBlock = (blockId: string, updates: Partial<Block>): void => {
  blockStore.setState((state) => {
    // Find the block
    const block = state.blocks[blockId];
    
    if (!block) {
      return state;
    }
    
    // Create updated block
    const updatedBlock = { ...block, ...updates };
    
    // Add to pending changes
    return {
      ...state,
      pendingChanges: {
        ...state.pendingChanges,
        updated: {
          ...state.pendingChanges.updated,
          [blockId]: updatedBlock
        }
      }
    };
  });
};

export const createBlockLocally = (
  tempId: string, 
  data: { 
    type: string; 
    content?: string | null; 
    metadata?: string | null;
    order_index: number;
  }
): void => {
  blockStore.setState((state) => {
    if (!state.pageId) {
      return state;
    }
    
    const newBlock: PendingCreatedBlock = {
      tempId,
      page_id: state.pageId,
      user_id: '', // Will be set by the server
      type: data.type,
      content: data.content || null,
      metadata: data.metadata || null,
      order_index: data.order_index,
      client_updated_at: new Date().toISOString()
    };
    
    return {
      ...state,
      pendingChanges: {
        ...state.pendingChanges,
        created: {
          ...state.pendingChanges.created,
          [tempId]: newBlock
        }
      }
    };
  });
};

export const deleteBlockLocally = (blockId: string): void => {
  blockStore.setState((state) => {
    // If it's a pending created block, just remove it from created
    if (state.pendingChanges.created[blockId]) {
      const { [blockId]: _, ...remainingCreated } = state.pendingChanges.created;
      
      return {
        ...state,
        pendingChanges: {
          ...state.pendingChanges,
          created: remainingCreated
        }
      };
    }
    
    // Otherwise add to deleted list
    return {
      ...state,
      pendingChanges: {
        ...state.pendingChanges,
        deleted: [...state.pendingChanges.deleted, blockId]
      }
    };
  });
};

export const reorderBlocks = (blockIds: string[]): void => {
  blockStore.setState((state) => {
    const updatedBlocks: Record<string, Block> = {};
    
    // Assign new order_index to each block
    blockIds.forEach((id, index) => {
      const block = state.blocks[id];
      
      if (block) {
        updatedBlocks[id] = {
          ...block,
          order_index: index
        };
      }
    });
    
    return {
      ...state,
      pendingChanges: {
        ...state.pendingChanges,
        updated: {
          ...state.pendingChanges.updated,
          ...updatedBlocks
        }
      }
    };
  });
};

export const saveChanges = async (): Promise<void> => {
  blockStore.setState((state) => ({
    ...state,
    isSaving: true,
    error: null
  }));
  
  try {
    const { pendingChanges, pageId } = blockStore.state;
    
    if (!pageId) {
      throw new Error('No page ID set');
    }
    
    // Process created blocks
    const createdBlocks = Object.values(pendingChanges.created);
    for (const block of createdBlocks) {
      const { tempId, ...blockData } = block;
      const newBlockId = uuidv4();
      
      // Create the block in the local database
      await dbBlocks.createBlock({
        id: newBlockId,
        page_id: blockData.page_id,
        user_id: blockData.user_id,
        type: blockData.type,
        content: blockData.content,
        metadata: blockData.metadata,
        order_index: blockData.order_index,
        client_updated_at: blockData.client_updated_at
      });
    }
    
    // Process updated blocks
    const updatedBlocks = Object.values(pendingChanges.updated);
    for (const block of updatedBlocks) {
      const { id, page_id, user_id, created_at, updated_at, sync_status, server_updated_at, ...updates } = block;
      
      // Update the block in the local database
      await dbBlocks.updateBlock(id, updates);
    }
    
    // Process deleted blocks
    for (const blockId of pendingChanges.deleted) {
      // Delete the block in the local database
      await dbBlocks.deleteBlock(blockId);
    }
    
    // Refresh blocks from the database
    const refreshedBlocks = await dbBlocks.getBlocks(pageId);
    setBlocks(refreshedBlocks, pageId);
    
    // Try to sync with server if online
    const { isOnline } = await dbSync.getNetworkStatus();
    if (isOnline) {
      dbSync.requestSync().catch(console.error);
    }
    
    blockStore.setState((state) => ({
      ...state,
      isSaving: false
    }));
  } catch (error) {
    console.error('Error saving changes:', error);
    
    blockStore.setState((state) => ({
      ...state,
      isSaving: false,
      error: error instanceof Error ? error.message : String(error)
    }));
    
    throw error;
  }
};

export const discardChanges = (): void => {
  blockStore.setState((state) => {
    const { pageId } = state;
    
    if (pageId) {
      // Reload blocks from the database
      dbBlocks.getBlocks(pageId)
        .then(blocks => setBlocks(blocks, pageId))
        .catch(console.error);
    }
    
    return {
      ...state,
      pendingChanges: {
        updated: {},
        created: {},
        deleted: []
      },
      error: null
    };
  });
};

// React Query Hooks
export function useBlocks(pageId: string, options?: UseQueryOptions<Block[]>) {
  const queryClient = useQueryClient();
  
  const { data, isLoading, error, ...rest } = useQuery({
    queryKey: blocksKeys.list({ pageId }),
    queryFn: () => dbBlocks.getBlocks(pageId),
    ...options
  });
  
  useEffect(() => {
    if (data && !isLoading) {
      setBlocks(data, pageId);
    }
  }, [data, isLoading, pageId]);
  
  return { data, isLoading, error, ...rest };
}

// Hook to access the blocks from the store
export function useBlocksStore() {
  const blocks = useStore(blockStore, getBlocksSelector);
  const pendingChangesCount = useStore(blockStore, getPendingChangesCountSelector);
  const { isSaving, error, pageId } = useStore(blockStore, state => ({
    isSaving: state.isSaving,
    error: state.error,
    pageId: state.pageId
  }));
  
  return {
    blocks,
    pendingChangesCount,
    isSaving,
    error,
    pageId,
    updateBlock,
    createBlockLocally,
    deleteBlockLocally,
    reorderBlocks,
    saveChanges,
    discardChanges
  };
}

export function useCreateBlock() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (blockData: Omit<Block, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>) => 
      dbBlocks.createBlock(blockData),
    onSuccess: (newBlock: Block | null) => {
      if (newBlock) {
        queryClient.invalidateQueries({
          queryKey: blocksKeys.list({ pageId: newBlock.page_id }),
        });
      }
    },
  });
}

export function useUpdateBlockMutation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ blockId, data }: { blockId: string; data: Partial<Omit<Block, 'id' | 'page_id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>> }) => 
      dbBlocks.updateBlock(blockId, data),
    onSuccess: (updatedBlock: Block | null) => {
      if (updatedBlock) {
        queryClient.invalidateQueries({
          queryKey: blocksKeys.list({ pageId: updatedBlock.page_id }),
        });
      }
    },
  });
}

export function useDeleteBlockMutation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (blockId: string) => dbBlocks.deleteBlock(blockId),
    onSuccess: async (success: boolean, blockId: string) => {
      if (success) {
        // Find the page ID from the cache
        const queryCache = queryClient.getQueryCache();
        const blockQueries = queryCache.findAll({
          predicate: query => {
            const queryKey = query.queryKey;
            return Array.isArray(queryKey) && 
                   queryKey[0] === 'blocks' && 
                   queryKey[1] === 'list';
          }
        });
        
        // Invalidate all block lists to be safe
        for (const query of blockQueries) {
          queryClient.invalidateQueries({ queryKey: query.queryKey });
        }
      }
    },
  });
}

export function useUpdateBlocksBatch() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ pageId, blocks }: { pageId: string; blocks: Array<Block | Partial<Block> & { id: string }> }) => 
      dbBlocks.updateBlocksBatch(blocks),
    onSuccess: (success: boolean, { pageId }) => {
      if (success) {
        queryClient.invalidateQueries({
          queryKey: blocksKeys.list({ pageId }),
        });
      }
    },
  });
}
