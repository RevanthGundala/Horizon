import { useQuery, useMutation, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import { Store, useStore } from '@tanstack/react-store';
import { useEffect } from 'react';
import { dbBlocks } from '../services/DataService';
import { v4 as uuidv4 } from 'uuid';
import { Block } from '../../types';

// Define the store state
interface BlocksState {
  blocks: Record<string, Block>;
  pageId: string | null; // This represents the note_id
  pendingChanges: {
    updated: Record<string, Block>;
    created: Record<string, Omit<Block, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'> & { tempId: string }>;
    deleted: string[];
  };
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
}

// Define the type for a pending created block with note_id
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
      console.error('Cannot create block: No page ID set');
      return state;
    }
    
    console.log('Creating block locally with tempId:', tempId);
    
    // Create a new pending block
    const newBlock: PendingCreatedBlock = {
      tempId,
      note_id: state.pageId, // Using pageId as note_id
      user_id: '', // Will be set by the server
      type: data.type,
      content: data.content || null,
      metadata: data.metadata || null,
      order_index: data.order_index
    };
    
    // Add to pending changes
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
  blockStore.setState((state) => ({ ...state, isSaving: true, error: null }));
  
  try {
    const { pendingChanges, pageId } = blockStore.state;
    
    if (!pageId) {
      throw new Error('No page ID set');
    }
    
    console.log('Saving changes for page:', pageId);
    console.log('Pending created blocks:', Object.keys(pendingChanges.created).length);
    console.log('Pending updated blocks:', Object.keys(pendingChanges.updated).length);
    console.log('Pending deleted blocks:', pendingChanges.deleted.length);
    
    // Process created blocks
    const createdBlocks = Object.values(pendingChanges.created);
    for (const pendingBlock of createdBlocks) {
      const { tempId, ...blockData } = pendingBlock;
      
      // Create the block in the database
      const newBlock = await dbBlocks.createBlock({
        ...blockData,
        id: uuidv4(), // Generate a new ID for the block
        note_id: pageId // Using pageId as the note_id
      });
      
      if (newBlock) {
        console.log('Created block in database:', newBlock.id);
        
        // Update the local store with the new block
        blockStore.setState((state) => {
          const newBlocks = { ...state.blocks };
          newBlocks[newBlock.id] = newBlock;
          
          // Remove from pending created
          const newCreated = { ...state.pendingChanges.created };
          delete newCreated[tempId];
          
          return {
            ...state,
            blocks: newBlocks,
            pendingChanges: {
              ...state.pendingChanges,
              created: newCreated
            }
          };
        });
      }
    }
    
    // Process updated blocks
    const updatedBlocks = Object.values(pendingChanges.updated);
    for (const block of updatedBlocks) {
      const { id, note_id, user_id, created_at, updated_at, sync_status, server_updated_at, ...updates } = block;
      
      // Update the block in the database
      await dbBlocks.updateBlock(id, updates);
      console.log('Updated block in database:', id);
    }
    
    // Process deleted blocks
    for (const blockId of pendingChanges.deleted) {
      // Delete the block in the database
      await dbBlocks.deleteBlock(blockId);
      console.log('Deleted block from database:', blockId);
    }
    
    // Refresh blocks from the database
    const refreshedBlocks = await dbBlocks.getBlocks(pageId);
    setBlocks(refreshedBlocks, pageId);
    
    // Set saving to false
    blockStore.setState((state) => ({ ...state, isSaving: false }));
    
    console.log('All changes saved successfully');
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
        .then((blocks: Block[]) => setBlocks(blocks, pageId))
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
    mutationFn: async (blockData: Omit<Block, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>) => {
      console.log('🔶 [FRONTEND HOOK] Creating block:', {
        id: blockData.id,
        note_id: blockData.note_id,
        type: blockData.type,
        contentLength: blockData.content ? blockData.content.length : 0,
        order_index: blockData.order_index
      });
      
      try {
        const result = await dbBlocks.createBlock(blockData);
        console.log('🔶 [FRONTEND HOOK] Block created successfully:', result?.id);
        return result;
      } catch (error) {
        console.error('🔶 [FRONTEND HOOK] Error creating block:', error);
        throw error;
      }
    },
    onSuccess: (newBlock: Block | null) => {
      if (newBlock) {
        console.log('🔶 [FRONTEND HOOK] Invalidating queries for note:', newBlock.note_id);
        queryClient.invalidateQueries({
          queryKey: blocksKeys.list({ pageId: newBlock.note_id }),
        });
      }
    },
    onError: (error) => {
      console.error('🔶 [FRONTEND HOOK] Mutation error in useCreateBlock:', error);
    }
  });
}

export function useUpdateBlock() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Omit<Block, 'id' | 'note_id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>> }) => {
      console.log('🔶 [FRONTEND HOOK] Updating block:', {
        id,
        contentLength: updates.content ? updates.content.length : undefined,
        type: updates.type,
        order_index: updates.order_index
      });
      
      try {
        const result = await dbBlocks.updateBlock(id, updates);
        console.log('🔶 [FRONTEND HOOK] Block updated successfully:', result?.id);
        return result;
      } catch (error) {
        console.error('🔶 [FRONTEND HOOK] Error updating block:', error);
        throw error;
      }
    },
    onSuccess: (updatedBlock: Block | null) => {
      if (updatedBlock) {
        console.log('🔶 [FRONTEND HOOK] Invalidating queries for note:', updatedBlock.note_id);
        queryClient.invalidateQueries({
          queryKey: blocksKeys.list({ pageId: updatedBlock.note_id }),
        });
      }
    },
    onError: (error) => {
      console.error('🔶 [FRONTEND HOOK] Mutation error in useUpdateBlock:', error);
    }
  });
}

export function useUpdateBlockMutation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ blockId, data }: { blockId: string; data: Partial<Omit<Block, 'id' | 'note_id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>> }) => 
      dbBlocks.updateBlock(blockId, data),
    onSuccess: (updatedBlock: Block | null) => {
      if (updatedBlock) {
        queryClient.invalidateQueries({
          queryKey: blocksKeys.list({ pageId: updatedBlock.note_id }),
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
