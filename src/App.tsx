import { useState, useEffect } from 'react';
import './App.css';
import "@blocknote/core/fonts/inter.css";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import ChatInterface from './components/ChatInterface';
import CardGrid, { Card } from './components/CardGrid';
import { useNavigate } from '@tanstack/react-router';
import './styles/SyncStatus.css';
import { setupNetworkDetection } from './services/DataService';
import { useAuth } from './contexts/auth-context';
import { useWorkspaces, useCreateWorkspace, useWorkspaceNotes, useCreateNote } from './hooks/useWorkspaces';
import { useQueryClient } from '@tanstack/react-query';
import { Note } from '../types/index';
import Onboarding from './components/Onboarding';

function App() {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  
  const navigate = useNavigate();
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  
  // Fetch workspaces
  const { data: workspaces, isLoading: isWorkspacesLoading } = useWorkspaces();
  
  // Fetch notes for the active workspace
  const { data: workspaceNotes, isLoading: isNotesLoading } = useWorkspaceNotes(
    activeWorkspaceId || '',
    {
      queryKey: ['workspace-notes', activeWorkspaceId],
      enabled: !!activeWorkspaceId
    }
  );
  
  // Create mutation for notes
  const { mutateAsync: createNote } = useCreateNote();
  
  // Initialize network detection
  useEffect(() => {
    setupNetworkDetection();
  }, []);
  
  // Check if we need to show onboarding (no workspaces yet)
  useEffect(() => {
    if (!isWorkspacesLoading && workspaces && userId) {
      console.log('Workspace check - found workspaces:', workspaces.length, workspaces.map(w => w.name).join(', '));
      setShowOnboarding(workspaces.length === 0);
    }
  }, [workspaces, isWorkspacesLoading, userId]);
  
  // Set active workspace when workspaces are loaded
  useEffect(() => {
    if (!isWorkspacesLoading && workspaces && workspaces.length > 0) {
      // Set the first workspace as active
      setActiveWorkspaceId(workspaces[0].id);
    }
  }, [workspaces, isWorkspacesLoading]);

  // Update cards when notes are loaded for the active workspace
  useEffect(() => {
    if (workspaceNotes && !isNotesLoading && activeWorkspaceId) {
      // Convert notes to cards
      const noteCards = workspaceNotes.map(note => ({
        id: note.id,
        title: note.title,
        description: 'Note',
        lastEdited: new Date(note.updated_at).toLocaleString(),
      }));
      
      setCards(noteCards);
    }
  }, [workspaceNotes, isNotesLoading, activeWorkspaceId]);

  // Toggle chat interface
  const toggleChat = () => {
    setIsChatOpen(!isChatOpen);
  };
  
  // Handle creating a new card
  const handleCreateCard = async () => {
    try {
      // Make sure we have an active workspace
      if (!activeWorkspaceId) {
        console.error('Cannot create note: No active workspace');
        return;
      }
      
      // Create the note in the database
      const newNote = await createNote({
        title: 'Untitled Note',
        workspaceId: activeWorkspaceId,
        parentId: null // Top-level note in workspace
      });
      
      if (newNote) {
        // Navigate to the new note (using the note ID as page ID for now)
        navigate({ to: '/note/$noteId', params: { noteId: newNote.id } });
      } else {
        console.error('Failed to create new note');
      }
    } catch (error) {
      console.error('Error creating new note:', error);
    }
  };

  // If onboarding is needed, show that instead of the main app
  if (showOnboarding) {
    return <Onboarding onComplete={() => setShowOnboarding(false)} />;
  }

  return (
      <div className="app-note">
        <div className="app-content">
          <header className="App-header">
            <h2>Welcome to Horizon</h2>
            <p>
              {workspaces && workspaces.length > 0 
                ? `Workspace: ${workspaces[0].name}` 
                : 'Your canvas for ideas and knowledge'}
            </p>
          </header>
          
          <main className="home-container">
            {isNotesLoading ? (
              <div className="loading-indicator">Loading notes...</div>
            ) : (
              <CardGrid cards={cards} onCreateCard={handleCreateCard} />
            )}
            
          </main>
          
          <footer className="App-footer">
           
          </footer>
        </div>

        <button 
          className={`chat-toggle-button ${isChatOpen ? 'open' : ''}`}
          onClick={toggleChat}
          aria-label={isChatOpen ? 'Close chat' : 'Open chat'}
        >
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path 
              d={isChatOpen 
                ? "M18 6L6 18M6 6l12 12" 
                : "M8 10h8M8 14h8M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"
              } 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* Chat interface */}
        <ChatInterface 
          isOpen={isChatOpen}
          onClose={() => setIsChatOpen(false)}
        />
      </div>
  );
}

export default App;
