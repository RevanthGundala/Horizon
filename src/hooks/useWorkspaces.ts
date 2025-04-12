import { useQuery, useMutation, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import { Workspace, Note, Block } from '../utils/types/index';
import { dbWorkspaces, dbNotes } from '../utils/services/db';
import { auth } from '../utils/services/auth';
import { v4 as uuidv4 } from 'uuid';

// Note query keys
export const notesKeys = {
  all: ['notes'] as const,
  lists: () => [...notesKeys.all, 'list'] as const,
  list: (filters: {}) => [...notesKeys.lists(), filters] as const,
  details: () => [...notesKeys.all, 'detail'] as const,
  detail: (id: string) => [...notesKeys.details(), id] as const,
  workspace: (workspaceId: string) => [...notesKeys.all, 'workspace', workspaceId] as const,
};


// Query keys
export const workspacesKeys = {
  all: ['workspaces'] as const,
  lists: () => [...workspacesKeys.all, 'list'] as const,
  list: (filters: {}) => [...workspacesKeys.lists(), filters] as const,
  details: () => [...workspacesKeys.all, 'detail'] as const,
  detail: (id: string) => [...workspacesKeys.details(), id] as const,
};

// Hooks
export function useWorkspaces(options?: UseQueryOptions<Workspace[]>) {
  return useQuery<Workspace[]>({
    queryKey: workspacesKeys.list({}),
    queryFn: async () => {
      const workspaces = await dbWorkspaces.getWorkspaces();
      return workspaces || [];
    },
    ...options
  });
}

export function useWorkspace(id: string, options?: UseQueryOptions<Workspace | null>) {
  return useQuery<Workspace | null>({
    queryKey: workspacesKeys.detail(id),
    queryFn: () => dbWorkspaces.getWorkspace(id),
    enabled: !!id,
    ...options
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (name: string) => {
      // Get user ID from auth service
      const userId = await auth.getUserId();
      if (!userId) {
        throw new Error('No user ID available. Please login again.');
      }
      
      // Create a new workspace
      const workspaceData: Omit<Workspace, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'> = {
        id: uuidv4(),
        name,
        user_id: userId,
        is_favorite: 0 // SQLite stores booleans as integers
      };
      
      return await dbWorkspaces.createWorkspace(workspaceData);
    },
    onSuccess: (newWorkspace) => {
      if (newWorkspace) {
        // Invalidate workspaces queries
        queryClient.invalidateQueries({ 
          queryKey: workspacesKeys.all
        });
      }
    }
  });
}

export function useUpdateWorkspace() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ workspaceId, data }: { 
      workspaceId: string; 
      data: Partial<Omit<Workspace, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>> 
    }) => 
      dbWorkspaces.updateWorkspace(workspaceId, data),
    onSuccess: (updatedWorkspace) => {
      if (updatedWorkspace) {
        // Invalidate workspace queries
        queryClient.invalidateQueries({ 
          queryKey: workspacesKeys.all
        });
      }
    },
  });
}

export function useDeleteWorkspace() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (workspaceId: string) => dbWorkspaces.deleteWorkspace(workspaceId),
    onSuccess: (success, workspaceId) => {
      if (success) {
        // Invalidate workspaces list query
        queryClient.invalidateQueries({
          queryKey: workspacesKeys.lists(),
        });
        
        // Remove the workspace from the cache
        queryClient.removeQueries({
          queryKey: workspacesKeys.detail(workspaceId),
        });
      }
    },
  });
}

// Get notes that belong to a specific workspace
export function useWorkspaceNotes(workspaceId: string, options?: UseQueryOptions<Note[]>) {
  return useQuery<Note[]>({
    queryKey: notesKeys.workspace(workspaceId),
    queryFn: async () => {
      // Make sure we have a valid workspaceId
      if (!workspaceId) return [];
      // Get top-level notes in the workspace
      return await dbNotes.getNotes(workspaceId, undefined);
    },
    enabled: !!workspaceId,
    ...options
  });
}

export function useNote(noteId: string, options?: UseQueryOptions<{ note: Note; blocks: Block[] } | null>) {
  return useQuery<{ note: Note; blocks: Block[] } | null>({
    queryKey: notesKeys.detail(noteId),
    queryFn: () => dbNotes.getNote(noteId),
    enabled: !!noteId,
    ...options
  });
}

export function useCreateNote() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      title, 
      workspaceId, 
      parentId = null 
    }: { 
      title: string; 
      workspaceId: string; 
      parentId?: string | null 
    }) => {
      // Get user ID from auth service
      const userId = await auth.getUserId();
      if (!userId) {
        throw new Error('No user ID available. Please login again.');
      }
      
      // Create a new note
      const noteData: Omit<Note, 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'> = {
        id: uuidv4(),
        title,
        workspace_id: workspaceId,
        parent_id: parentId,
        user_id: userId,
        is_favorite: 0, // SQLite stores booleans as integers
        content: ''
      };
      
      return await dbNotes.createNote(noteData);
    },
    onSuccess: (newNote) => {
      if (newNote) {
        // Invalidate notes queries for this workspace
        queryClient.invalidateQueries({ 
          queryKey: notesKeys.workspace(newNote.workspace_id)
        });
        
        // If this is a child note, also invalidate the parent
        if (newNote.parent_id) {
          queryClient.invalidateQueries({
            queryKey: notesKeys.detail(newNote.parent_id)
          });
        }
      }
    }
  });
}

export function useUpdateNote() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ 
      noteId, 
      data 
    }: { 
      noteId: string;
      data: Partial<Omit<Note, 'id' | 'created_at' | 'updated_at' | 'sync_status' | 'server_updated_at'>>
    }) => dbNotes.updateNote(noteId, data),
    onSuccess: (updatedNote) => {
      if (updatedNote) {
        // Invalidate the specific note
        queryClient.invalidateQueries({
          queryKey: notesKeys.detail(updatedNote.id)
        });
        
        // Invalidate workspace notes
        queryClient.invalidateQueries({
          queryKey: notesKeys.workspace(updatedNote.workspace_id)
        });
      }
    }
  });
}

export function useDeleteNote() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (noteId: string) => {
      // First get the note to know which workspace it belongs to
      const noteData = await dbNotes.getNote(noteId);
      if (!noteData) {
        throw new Error('Note not found');
      }
      
      // Delete the note
      return { 
        success: await dbNotes.deleteNote(noteId),
        workspaceId: noteData.note.workspace_id,
        parentId: noteData.note.parent_id
      };
    },
    onSuccess: (result) => {
      if (result.success) {
        // Invalidate workspace notes
        queryClient.invalidateQueries({
          queryKey: notesKeys.workspace(result.workspaceId)
        });
        
        // If this was a child note, also invalidate the parent
        if (result.parentId) {
          queryClient.invalidateQueries({
            queryKey: notesKeys.detail(result.parentId)
          });
        }
      }
    }
  });
}

// For backward compatibility with the legacy useWorkspaces hook
export function useWorkspacesBackcompat(options?: UseQueryOptions<Note[]>) {
  return useQuery<Note[]>({
    queryKey: ['workspaces-legacy'],
    queryFn: async () => {
      // Get all top-level notes (these were our workspaces in the old system)
      const notes = await dbNotes.getNotes();
      return notes?.filter(note => note.parent_id === null) || [];
    },
    ...options
  });
}