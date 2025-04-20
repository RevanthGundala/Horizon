// hooks/useChat.ts
import { useState, useEffect, useCallback, useRef } from 'react';
// Assuming ChatService handles communication with the main process for chat actions
// and potentially local DB interactions. Adjust the import path as needed.
import { chatService } from '../services/ChatService';
// Assuming ChatMessageRecord is the type returned by chatService.getMessages
// Adjust import path or define locally if needed.
import { ChatMessageRecord } from '../services/ChatService'; // Or './types' etc.

// Define the shape of the message object used specifically in the UI state
export interface UIMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    // Use Date objects in UI state for easier formatting/comparison if needed
    timestamp: Date;
    threadId: string;
    // Optional fields for displaying status or errors directly on the message
    syncStatus?: string;
    error?: string;
}

/**
 * Custom Hook to manage chat state, interactions, and IPC communication.
 * @param initialThreadId - The initial chat thread to load and interact with.
 */
export const useChat = (initialThreadId: string = 'default_thread') => {
    // State for the current chat thread ID
    const [currentThreadId, setCurrentThreadId] = useState<string>(initialThreadId);
    // State for the messages displayed in the UI
    const [messages, setMessages] = useState<UIMessage[]>([]);
    // State indicating if the assistant is currently generating a response
    const [isLoading, setIsLoading] = useState<boolean>(false);
    // State for storing general errors related to chat operations
    const [error, setError] = useState<string | null>(null);
    // Ref to track the ID of the assistant message currently being streamed in
    const streamingAssistantMessageId = useRef<string | null>(null);

    // --- Load initial messages for the current thread ---
    const loadMessages = useCallback(async () => {
        console.log(`useChat: Loading messages for thread ${currentThreadId}`);
        setIsLoading(true); // Indicate loading history (can be different from assistant loading)
        setError(null); // Clear previous errors
        try {
            // Fetch messages from the service (which likely uses IPC invoke)
            const loadedMessages: ChatMessageRecord[] = await chatService.getMessages(currentThreadId);
            // Map DB/service records to the UI message format
            setMessages(loadedMessages.map(m => {
                 const parsedTimestamp = new Date(m.timestamp);
                 // console.log(`useChat loadMessages: Msg ID ${m.id}, Raw TS: ${m.timestamp}, Parsed TS: ${parsedTimestamp}, Is Valid: ${!isNaN(parsedTimestamp.getTime())}`);
                 return {
                    ...m, // Spread properties like id, role, content, threadId, syncStatus, error
                    timestamp: !isNaN(parsedTimestamp.getTime()) ? parsedTimestamp : new Date() // Use parsed date or fallback to now if invalid
                 };
            }));
            console.log(`useChat: Loaded ${loadedMessages?.length || 0} messages for thread ${currentThreadId}.`);
        } catch (err: any) {
            console.error("useChat: Failed to load chat messages:", err);
            setError(`Failed to load chat history: ${err.message}`);
        } finally {
            setIsLoading(false); // Finish loading history
        }
    }, [currentThreadId]); // Reload messages if the thread ID changes

    // Effect to load messages when the hook mounts or the thread ID changes
    useEffect(() => {
        loadMessages();
    }, [loadMessages]); // Dependency array includes the memoized loadMessages function

    // --- Define IPC Event Handlers using useCallback for stable references ---

    // Handles the first chunk of a streaming assistant message
    const handleNewAssistantMessage = useCallback((data: { threadId: string; relatedUserMessageId: string; assistantMessageId: string; firstChunk: string }) => {
        try {
            console.log('>>> handleNewAssistantMessage RECEIVED:', JSON.stringify(data));
             console.log(`   Comparing data.threadId ('${data?.threadId}') vs currentThreadId ('${currentThreadId}')`);

            // Ignore events for other threads or without a message ID
            if (!data?.assistantMessageId || data?.threadId !== currentThreadId) {
                 console.warn(`   handleNewAssistantMessage: DISCARDING event. Data Thread: ${data?.threadId}, Current Thread: ${currentThreadId}`);
                 return;
            }

            setError(null); // Clear any previous general errors
            setIsLoading(true); // Start loading indicator
            streamingAssistantMessageId.current = data.assistantMessageId; // Track this message ID

            setMessages(prevMessages => {
                // Avoid adding the same message multiple times
                if (prevMessages.some(msg => msg.id === data.assistantMessageId)) {
                    console.warn(`   handleNewAssistantMessage: Message ${data.assistantMessageId} already exists.`);
                    return prevMessages;
                }
                const newTimestamp = new Date();
                console.log(`   handleNewAssistantMessage: Adding message ${data.assistantMessageId}`);
                const newMsg: UIMessage = {
                    id: data.assistantMessageId,
                    role: 'assistant',
                    content: data.firstChunk,
                    timestamp: newTimestamp,
                    threadId: data.threadId,
                    syncStatus: 'streaming'
                };
                console.log('   handleNewAssistantMessage: New state length:', prevMessages.length + 1);
                return [...prevMessages, newMsg];
            });
            console.log(`   handleNewAssistantMessage: FINISHED processing ${data.assistantMessageId}`);
        } catch (error) {
             console.error("!!! Error inside handleNewAssistantMessage !!!", error);
        }
    }, [currentThreadId]); // Dependency: only re-create if currentThreadId changes

    // Handles subsequent chunks for an ongoing stream
    const handleStreamChunk = useCallback((data: { threadId: string; assistantMessageId: string; chunk: string }) => {
         try {
            // console.log('>>> handleStreamChunk RECEIVED:', JSON.stringify(data)); // Usually too noisy
             console.log(`   Comparing data.threadId ('${data?.threadId}') vs currentThreadId ('${currentThreadId}')`);

             // Ignore events for other threads or without a message ID
             if (!data?.assistantMessageId || data?.threadId !== currentThreadId) {
                  console.warn(`   handleStreamChunk: DISCARDING event. Data Thread: ${data?.threadId}, Current Thread: ${currentThreadId}`);
                 return;
             }

            // Ensure loading state is true (should be set by handleNewAssistantMessage)
            // if (!isLoading) setIsLoading(true); // Might cause extra renders, rely on handleNew initiation

            setMessages(prevMessages => {
                const msgIndex = prevMessages.findIndex(msg => msg.id === data.assistantMessageId);
                if (msgIndex === -1) {
                     console.warn(`   handleStreamChunk setMessages: Cannot find message ${data.assistantMessageId} to append chunk.`);
                     return prevMessages; // Should not happen if handleNewAssistantMessage worked
                }
                // Append the new chunk immutably
                const updatedMessages = [...prevMessages];
                updatedMessages[msgIndex] = {
                    ...updatedMessages[msgIndex],
                    content: updatedMessages[msgIndex].content + data.chunk
                };
                 // console.log(`   handleStreamChunk setMessages: Appended chunk to ${data.assistantMessageId}`); // Can be noisy
                return updatedMessages;
            });
         } catch (error) {
              console.error("!!! Error inside handleStreamChunk !!!", error);
         }
    }, [currentThreadId]); // Dependency: only re-create if currentThreadId changes

    // Handles the end of a stream
    const handleStreamEnd = useCallback((data: { assistantMessageId: string | null, threadId?: string }) => {
        try {
            console.log('>>> useChat handleStreamEnd: Handler called.');
            console.log('useChat handleStreamEnd: Received data:', JSON.stringify(data));
            console.log('useChat handleStreamEnd: Current tracked ID:', streamingAssistantMessageId.current);

            // Filter by threadId if included in payload and different
            if (data?.threadId && data.threadId !== currentThreadId) {
                 console.warn(`handleStreamEnd: Ignoring end event for different thread ${data.threadId}`);
                 return;
            }

            let loadingShouldBeFalse = false;

            // Case 1: Stream ended normally for the message we were tracking
            if (streamingAssistantMessageId.current && streamingAssistantMessageId.current === data.assistantMessageId) {
                console.log('useChat handleStreamEnd: IDs MATCH! Setting isLoading = false.');
                loadingShouldBeFalse = true;
                // Mark the message as fully synced/complete in UI state
                setMessages(prev => prev.map(msg => msg.id === data.assistantMessageId ? { ...msg, syncStatus: 'synced' } : msg));

            // Case 2: Stream ended, but no assistant message ID was ever created (backend error / no data)
            } else if (data.assistantMessageId === null) {
                 console.log('useChat handleStreamEnd: Received null ID. Setting isLoading = false and setting error.');
                 loadingShouldBeFalse = true;
                 // Set a user-friendly error message as no response was generated
                 // Use callback form of setError to avoid overwriting a more specific error from handleStreamError
                 setError(prevError => prevError || "Sorry, I couldn't generate a response. There might have been an issue processing your request.");

            // Case 3: Mismatched IDs or other unexpected state. End loading as a fallback.
            } else {
                 console.warn('useChat handleStreamEnd: Mismatched IDs or unexpected state.', 'Received:', data.assistantMessageId, 'Tracked:', streamingAssistantMessageId.current);
                 console.log('useChat handleStreamEnd: Mismatched IDs fallback. Setting isLoading = false.');
                 loadingShouldBeFalse = true;
            }

             // Set loading false and clear tracked ID if needed
             if(loadingShouldBeFalse) {
                 setIsLoading(false);
                 streamingAssistantMessageId.current = null; // Clear tracker after stream ends/errors
             }
        } catch (error) {
             console.error("!!! Error inside handleStreamEnd !!!", error);
              setIsLoading(false); // Ensure loading stops even if handler logic fails
              streamingAssistantMessageId.current = null;
        }

    }, [currentThreadId]); // Dependency: only re-create if currentThreadId changes

    // Handles explicit errors sent from the main process
    const handleStreamError = useCallback((errorData: { relatedUserMessageId?: string; assistantMessageId?: string | null, error: string, threadId?: string }) => {
        try {
            console.error('>>> useChat handleStreamError: Handler called. Received errorData:', errorData);

            // Filter by threadId if included in payload
            if (errorData?.threadId && errorData.threadId !== currentThreadId) {
                  console.warn(`handleStreamError: Ignoring error event for different thread ${errorData.threadId}`);
                 return;
             }

             // Generate User-Friendly Error Message
             let displayError = `Sorry, an error occurred.`; // Generic default
             const receivedError = errorData.error || "Unknown error";
             if (receivedError.includes('ECONNREFUSED') || receivedError.includes('connect')) {
                 displayError = "Sorry, could not connect to an internal tool. Please try again later.";
             } else if (receivedError.includes('timeout')) {
                  displayError = "Sorry, the request timed out.";
             } else if (receivedError.length < 150) { // Show shorter errors
                  displayError = `Assistant error: ${receivedError}`;
             }
             setError(displayError);

             // Optionally mark specific message with error status
             const errorIdToMark = errorData.assistantMessageId || errorData.relatedUserMessageId;
             if (errorIdToMark) {
                 setMessages(prev => prev.map(msg => msg.id === errorIdToMark ? { ...msg, error: receivedError, syncStatus: 'error' } : msg));
             }

             // Ensure loading stops and tracker is cleared
             console.log('useChat handleStreamError: Setting isLoading = false.');
             setIsLoading(false);
             streamingAssistantMessageId.current = null; // Clear tracker on error

        } catch (error) {
            console.error("!!! Error inside handleStreamError !!!", error);
             setIsLoading(false); // Ensure loading stops even if handler logic fails
             streamingAssistantMessageId.current = null;
        }
    }, [currentThreadId]); // Dependency: only re-create if currentThreadId changes

    // --- Effect to set up and clean up IPC listeners ---
    useEffect(() => {
        // Ensure we are in Electron context
        if (!window.electron?.ipcRenderer?.on) {
            console.warn("useChat: window.electron.ipcRenderer.on not available, skipping IPC listeners.");
            return;
        }

        const effectInstanceId = Math.random().toString(36).substring(2, 7);
        console.log(`%c>>> LISTENER SETUP [${effectInstanceId}] (For Thread ID: ${currentThreadId})`, 'color: blue; font-weight: bold;');

        // Register IPC listeners; return values are void so we use removeListener for cleanup
        window.electron.ipcRenderer.on('chat:new-assistant-message', handleNewAssistantMessage);
        window.electron.ipcRenderer.on('chat:stream-chunk', handleStreamChunk);
        window.electron.ipcRenderer.on('chat:stream-end', handleStreamEnd);
        window.electron.ipcRenderer.on('chat:stream-error', handleStreamError);

        // Cleanup function: Remove listeners when effect re-runs or component unmounts
        return () => {
            console.log(`%c<<< LISTENER CLEANUP [${effectInstanceId}] (For Thread ID: ${currentThreadId})`, 'color: gray; text-decoration: line-through;');
            window.electron.ipcRenderer.removeListener('chat:new-assistant-message', handleNewAssistantMessage);
            window.electron.ipcRenderer.removeListener('chat:stream-chunk', handleStreamChunk);
            window.electron.ipcRenderer.removeListener('chat:stream-end', handleStreamEnd);
            window.electron.ipcRenderer.removeListener('chat:stream-error', handleStreamError);
        };
        // Dependencies: Re-run effect if threadId changes or if handler references change (they shouldn't with useCallback)
    }, [currentThreadId, handleNewAssistantMessage, handleStreamChunk, handleStreamEnd, handleStreamError]);

    // --- Function to send a user message ---
    const sendMessage = useCallback(async (content: string) => {
        const trimmedContent = content.trim();
        if (!trimmedContent || isLoading) { // Prevent sending empty or while already loading
             console.warn("sendMessage blocked: empty content or already loading.");
             return;
        }

        // Clear previous general errors
        setError(null);
        // Set loading state immediately
        setIsLoading(true);
        // Reset the streaming ID tracker for the new message
        streamingAssistantMessageId.current = null;

        // Optimistic UI update: Add user message immediately
        const tempId = `local-${Date.now()}`; // Temporary ID for optimistic UI
        const userMessage: UIMessage = {
            id: tempId,
            role: 'user',
            content: trimmedContent,
            timestamp: new Date(), // Use current time for optimistic display
            threadId: currentThreadId,
            syncStatus: 'sending' // Show as sending
        };
        setMessages(prev => [...prev, userMessage]);

        try {
            // Trigger the main process to handle sending/streaming
            const result = await chatService.sendMessage({
                threadId: currentThreadId,
                content: trimmedContent
            });

            // Check result from main process's initial handling
            if (result?.success && result.messageId) {
                console.log(`useChat sendMessage: User message ${result.messageId} sent to main process.`);
                // Update the optimistic message with the real ID and timestamp from DB
                setMessages(prev => prev.map(msg =>
                    msg.id === tempId
                        ? { ...msg, id: result.messageId!, timestamp: new Date(result.timestamp!), syncStatus: 'sent' } // Mark as sent
                        : msg
                ));
                // Keep isLoading=true; waiting for stream events (new-assistant-message, end, error)
            } else {
                // If main process returned failure immediately
                throw new Error(result?.error || 'Failed to initiate message send in main process');
            }
        } catch (err: any) {
            console.error('useChat sendMessage: Error sending message:', err);
            setError(`Failed to send message: ${err.message}`); // Set general error state
            setIsLoading(false); // Stop loading as the process failed
            // Mark optimistic message as failed in the UI
            setMessages(prev => prev.map(msg =>
                msg.id === tempId ? { ...msg, syncStatus: 'error', error: err.message } : msg
            ));
        }
    }, [currentThreadId, isLoading]); // Dependency includes isLoading to prevent concurrent sends

    // --- Return state and functions needed by the UI component ---
    return {
        currentThreadId,
        setCurrentThreadId, // Function to allow changing threads
        messages,           // The array of messages to display
        isLoading,          // Boolean indicating if assistant is responding
        error,              // String containing the latest error message or null
        sendMessage,        // Function for the UI to call to send a message
        loadMessages,       // Function to explicitly reload messages if needed
    };
};

// Reminder: Make sure ChatMessageRecord is defined or imported correctly,
// matching the structure returned by chatService.getMessages.
// Example:
/*
export interface ChatMessageRecord {
    id: string;
    threadId: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: string; // ISO String from DB
    userId?: string | null;
    syncStatus?: string;
    error?: string | null; // Renamed from errorMessage for consistency?
    relatedUserMessageId?: string | null;
}
*/