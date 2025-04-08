import { useParams, useNavigate } from '@tanstack/react-router';
import { useState, useEffect, useCallback } from 'react';
import { useCreateBlockNote, useBlockNoteEditor } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../styles/Page.css';
import { usePage, useUpdatePage } from '../hooks/usePages';
import { useBlocks, useBlocksStore, useUpdateBlockMutation } from '../hooks/useBlocks';
import { Block } from '../utils/api/blocks';
import { v4 as uuidv4 } from 'uuid';

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
  
  // Use our custom hooks
  const { data: pageData, isLoading: isPageLoading, error: pageError } = usePage(pageId);
  const { isLoading: isBlocksLoading } = useBlocks(pageId);
  const { blocks, updateBlock, createBlockLocally, saveChanges } = useBlocksStore();
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

  // Update editor content when blocks are loaded
  useEffect(() => {
    if (!isBlocksLoading && blocks.length > 0 && editor) {
      // Convert our blocks to BlockNote format
      const blockNoteBlocks = blocks
        .filter(block => block.type === 'editor')
        .map(block => {
          try {
            // Parse the content if it's JSON
            return block.content ? JSON.parse(block.content) : null;
          } catch (e) {
            console.error('Error parsing block content:', e);
            return null;
          }
        })
        .filter(Boolean);

      if (blockNoteBlocks.length > 0) {
        editor.replaceBlocks(editor.document, blockNoteBlocks);
      }
      
      setEditorReady(true);
    } else if (!isBlocksLoading && blocks.length === 0 && editor) {
      // If no blocks, we already have a default paragraph from initialization
      setEditorReady(true);
    }
  }, [isBlocksLoading, blocks, editor]);

  // Update page data when loaded
  useEffect(() => {
    if (pageData && pageData.page) {
      setTitle(pageData.page.title);
      setIcon(pageData.page.type || '📄');
      // You could also set cover image here if you store it in the page metadata
    }
  }, [pageData]);

  // Save editor content when it changes
  useEffect(() => {
    if (!editorReady || !editor) return;

    const saveEditorContent = async () => {
      const editorContent = await editor.document;
      
      // Find existing editor block or create one
      const existingEditorBlock = blocks.find(block => block.type === 'editor');
      
      if (existingEditorBlock) {
        // Update existing block
        updateBlock(existingEditorBlock.id, {
          content: JSON.stringify(editorContent)
        });
      } else {
        // Create new block
        createBlockLocally(uuidv4(), {
          type: 'editor',
          content: JSON.stringify(editorContent),
          metadata: null,
          order_index: 0
        });
      }
    };

    // Setup listener for editor changes
    editor.onEditorContentChange(() => {
      void saveEditorContent();
    });

  }, [editorReady, editor, blocks, updateBlock, createBlockLocally]);

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

  // Save all pending changes
  const handleSaveChanges = async () => {
    try {
      await saveChanges();
    } catch (error) {
      console.error('Error saving changes:', error);
    }
  };

  // Navigate back to the previous page
  const handleGoBack = () => {
    // Save any pending changes before navigating
    handleSaveChanges();
    // Navigate back to the home page or parent page
    navigate({ to: '/' });
  };

  // Auto-save changes every 5 seconds
  useEffect(() => {
    const autoSaveInterval = setInterval(() => {
      handleSaveChanges();
    }, 5000);

    return () => {
      clearInterval(autoSaveInterval);
    };
  }, []);

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
          <div className="page-actions">
            <button 
              className="page-action-button"
              onClick={handleSaveChanges}
              disabled={updatePageMutation.isPending}
            >
              <span>{updatePageMutation.isPending ? 'Saving...' : 'Save'}</span>
            </button>
            <button className="page-action-button">
              <span>Share</span>
            </button>
            <button className="page-action-button">
              <span>⋮</span>
            </button>
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
