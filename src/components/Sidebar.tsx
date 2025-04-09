import React, { useState, useEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import '../styles/Sidebar.css';
import { useAuth } from '@/contexts/auth-context';
import { usePages, useDeletePage } from '../hooks/usePages';

interface TeamspaceItem {
  id: string;
  name: string;
  icon: string;
  items?: TeamspaceSubItem[];
}

interface TeamspaceSubItem {
  id: string;
  name: string;
  icon: string;
}

const Sidebar: React.FC = () => {
  const { logout, userId } = useAuth();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activePageMenu, setActivePageMenu] = useState<string | null>(null);
  
  // Track the current location manually
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  
  // Update current path when location changes
  useEffect(() => {
    const updatePath = () => {
      setCurrentPath(window.location.pathname);
      console.log('Current path updated:', window.location.pathname);
    };
    
    // Initial update
    updatePath();
    
    // Listen for location changes
    window.addEventListener('popstate', updatePath);
    
    return () => {
      window.removeEventListener('popstate', updatePath);
    };
  }, []);
  
  // Fetch pages from the database
  const { data: pages, isLoading: isPagesLoading } = usePages();
  // Delete page mutation
  const deletePage = useDeletePage();

  // Handle clicks outside the menu to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
        setActivePageMenu(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Helper function to create links that work with the router
  const NavLink: React.FC<{ to: string; className: string; children: React.ReactNode }> = ({ 
    to, 
    className, 
    children 
  }) => {
    // Simple check if this link matches the current path
    const isActive = to === currentPath || 
                    (to !== '/' && currentPath.startsWith(to));
    
    console.log(`Link: ${to}, Current: ${currentPath}, isActive: ${isActive}`);
    
    // Apply active class if this is the current route
    const linkClassName = isActive ? `${className} active-nav-item` : className;
    
    // Add click handler to update current path
    const handleClick = () => {
      setTimeout(() => {
        setCurrentPath(window.location.pathname);
        console.log('Path updated after click:', window.location.pathname);
      }, 50);
    };
    
    // Only use Link for defined routes
    if (to === '/' || to.startsWith('/page/')) {
      return <Link to={to} className={linkClassName} onClick={handleClick}>{children}</Link>;
    }
    // Use anchor tag for other routes
    return <a href="#" className={linkClassName}>{children}</a>;
  };

  const handleLogout = async () => {
    try {
      await logout();
      setMenuOpen(false);
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  const handlePageMenuToggle = (pageId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActivePageMenu(activePageMenu === pageId ? null : pageId);
  };

  const handleDeletePage = async (pageId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await deletePage.mutateAsync(pageId);
      setActivePageMenu(null);
    } catch (error) {
      console.error('Error deleting page:', error);
    }
  };

  return (
    <div className="sidebar" ref={menuRef}>
      <div className="sidebar-header">
        <div className="app-logo">Horizon</div>
      </div>
      
      {/* Pages Navigation */}
      <div className="sidebar-nav">
        <NavLink to="/" className="nav-item">
          <span className="nav-icon">🏠</span>
          <span className="nav-text">Home</span>
        </NavLink>
        
        {/* Pages List */}
        <div className="nav-section">
          <div className="nav-section-header">
            <span>Pages</span>
          </div>
          
          {isPagesLoading ? (
            <div className="nav-loading">Loading pages...</div>
          ) : (
            <div className="nav-items">
              {pages && pages.length > 0 ? (
                pages.map(page => (
                  <div key={page.id} className="nav-item-container">
                    <NavLink 
                      key={page.id} 
                      to={`/page/${page.id}`} 
                      className="nav-item"
                    >
                      <span className="nav-icon">{page.type === 'note' ? '📝' : '📄'}</span>
                      <span className="nav-text">{page.title}</span>
                    </NavLink>
                    <button 
                      className="page-menu-button" 
                      onClick={(e) => handlePageMenuToggle(page.id, e)}
                      aria-label="Page options"
                    >
                      ⋮
                    </button>
                    {activePageMenu === page.id && (
                      <div className="page-dropdown-menu">
                        <button 
                          className="dropdown-item delete-item"
                          onClick={(e) => handleDeletePage(page.id, e)}
                        >
                          <span className="dropdown-icon">🗑️</span>
                          <span>Delete</span>
                        </button>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="nav-empty">No pages yet</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* User Profile at Bottom */}
      <div className="sidebar-user-profile">
        {userId ? (
          <>
            <div className="user-info">
              <div className="user-avatar">
                {userId.charAt(0)}
              </div>
              <div className="user-details">
                <div className="user-name">{userId}</div>
                <div className="user-email">{userId}</div>
              </div>
            </div>
            <div className="user-actions">
              {menuOpen && (
                <div className="user-dropdown-menu">
                  <button 
                    className="dropdown-item"
                    onClick={handleLogout}
                  >
                    <span className="dropdown-icon">🚪</span>
                    <span>Logout</span>
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="user-info">
            <div className="user-avatar">?</div>
            <div className="user-details">
              <div className="user-name">Guest User</div>
              <div className="user-email">Not signed in</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sidebar;
