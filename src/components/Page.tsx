import { useParams, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useCreateBlockNote, useBlockNoteEditor } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../styles/Page.css';
import { usePage, useUpdatePage } from '../hooks/usePages';
import { useBlocks } from '../hooks/useBlocks';
import { Block, dbBlocks } from '../utils/db';
import { v4 as uuidv4 } from 'uuid';
import { debounce } from 'lodash';

interface PageProps {
  // Add props as needed
}

const Page: React.FC<PageProps> = () => {
  const { pageId } = useParams({ from: '/page/$pageId' });
  const navigate = useNavigate();
  const [title, setTitle] = useState('Untitled');
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [icon, setIcon] = useState<string>('📄');
  const [editorReady, setEditorReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  
  // Use refs to avoid re-renders
  const editorContentRef = useRef<any>(null);
  const editorBlockIdRef = useRef<string | null>(null);
  const lastSavedContentRef = useRef<string | null>(null);
  const isContentChangedRef = useRef<boolean>(false);
  const isSavingRef = useRef<boolean>(false);
  const saveTimeoutRef = useRef<any>(null);
  
  // Use our custom hooks
  const { data: pageData, isLoading: isPageLoading, error: pageError } = usePage(pageId);
  const { data: blocks, isLoading: isBlocksLoading, refetch: refetchBlocks } = useBlocks(pageId);
  const updatePageMutation = useUpdatePage();
  
  // Initialize the editor with Notion-like configuration
  const editor = useCreateBlockNote({
    initialContent: [
      {
        type: "paragraph",
        content: "Start writing here..."
      }
    ]
  });

  // Direct save function that doesn't use the store
  const saveEditorContent = useCallback(async (force = false) => {
    if (!editor || !editorReady || !pageId) {
      console.log('🔷 [FRONTEND] Cannot save: editor not ready or no pageId');
      return;
    }
    
    // Prevent multiple simultaneous saves
    if (isSavingRef.current && !force) {
      console.log('🔷 [FRONTEND] Already saving, skipping this save');
      return;
    }
    
    try {
      // Get the current editor content
      const editorContent = await editor.document;
      const contentString = JSON.stringify(editorContent);
      
      console.log(`🔷 [FRONTEND] Editor content size: ${contentString.length} characters`);
      
      // Skip saving if content hasn't changed and this isn't a forced save
      if (!force && contentString === lastSavedContentRef.current) {
        console.log('🔷 [FRONTEND] Content unchanged, skipping save');
        return;
      }
      
      // Set saving state
      isSavingRef.current = true;
      setSaveStatus('saving');
      editorContentRef.current = editorContent;
      
      console.log(`🔷 [FRONTEND] Saving content for page ${pageId}`);
      
      // Find existing editor block for this page
      const editorBlock = blocks?.find(block => 
        block.type === 'editor' && block.page_id === pageId
      );
      
      console.log('🔷 [FRONTEND] Found editor block:', editorBlock?.id);
      console.log('🔷 [FRONTEND] Available blocks:', blocks?.map(b => ({ id: b.id, type: b.type })));
      
      if (editorBlock) {
        // Update existing block
        editorBlockIdRef.current = editorBlock.id;
        console.log('🔷 [FRONTEND] Updating existing block:', editorBlock.id);
        console.log('🔷 [FRONTEND] Block update data:', {
          id: editorBlock.id,
          contentLength: contentString.length
        });
        
        try {
          await dbBlocks.updateBlock(editorBlock.id, {
            content: contentString,
          });
          console.log('🔷 [FRONTEND] Successfully updated editor block:', editorBlock.id);
        } catch (updateError) {
          console.error('🔷 [FRONTEND] Error updating block:', updateError);
          throw updateError;
        }
      } else {
        // Create new block
        const newBlockId = uuidv4();
        editorBlockIdRef.current = newBlockId;
        
        console.log('🔷 [FRONTEND] Creating new block with ID:', newBlockId);
        console.log('🔷 [FRONTEND] Block creation data:', {
          id: newBlockId,
          page_id: pageId,
          type: 'editor',
          contentLength: contentString.length,
          order_index: 0
        });
        
        try {
          await dbBlocks.createBlock({
            id: newBlockId,
            page_id: pageId,
            user_id: '', // Will be set by the database
            type: 'editor',
            content: contentString,
            metadata: null,
            order_index: 0,
          });
          console.log('🔷 [FRONTEND] Successfully created new editor block:', newBlockId, 'for page', pageId);
        } catch (createError) {
          console.error('🔷 [FRONTEND] Error creating block:', createError);
          throw createError;
        }
      }
      
      // Store the last saved content
      lastSavedContentRef.current = contentString;
      isContentChangedRef.current = false;
      
      // Refetch blocks to update the UI
      console.log('🔷 [FRONTEND] Refetching blocks after save');
      await refetchBlocks();
      
      // Update saving state
      isSavingRef.current = false;
      setSaveStatus('saved');
      console.log('🔷 [FRONTEND] Editor content saved successfully');
    } catch (error) {
      console.error('🔷 [FRONTEND] Error saving editor content:', error);
      isSavingRef.current = false;
      setSaveStatus('error');
    }
  }, [editor, editorReady, pageId, blocks, refetchBlocks]);
  
  // Debounced save function
  const debouncedSave = useCallback(() => {
    // Clear any existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    // Set a new timeout
    saveTimeoutRef.current = setTimeout(() => {
      if (isContentChangedRef.current) {
        saveEditorContent(false).catch(console.error);
      }
    }, 2000);
  }, [saveEditorContent]);

  // Reset editor state when page changes
  useEffect(() => {
    console.log('=== PAGE COMPONENT MOUNTED/UPDATED ===');
    console.log('Current Page ID:', pageId);
    
    // Clean up any pending save timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    
    // Reset editor state
    setEditorReady(false);
    editorBlockIdRef.current = null;
    lastSavedContentRef.current = null;
    isContentChangedRef.current = false;
    isSavingRef.current = false;
    setSaveStatus('saved');
    
    // If we have an editor, clear it
    if (editor) {
      editor.replaceBlocks(editor.document, [
        {
          type: "paragraph",
          content: "Loading content..."
        }
      ]);
    }
    
    // Cleanup function
    return () => {
      // Clear any pending save timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [pageId, editor]);

  // Load editor content when blocks are loaded
  useEffect(() => {
    if (!isBlocksLoading && blocks && editor && pageId) {
      console.log('=== LOADING BLOCKS FOR PAGE ===');
      console.log(`Page ID: ${pageId}`);
      console.log(`Total blocks found: ${blocks.length}`);
      
      // Find editor block for this page
      const editorBlock = blocks.find(block => 
        block.type === 'editor' && block.page_id === pageId
      );
      
      console.log('Found editor block for current page:', editorBlock?.id);
      
      if (editorBlock && editorBlock.content) {
        try {
          // Parse the content
          const content = JSON.parse(editorBlock.content);
          
          // Store the block ID for future updates
          editorBlockIdRef.current = editorBlock.id;
          
          // Store the content string for comparison
          lastSavedContentRef.current = editorBlock.content;
          
          // Replace editor content
          editor.replaceBlocks(editor.document, content);
          console.log('Loaded editor content from block:', editorBlock.id);
        } catch (e) {
          console.error('Error parsing block content:', e);
        }
      } else {
        // If no blocks, set default content
        editor.replaceBlocks(editor.document, [
          {
            type: "paragraph",
            content: "Start writing here..."
          }
        ]);
        console.log('No editor block found, using default content');
      }
      
      setEditorReady(true);
    }
  }, [isBlocksLoading, blocks, editor, pageId]);

  // Update page data when loaded
  useEffect(() => {
    if (pageData && pageData.page) {
      setTitle(pageData.page.title);
      setIcon(pageData.page.type || '📄');
      // You could also set cover image here if you store it in the page metadata
    }
  }, [pageData]);

  // Setup editor content change listener
  useEffect(() => {
    if (!editor || !editorReady) return;
    
    console.log('Setting up editor content change listener');
    
    // Setup listener for editor changes
    const unsubscribe: any = editor.onEditorContentChange(() => {
      // Mark content as changed
      isContentChangedRef.current = true;
      
      // Update the save status only if we're not already saving
      if (!isSavingRef.current) {
        setSaveStatus('saving');
      }
      
      // Trigger debounced save
      debouncedSave();
    });
    
    // Cleanup listener on unmount
    return () => {
      try {
        console.log('Cleaning up editor content change listener');
        
        // Clear any pending save timeout
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        
        // BlockNote's unsubscribe handling
        if (unsubscribe && typeof unsubscribe === 'function') {
          unsubscribe();
        } else if (unsubscribe) {
          // Some versions of BlockNote return an object with an unsubscribe method
          console.log('Unsubscribe type:', typeof unsubscribe);
          // Try common patterns for event unsubscription
          if (typeof unsubscribe.unsubscribe === 'function') {
            unsubscribe.unsubscribe();
          } else if (typeof unsubscribe.off === 'function') {
            unsubscribe.off();
          } else if (typeof unsubscribe.remove === 'function') {
            unsubscribe.remove();
          } else {
            console.log('Could not find a way to unsubscribe');
          }
        }
        
        // Force save any pending changes when unmounting
        if (isContentChangedRef.current) {
          saveEditorContent(true).catch(console.error);
        }
      } catch (error) {
        console.error('Error cleaning up editor listener:', error);
      }
    };
  }, [editor, editorReady, debouncedSave, saveEditorContent]);

  // Handle title change
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    
    // Update page title in the database
    if (pageId) {
      updatePageMutation.mutate({
        pageId,
        data: { title: newTitle }
      });
    }
  };

  // Navigate back to the previous page
  const handleGoBack = () => {
    // Save any pending changes before navigating
    if (isContentChangedRef.current) {
      saveEditorContent(true)
        .then(() => {
          console.log('All changes saved before navigation');
          navigate({ to: '/' });
        })
        .catch((error) => {
          console.error('Error saving changes before navigation:', error);
          navigate({ to: '/' });
        });
    } else {
      // No changes to save, just navigate
      navigate({ to: '/' });
    }
  };

  if (isPageLoading || isBlocksLoading) {
    return <div className="page-loading">Loading page...</div>;
  }

  if (pageError) {
    return <div className="page-error">Error loading page: {String(pageError)}</div>;
  }

  return (
    <div className="page-container">
      {/* Back button */}
      <button 
        className="page-back-button" 
        onClick={handleGoBack}
        aria-label="Go back"
      >
        ← Back
      </button>
      
      {/* Save status indicator */}
      <div className="save-status">
        {saveStatus === 'saving' && <span className="saving">Saving...</span>}
        {saveStatus === 'saved' && <span className="saved">All changes saved</span>}
        {saveStatus === 'error' && <span className="error">Error saving changes</span>}
      </div>
      
      {/* Cover image */}
      {coverImage && (
        <div className="page-cover">
          <img src={coverImage} alt="Cover" />
          <button className="change-cover-button">Change Cover</button>
        </div>
      )}
      
      <div className="page-content-wrapper">
        {/* Icon and title */}
        <div className="page-header">
          <div className="page-icon-title">
            <div className="page-icon" role="button" title="Change icon">
              {icon}
            </div>
            <input
              type="text"
              className="page-title-input"
              value={title}
              onChange={handleTitleChange}
              placeholder="Untitled"
            />
          </div>
        </div>
        
        {/* Add cover button if no cover exists */}
        {!coverImage && (
          <button className="add-cover-button" onClick={() => {
            const imageId = Math.floor(Math.random() * 1000);
            setCoverImage(`https://picsum.photos/1200/300?random=${imageId}`);
          }}>
            Add Cover
          </button>
        )}
        
        {/* Page properties */}
        <div className="page-properties">
          <div className="property">
            <span className="property-label">Created</span>
            <span className="property-value">
              {pageData?.page?.created_at 
                ? new Date(pageData.page.created_at).toLocaleDateString() 
                : 'Today'}
            </span>
          </div>
          <div className="property">
            <span className="property-label">Last edited</span>
            <span className="property-value">
              {pageData?.page?.updated_at 
                ? new Date(pageData.page.updated_at).toLocaleDateString() 
                : 'Just now'}
            </span>
          </div>
          <button className="add-property-button">+ Add property</button>
        </div>
        
        {/* Editor */}
        <div className="page-editor">
          {editorReady && <BlockNoteView editor={editor} />}
        </div>
      </div>
    </div>
  );
};

export default Page;
