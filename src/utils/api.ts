// Types for API operations - these are now handled directly through the database utilities

// Page types
export interface CreatePageRequest {
  title: string;
  parentId?: string;
  type?: string;
}

export interface UpdatePageRequest {
  title?: string;
  parentId?: string;
  isFavorite?: boolean;
  type?: string;
}

// Block types
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

// Helper function for API URL (kept for backward compatibility)
export function getUrl(endpoint: string) {
  return `${import.meta.env.VITE_API_URL}${endpoint}`;
}