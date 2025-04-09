import { useState, useEffect } from 'react';
import './App.css';
import "@blocknote/core/fonts/inter.css";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import SearchBar from './components/SearchBar';
import ChatInterface from './components/ChatInterface';
import CardGrid, { Card } from './components/CardGrid';
import { useNavigate } from '@tanstack/react-router';
import SyncStatus from './components/SyncStatus';
import './styles/SyncStatus.css';
import { setupNetworkDetection } from './utils/db';
import { usePages, useCreatePage } from './hooks/usePages';
import { useAuth } from './contexts/auth-context';

function App() {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [cards, setCards] = useState<Card[]>([]);
  
  const navigate = useNavigate();
  const { userId } = useAuth();
  
  // Fetch pages to display as cards
  const { data: pages, isLoading: isPagesLoading } = usePages();
  const createPageMutation = useCreatePage();
  
  // Initialize network detection
  useEffect(() => {
    setupNetworkDetection();
  }, []);
  
  // Update cards when pages are loaded
  useEffect(() => {
    if (pages && !isPagesLoading) {
      const newCards = pages.map(page => ({
        id: page.id,
        title: page.title,
        description: page.type || 'Page',
        lastEdited: new Date(page.updated_at).toLocaleString(),
      }));
      setCards(newCards);
    }
  }, [pages, isPagesLoading]);

  // Toggle chat interface
  const toggleChat = () => {
    setIsChatOpen(!isChatOpen);
  };

  // Handle creating a new card
  const handleCreateCard = async () => {
    try {
      // Generate a unique ID for the new page
      const newId = crypto.randomUUID();
      
      // Make sure we have a valid user ID
      if (!userId) {
        console.error('Cannot create page: No user ID available');
        return;
      }
      
      console.log('Creating page with user ID:', userId);
      
      // Create the page in the database
      const newPage = await createPageMutation.mutateAsync({
        id: newId,
        title: 'Untitled Page',
        parent_id: null,
        user_id: userId,
        is_favorite: 0,
        type: 'note'
        // Removed client_updated_at field to match backend schema
      });
      
      if (newPage) {
        // Navigate to the new page
        navigate({ to: '/page/$pageId', params: { pageId: newId } });
      } else {
        console.error('Failed to create new page');
      }
    } catch (error) {
      console.error('Error creating new page:', error);
    }
  };

  return (
      <div className="app-page">
        <div className="app-content">
          <header className="App-header">
            <h2>Welcome to Horizon</h2>
            <p>Your canvas for ideas and knowledge</p>
            <SyncStatus />
          </header>
          
          <main className="home-container">
            {isPagesLoading ? (
              <div className="loading-indicator">Loading pages...</div>
            ) : (
              <CardGrid cards={cards} onCreateCard={handleCreateCard} />
            )}
            
          </main>
          
          <footer className="App-footer">
           
          </footer>
        </div>

        {/* Add the SearchBar component */}
        {/* <SearchBar 
          onSubmit={handleSearchSubmit} 
          onFocusChange={handleSearchFocusChange}
          onCancel={handleSearchCancel}
          isLoading={isSearchLoading}
        /> */}

        {/* Chat toggle button */}
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
