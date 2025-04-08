import { getUrl } from '../api';
import { Database, Tables } from '../../types/db';

// Types
export type Block = Tables<'blocks'>;
export type BlockInsert = Database['public']['Tables']['blocks']['Insert'];
export type BlockUpdate = Database['public']['Tables']['blocks']['Update'];

export interface CreateBlockRequest {
  pageId: string;
  type: string;
  content?: string;
  metadata?: Record<string, any>;
  orderIndex: number;
}

export interface UpdateBlockRequest {
  type?: string;
  content?: string;
  metadata?: Record<string, any>;
  orderIndex?: number;
}

export interface BatchUpdateBlocksRequest {
  pageId: string;
  blocks: (UpdateBlockRequest & { id: string; _action?: 'update' | 'delete' } | CreateBlockRequest & { _action: 'create' })[];
}

// API functions
export async function getBlocks(pageId: string): Promise<Block[]> {
  const response = await fetch(getUrl(`/api/blocks?pageId=${pageId}`), {
    method: 'GET',
    credentials: 'include',
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch blocks: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.blocks;
}

export async function createBlock(blockData: CreateBlockRequest): Promise<Block> {
  const response = await fetch(getUrl('/api/blocks'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(blockData),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create block: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.block;
}

export async function updateBlock(blockId: string, blockData: UpdateBlockRequest): Promise<Block> {
  const response = await fetch(getUrl(`/api/blocks/${blockId}`), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(blockData),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to update block: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.block;
}

export async function deleteBlock(blockId: string): Promise<void> {
  const response = await fetch(getUrl(`/api/blocks/${blockId}`), {
    method: 'DELETE',
    credentials: 'include',
  });
  
  if (!response.ok) {
    throw new Error(`Failed to delete block: ${response.statusText}`);
  }
}

export async function updateBlocks(batchData: BatchUpdateBlocksRequest): Promise<{
  updated: Block[];
  created: Block[];
  deleted: string[];
}> {
  const response = await fetch(getUrl('/api/blocks/batch'), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(batchData),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to update blocks: ${response.statusText}`);
  }
  
  return await response.json();
}
