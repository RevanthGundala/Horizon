import { useParams } from '@tanstack/react-router';
import { useState, useEffect } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import '../styles/Page.css';

interface PageProps {
  // Add props as needed
}

const Page: React.FC<PageProps> = () => {
  const { pageId } = useParams({ from: '/page/$pageId' });
  const [title, setTitle] = useState('Untitled');
  const [isLoading, setIsLoading] = useState(true);
  const [coverImage, setCoverImage] = useState<string | null>(null);
  const [icon, setIcon] = useState<string>('📄');
  
  // Initialize the editor with Notion-like configuration
  const editor = useCreateBlockNote({
    initialContent: [
      {
        type: "paragraph",
        content: "Start writing here..."
      }
    ]
  });

  // Simulate loading page data
  useEffect(() => {
    // In a real app, you would fetch the page data from your API
    const loadPage = async () => {
      setIsLoading(true);
      try {
        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Mock data - replace with actual API call
        setTitle(`Page ${pageId}`);
        
        // Random chance of having a cover image
        if (Math.random() > 0.5) {
          const imageId = Math.floor(Math.random() * 1000);
          setCoverImage(`https://picsum.photos/1200/300?random=${imageId}`);
        }
        
        // Random icon
        const icons = ['📝', '📚', '🗂️', '📊', '🔍', '💡', '🏆', '🎯', '📌', '🔖'];
        setIcon(icons[Math.floor(Math.random() * icons.length)]);
        
      } catch (error) {
        console.error('Error loading page:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadPage();
  }, [pageId]);

  if (isLoading) {
    return <div className="page-loading">Loading page...</div>;
  }

  return (
    <div className="page-container">
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
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled"
            />
          </div>
          <div className="page-actions">
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
            <span className="property-value">Today</span>
          </div>
          <div className="property">
            <span className="property-label">Last edited</span>
            <span className="property-value">Just now</span>
          </div>
          <button className="add-property-button">+ Add property</button>
        </div>
        
        {/* Editor */}
        <div className="page-editor">
          <BlockNoteView editor={editor} />
        </div>
      </div>
    </div>
  );
};

export default Page;
