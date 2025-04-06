import { useState } from 'react';
import './App.css';
import "@blocknote/core/fonts/inter.css";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import SearchBar from './components/SearchBar';
import ChatInterface from './components/ChatInterface';
import { chatService } from './services/ChatService';

function App() {
  const [searchResult, setSearchResult] = useState<string | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Handle search submission
  const handleSearchSubmit = async (query: string) => {
    try {
      setIsSearchLoading(true);
      const response = await chatService.sendQuery(query);
      if (response.choices && response.choices.length > 0) {
        setSearchResult(response.choices[0].message.content);
      }
    } catch (error) {
      console.error('Search error:', error);
      setSearchResult('An error occurred while processing your search.');
    } finally {
      setIsSearchLoading(false);
    }
  };

  // Handle search cancellation
  const handleSearchCancel = () => {
    setIsSearchLoading(false);
    // In a real application, you would also abort the fetch request
  };

  // Handle search focus change
  const handleSearchFocusChange = (focused: boolean) => {
    setIsSearchFocused(focused);
  };

  // Toggle chat interface
  const toggleChat = () => {
    setIsChatOpen(!isChatOpen);
  };

  // Handle sending a chat message
  const handleSendChatMessage = async (message: string): Promise<string> => {
    try {
      const response = await chatService.sendQuery(message);
      if (response.choices && response.choices.length > 0) {
        return response.choices[0].message.content;
      }
      return "I'm sorry, I couldn't process your request.";
    } catch (error) {
      console.error('Chat error:', error);
      return "An error occurred while processing your message.";
    }
  };


  return (
      <div className="App">
        <div className={`app-content ${isSearchFocused ? 'dimmed' : ''}`}>
          <header className="App-header">
            <h1>Horizon</h1>
            <p>An Electron.js application with Vite, React, and TypeScript</p>
          </header>
          
          <main className="editor-container">
            {/* Editor component */}
            {/* Display search results if available */}
            {searchResult && (
              <div className="search-results">
                <h3>Search Results</h3>
                <p>{searchResult}</p>
              </div>
            )}
          </main>
          
          <footer className="App-footer">
           
          </footer>
        </div>

        {/* Add the SearchBar component */}
        <SearchBar 
          onSubmit={handleSearchSubmit} 
          onFocusChange={handleSearchFocusChange}
          onCancel={handleSearchCancel}
          isLoading={isSearchLoading}
        />

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
          onSendMessage={handleSendChatMessage}
        />
      </div>
  );
}

export default App;
