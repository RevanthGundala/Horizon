import React, { useRef, useEffect, useState } from 'react';
import '../styles/ChatInterface.css';

interface ChatInterfaceProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
  isOpen, 
  onClose
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to the bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Focus input when chat opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 300);
    }
  }, [isOpen]);

  // Format timestamp
  const formatTime = (date: Date = new Date()) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    
    // Create a new user message
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date()
    };
    
    // Add user message to the chat
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    setError(null);
    
    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
    
    try {
      // Format messages for the API
      const messageHistory = [
        ...messages.map(msg => ({ role: msg.role, content: msg.content })),
        { role: userMessage.role, content: userMessage.content }
      ];
      
      // Check if electron is available
      if (!window.electron) {
        throw new Error('Electron IPC is not available');
      }
      
      // Send message via IPC
      const response = await window.electron.ipcRenderer.invoke('chat:send-message', messageHistory);
      
      // Add assistant response to the chat
      setMessages(prev => [
        ...prev, 
        {
          id: Date.now().toString(),
          role: 'assistant',
          content: response.content,
          timestamp: new Date()
        }
      ]);
    } catch (err) {
      console.error('Chat error:', err);
      setError(err instanceof Error ? err.message : 'An error occurred while sending your message');
    } finally {
      setIsLoading(false);
    }
  };

  // Determine if there's a CORS error
  const isCorsError = error?.includes('CORS') || error?.includes('Failed to fetch');

  return (
    <div className={`chat-interface ${isOpen ? 'open' : ''}`}>
      <div className="chat-header">
        <h3>Chat</h3>
        <button className="close-button" onClick={onClose}>×</button>
      </div>
      
      <div className="chat-messages">
        {!messages.length && (
          <div className="message assistant-message">
            <div className="message-content">Hello! How can I help you today?</div>
            <div className="message-timestamp">{formatTime()}</div>
          </div>
        )}
        
        {messages.map((message) => (
          <div 
            key={message.id} 
            className={`message ${message.role === 'user' ? 'user-message' : 'assistant-message'}`}
          >
            <div className="message-content">{message.content}</div>
            <div className="message-timestamp">{formatTime(message.timestamp)}</div>
          </div>
        ))}
        
        {isLoading && (
          <div className="message assistant-message loading">
            <div className="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        )}
        
        {error && (
          <div className="message error-message">
            <div className="message-content">
              {isCorsError ? 
                "Unable to connect to the chat server. This may be due to network issues." :
                `Error: ${error}`}
            </div>
            <div className="message-timestamp">{formatTime()}</div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>
      
      <form onSubmit={handleSubmit} className="chat-input-container">
        <textarea
          ref={inputRef}
          value={input}
          onChange={handleInputChange}
          placeholder="Type a message..."
          className="chat-input"
          rows={1}
          disabled={isLoading}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              const form = e.currentTarget.form;
              if (form && input.trim()) form.requestSubmit();
            }
          }}
        />
        <button 
          type="submit"
          className={`send-button ${input.trim() ? 'active' : ''}`}
          disabled={!input.trim() || isLoading}
        >
          {isLoading ? (
            <div className="send-loading-spinner"></div>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
      </form>
    </div>
  );
};

export default ChatInterface;
