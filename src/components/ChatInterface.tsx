// src/components/ChatInterface.tsx (or appropriate path)

import React, { useRef, useEffect, useState } from 'react';
// *** Import the useChat hook and its UIMessage type ***
import { useChat, UIMessage } from '../hooks/useChat'; // Adjust path as needed
import '../styles/ChatInterface.css';

interface ChatInterfaceProps {
    isOpen: boolean;
    onClose: () => void;
    // Optional: Pass threadId if managed outside, otherwise use internal state
    initialThreadId?: string;
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({
    isOpen,
    onClose,
    initialThreadId = 'default_thread' // Default thread ID
}) => {
    // --- State managed by the hook ---
    // const [messages, setMessages] = useState<UIMessage[]>([]); // REMOVED
    // const [isLoading, setIsLoading] = useState(false); // REMOVED
    // const [error, setError] = useState<string | null>(null); // REMOVED
    const [currentThreadId, setCurrentThreadId] = useState<string>(initialThreadId); // Keep if changing threads within component

    // *** Instantiate the hook ***
    const {
        messages,      // Get messages from the hook
        isLoading,     // Get loading state from the hook
        error,         // Get error state from the hook
        sendMessage,   // Get the function to send messages from the hook
        // loadMessages, // Can get this from hook if needed for manual refresh
        // setCurrentThreadId: setHookThreadId // Use if hook manages threadId
    } = useChat(currentThreadId); // Pass the current thread ID to the hook

    // --- Local UI state (Input field content) ---
    const [input, setInput] = useState('');

    // --- Refs (Keep as is) ---
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    // const streamingAssistantMessageId = useRef<string | null>(null); // REMOVED (Managed inside hook)

    // --- Helper Functions (Keep as is) ---
    const formatTime = (dateInput?: Date | string): string => {
        if (!dateInput) return '';
        const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
        try {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch { return ''; }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        // Auto-resize logic (keep if desired)
        e.target.style.height = 'auto';
        e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
    };

    // --- Effects ---

    // Auto-scroll (Keep as is - uses 'messages' from hook now)
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Focus input when chat opens (Keep as is)
    useEffect(() => {
        if (isOpen && inputRef.current) {
             setTimeout(() => { inputRef.current?.focus(); }, 300);
        }
     }, [isOpen]);

    // --- REMOVED: loadMessages function and useEffect ---
    // --- REMOVED: useEffect for setting up IPC listeners (handleChunk, handleEnd, etc.) ---
    // The useChat hook now handles loading data and listening for IPC events.


    // --- Handle form submission ---
    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const messageContent = input.trim();
        // Use isLoading from hook to prevent multiple sends
        if (!messageContent || isLoading) return;

        setInput(''); // Clear input immediately
         // Reset textarea height
        if (inputRef.current) inputRef.current.style.height = 'auto';

        // Call the sendMessage function from the hook
        // It handles optimistic updates, IPC calls, and state changes internally
        await sendMessage(messageContent);
    };

    // --- Render JSX ---
    // Use state variables (messages, isLoading, error) provided by the hook
    return (
        <div className={`chat-interface ${isOpen ? 'open' : ''}`}>
           <div className="chat-header">
               {/* TODO: Potentially display currentThreadId or allow switching */}
               <h3>Chat</h3>
               <button className="close-button" onClick={onClose}>×</button>
            </div>
            <div className="chat-messages">
                {/* Welcome Message */}
                {!messages.length && !isLoading && (
                    <div className="message assistant-message">
                        <div className="message-content">Hello! How can I help you today?</div>
                        <div className="message-timestamp">{formatTime(new Date())}</div>
                    </div>
                )}

                {/* Render Messages from Hook State */}
                {messages.map((message) => (
                    <div
                        key={message.id} // Use message ID as key
                        className={`message ${message.role === 'user' ? 'user-message' : 'assistant-message'}`}
                    >
                        <div className="message-content">{message.content}</div>
                        <div className="message-timestamp">{formatTime(message.timestamp)}</div>
                        {/* Optional: Display sync status/error for messages */}
                        {message.role === 'user' && message.syncStatus === 'error' && (
                             <div className="message-error" title={message.error}>⚠️ Sending failed</div>
                         )}
                         {message.role === 'assistant' && message.error && (
                             <div className="message-error" title={message.error}>⚠️ Error</div>
                         )}
                    </div>
                ))}

                {/* Typing Indicator based on hook's isLoading state */}
                {/* Improved logic: Show only if loading AND last message wasn't assistant OR no messages yet */}
                 {isLoading && (messages.length === 0 || messages[messages.length - 1]?.role === 'user') && (
                    <div className="message assistant-message loading">
                        <div className="typing-indicator"><span></span><span></span><span></span></div>
                    </div>
                 )}

                {/* General Error Display from hook state */}
                {error && (
                    <div className="message error-message">
                       <div className="message-content">
                           {error.includes('CORS') || error.includes('Failed to fetch') || error.includes('Network Error')
                               ? "Unable to connect to the chat server. Please check your network connection."
                               : error.includes('Assistant error') // Show specific assistant errors
                                   ? error
                                   : `Error: ${error}` // General error
                           }
                       </div>
                       <div className="message-timestamp">{formatTime(new Date())}</div>
                   </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input Form */}
            <form onSubmit={handleSubmit} className="chat-input-container">
                 <textarea
                    ref={inputRef}
                    value={input}
                    onChange={handleInputChange}
                    placeholder="Type a message..."
                    className="chat-input"
                    rows={1}
                    disabled={isLoading} // Disable input while loading
                    onKeyDown={(e) => { // Keep Enter to submit logic
                       if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
                           e.preventDefault();
                           const form = e.currentTarget.form;
                           if (form && input.trim()) form.requestSubmit();
                       }
                    }}
                 />
                 <button
                    type="submit"
                    className={`send-button ${input.trim() ? 'active' : ''}`}
                    disabled={!input.trim() || isLoading} // Disable button while loading
                 >
                     {isLoading ? (
                         <div className="send-loading-spinner"></div>
                     ) : (
                         // Send Icon SVG
                         <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                     )}
                 </button>
            </form>
        </div>
    );
};

export default ChatInterface;