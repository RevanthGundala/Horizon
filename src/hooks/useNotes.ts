import { useQuery, useMutation, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import { dbNotes, dbSync } from '../services/DataService';
import { Note, Block } from '../../types';

// Query keys
export const notesKeys = {
  all: ['notes'] as const,
  lists: () => [...notesKeys.all, 'list'] as const,
  list: (filters: { workspaceId?: string, parentId?: string } = {}) => [...notesKeys.lists(), filters] as const,
  details: () => [...notesKeys.all, 'detail'] as const,
  detail: (id: string) => [...notesKeys.details(), id] as const,
  networkStatus: () => [...notesKeys.all, 'networkStatus'] as const,
};

// Network status hook
export function useNetworkStatus() {
  return useQuery({
    queryKey: notesKeys.networkStatus(),
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
      queryClient.invalidateQueries({ queryKey: notesKeys.all });
    },
  });
}

// Notes Hooks
export function useNotes(workspaceId?: string, parentId?: string, options?: UseQueryOptions<Note[]>) {
  return useQuery({
    queryKey: notesKeys.list({ workspaceId, parentId }),
    queryFn: () => dbNotes.getNotes(workspaceId, parentId),
    ...options
  });
}

export function useNote(noteId: string, options?: UseQueryOptions<{ note: Note; blocks: Block[] } | null>) {
  return useQuery({
    queryKey: notesKeys.detail(noteId),
    queryFn: () => dbNotes.getNote(noteId),
    enabled: !!noteId,
    ...options
  });
}

export function useCreateNote() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (noteData: Omit<Note, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>) => 
      dbNotes.createNote(noteData),
    onSuccess: (newNote: Note | null) => {
      if (newNote) {
        // Invalidate the notes list for both workspace and parent
        queryClient.invalidateQueries({
          queryKey: notesKeys.list({ 
            workspaceId: newNote.workspace_id, 
            parentId: newNote.parent_id || undefined 
          }),
        });
      }
    },
  });
}

export function useUpdateNote() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ noteId, data }: { noteId: string; data: Partial<Omit<Note, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>> }) => 
      dbNotes.updateNote(noteId, data),
    onSuccess: (updatedNote: Note | null, { noteId }) => {
      if (updatedNote) {
        // Invalidate the notes list
        queryClient.invalidateQueries({
          queryKey: notesKeys.lists(),
        });
        
        // Update the note in the cache
        queryClient.setQueryData(
          notesKeys.detail(noteId),
          (oldData: { note: Note; blocks: Block[] } | null) => {
            if (!oldData) return { note: updatedNote, blocks: [] };
            return { ...oldData, note: updatedNote };
          }
        );
      }
    },
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (noteId: string) => dbNotes.deleteNote(noteId),
    onSuccess: (success: boolean, noteId: string) => {
      if (success) {
        // We need to get the workspace/parent info from the cache to invalidate the correct queries
        const queryCache = queryClient.getQueryCache();
        const noteQueries = queryCache.findAll({
          queryKey: notesKeys.detail(noteId),
        });
        
        if (noteQueries.length > 0 && noteQueries[0].state.data) {
          const noteData = noteQueries[0].state.data as { note: Note };
          if (noteData && noteData.note) {
            queryClient.invalidateQueries({
              queryKey: notesKeys.list({ 
                workspaceId: noteData.note.workspace_id,
                parentId: noteData.note.parent_id || undefined 
              }),
            });
          }
        }
        
        // Invalidate all notes lists to be safe
        queryClient.invalidateQueries({
          queryKey: notesKeys.lists(),
        });
        
        // Remove the note from the cache
        queryClient.removeQueries({
          queryKey: notesKeys.detail(noteId),
        });
      }
    },
  });
}