import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { BlockNoteView, lightDefaultTheme, darkDefaultTheme } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { Block as BlockNoteBlock } from "@blocknote/core";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useQueryClient } from '@tanstack/react-query';
import { Note, Block } from '../../types';
import { useTheme } from '../contexts/theme-context';
import { dbBlocks } from '../services/DataService';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../contexts/auth-context';
import '../styles/Note.css';
import { notesKeys, useNote } from '../hooks/useWorkspaces';

interface NoteProps {
  noteId?: string;
}

const NoteComponent: React.FC<NoteProps> = ({ noteId: propNoteId }) => {
  const { noteId } = useParams({ from: '/note/$noteId' });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const { isDarkMode } = useTheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { userId } = useAuth();
  

  // Create editor instance with a reference to track changes
  const [editorContentChanged, setEditorContentChanged] = useState(false);
  
  // Create editor instance with a default paragraph
  const editor = useCreateBlockNote({
    initialContent: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "", styles: {} }],
        props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }
      }
    ],
    // Use the proper way to watch for changes
    domAttributes: {
      editor: {
        class: "editor-container",
        "data-editor-instance": noteId || "default"
      }
    }
  });
  
  // Set up debounced save on content change
  useEffect(() => {
    if (editor && editorContentChanged) {
      const timeoutId = setTimeout(() => {
        saveBlocks(editor.topLevelBlocks);
        setEditorContentChanged(false);
      }, 500); // 500ms debounce
      
      return () => clearTimeout(timeoutId);
    }
  }, [editor, editorContentChanged]);
  
  // Watch for editor changes
  useEffect(() => {
    if (editor) {
      // This callback will run whenever the editor changes
      const unsubscribe = editor.onEditorContentChange(() => {
        setEditorContentChanged(true);
      });
      
      // Return cleanup function
      return unsubscribe;
    }
  }, [editor]);

  // Use the note hook
  const { data: noteData, isLoading: isNoteLoading, error: noteError } = useNote(
    noteId || ''
  );

  // Set note and blocks when data is loaded
  useEffect(() => {
    if (noteData) {
      setNote(noteData.note);
      setBlocks(noteData.blocks);

      // If there are no blocks, create a default block
      if (noteData.blocks.length === 0 && userId) {
        const createDefaultBlock = async () => {
          const defaultBlock = {
            id: uuidv4(),
            note_id: noteId || '',
            user_id: userId,
            type: 'paragraph',
            content: '',
            metadata: null,
            order_index: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            server_updated_at: null,
            sync_status: 'pending' as const
          };
          
          await dbBlocks.createBlock(defaultBlock);
          setBlocks([defaultBlock]);
        };
        
        createDefaultBlock();
      }
    }
  }, [noteData, noteId, userId]);

  // Handle loading and error states
  useEffect(() => {
    if (!noteId) {
      setError('No note ID provided');
      setIsLoading(false);
      return;
    }

    setIsLoading(isNoteLoading);
    
    if (noteError) {
      console.error('Error loading note:', noteError);
      setError('Failed to load note. Please try again.');
    }
  }, [noteId, isNoteLoading, noteError]);

  // Convert local blocks to BlockNote format
  useEffect(() => {
    if (!editor) return;
    
    if (blocks.length > 0) {
      // Sort blocks by order_index
      const sortedBlocks = [...blocks].sort((a, b) => a.order_index - b.order_index);
      
      // Convert to BlockNote format
      const blockNoteBlocks = sortedBlocks.map(block => {
        // Parse content from string to object if needed
        let content: any = block.content;
        if (typeof block.content === 'string') {
          try {
            content = block.content ? JSON.parse(block.content) : {};
          } catch (e) {
            content = { text: block.content };
          }
        }
        
        // Create BlockNote block
        return {
          id: block.id,
          type: block.type,
          props: { 
            textColor: "default", 
            backgroundColor: "default",
            textAlignment: "left",
            ...content 
          },
          content: content?.text ? [{ type: "text", text: content.text, styles: {} }] : [{ type: "text", text: "", styles: {} }]
        } as BlockNoteBlock;
      });
      
      // Set editor content
      editor.replaceBlocks(editor.topLevelBlocks, blockNoteBlocks);
    } else {
      // If there are no blocks, make sure we still have a default block
      const defaultBlock = {
        type: "paragraph",
        content: [{ type: "text", text: "", styles: {} }],
        props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }
      } as BlockNoteBlock;
      
      // Only replace if the editor is empty
      if (editor.topLevelBlocks.length === 0) {
        editor.replaceBlocks([], [defaultBlock]);
      }
    }
  }, [blocks, editor]);

  // Save blocks to database
  const saveBlocks = async (blockNoteBlocks: BlockNoteBlock[]) => {
    if (!noteId || !userId) return;
    
    try {
      // Convert BlockNote blocks to our Block format
      const updatedBlocks = blockNoteBlocks.map((bnBlock, index) => {
        // Find existing block or create new one
        const existingBlock = blocks.find(b => b.id === bnBlock.id);
        
        // Handle content safely - we'll extract text content from the block
        // This is a simplified approach - in a real app, you'd need to handle different types of content
        let textContent = '';
        try {
          // Convert the complex content structure to a simple string representation
          textContent = JSON.stringify(bnBlock.content);
        } catch (e) {
          console.error('Error serializing block content:', e);
        }
        
        // Convert content to string for storage
        const content = JSON.stringify({
          ...bnBlock.props,
          text: textContent
        });
        
        return {
          id: bnBlock.id,
          note_id: noteId,
          user_id: userId,
          type: bnBlock.type,
          content,
          metadata: null,
          order_index: index,
          created_at: existingBlock?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
          server_updated_at: existingBlock?.server_updated_at || null,
          sync_status: 'pending' as const
        };
      });
      
      // Update blocks in database
      await dbBlocks.updateBlocksBatch(updatedBlocks);
      
      // Update local state with properly typed blocks
      setBlocks(updatedBlocks as Block[]);
      
      // Invalidate queries
      queryClient.invalidateQueries({ queryKey: notesKeys.detail(noteId) });
    } catch (err) {
      console.error('Error saving blocks:', err);
    }
  };

  // Handle back button
  const handleBack = () => {
    navigate({ to: '/' });
  };

  if (isLoading) {
    return (
      <div className="note-container">
        <div className="note-loading">Loading note...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="note-container">
        <div className="note-error">
          <p>{error}</p>
          <button onClick={handleBack}>Back to Home</button>
        </div>
      </div>
    );
  }

  return (
    <div className="note-container">
      <div className="note-header">
        <button onClick={handleBack} className="back-button">
          ← Back
        </button>
        <h1 className="note-title">{note?.title || 'Untitled Note'}</h1>
      </div>
      
      <div className="note-editor">
        <BlockNoteView
          editor={editor}
          theme={isDarkMode ? darkDefaultTheme : lightDefaultTheme}
        />
      </div>
    </div>
  );
};

export default NoteComponent;