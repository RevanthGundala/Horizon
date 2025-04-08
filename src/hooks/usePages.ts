import { useQuery, useMutation, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import { 
  Page as ApiPage, 
  getPages as fetchPages,
  getPage as fetchPage,
  createPage as createPageApi,
  updatePage as updatePageApi,
  deletePage as deletePageApi,
  CreatePageRequest,
  UpdatePageRequest
} from '../utils/api/pages';
import { Block as ApiBlock } from '../utils/api/blocks';
import { Page, Block, dbPages, dbSync } from '../utils/db';

// Query keys
export const pagesKeys = {
  all: ['pages'] as const,
  lists: () => [...pagesKeys.all, 'list'] as const,
  list: (filters: { parentId?: string } = {}) => [...pagesKeys.lists(), filters] as const,
  details: () => [...pagesKeys.all, 'detail'] as const,
  detail: (id: string) => [...pagesKeys.details(), id] as const,
  networkStatus: () => [...pagesKeys.all, 'networkStatus'] as const,
};

// Network status hook
export function useNetworkStatus() {
  return useQuery({
    queryKey: pagesKeys.networkStatus(),
    queryFn: () => dbSync.getNetworkStatus(),
    refetchInterval: 30000, // Check every 30 seconds
  });
}

// Manual sync hook
export function useSync() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => dbSync.requestSync(),
    onSuccess: () => {
      // Invalidate all queries to refresh data
      queryClient.invalidateQueries({ queryKey: pagesKeys.all });
    },
  });
}

// Hooks
export function usePages(parentId?: string, options?: UseQueryOptions<Page[]>) {
  return useQuery({
    queryKey: pagesKeys.list({ parentId }),
    queryFn: () => dbPages.getPages(parentId),
    ...options
  });
}

export function usePage(pageId: string, options?: UseQueryOptions<{ page: Page; blocks: Block[] } | null>) {
  return useQuery({
    queryKey: pagesKeys.detail(pageId),
    queryFn: () => dbPages.getPage(pageId),
    enabled: !!pageId,
    ...options
  });
}

export function useCreatePage() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (pageData: Omit<Page, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>) => 
      dbPages.createPage(pageData),
    onSuccess: (newPage: Page | null) => {
      if (newPage) {
        // Invalidate the pages list
        queryClient.invalidateQueries({
          queryKey: pagesKeys.list({ parentId: newPage.parent_id || undefined }),
        });
      }
    },
  });
}

export function useUpdatePage() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ pageId, data }: { pageId: string; data: Partial<Omit<Page, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>> }) => 
      dbPages.updatePage(pageId, data),
    onSuccess: (updatedPage: Page | null, { pageId }) => {
      if (updatedPage) {
        // Invalidate the pages list
        queryClient.invalidateQueries({
          queryKey: pagesKeys.lists(),
        });
        
        // Update the page in the cache
        queryClient.setQueryData(
          pagesKeys.detail(pageId),
          (oldData: { page: Page; blocks: Block[] } | null) => {
            if (!oldData) return { page: updatedPage, blocks: [] };
            return { ...oldData, page: updatedPage };
          }
        );
      }
    },
  });
}

export function useDeletePage() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (pageId: string) => dbPages.deletePage(pageId),
    onSuccess: (success: boolean, pageId: string) => {
      if (success) {
        // We need to get the parentId from the cache to invalidate the correct query
        const queryCache = queryClient.getQueryCache();
        const pageQueries = queryCache.findAll({
          queryKey: pagesKeys.detail(pageId),
        });
        
        if (pageQueries.length > 0 && pageQueries[0].state.data) {
          const pageData = pageQueries[0].state.data as { page: Page };
          if (pageData && pageData.page) {
            queryClient.invalidateQueries({
              queryKey: pagesKeys.list({ parentId: pageData.page.parent_id || undefined }),
            });
          }
        }
        
        // Invalidate all pages lists to be safe
        queryClient.invalidateQueries({
          queryKey: pagesKeys.lists(),
        });
        
        // Remove the page from the cache
        queryClient.removeQueries({
          queryKey: pagesKeys.detail(pageId),
        });
      }
    },
  });
}
