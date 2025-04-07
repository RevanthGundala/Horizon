import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import '../styles/Sidebar.css';
import PageService, { Page } from '../services/PageService'
import { useUser } from '@/hooks/use-user';
import { useAuth } from '@/contexts/auth-context';

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
  const [pages, setPages] = useState<Page[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const { logout, userId } = useAuth();
  const menuRef = useRef<HTMLDivElement>(null);

  // Handle clicks outside the menu to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Fetch pages when user is authenticated
  useEffect(() => {
    const fetchPages = async () => {
      if (userId) {
        setIsLoading(true);
        try {
          const userPages = await PageService.getUserPages(userId);
          setPages(userPages);
        } catch (error) {
          console.error('Error fetching pages:', error);
        } finally {
          setIsLoading(false);
        }
      }
    };

    if (userId) {
      fetchPages();
    }
  }, [userId]);

  // Helper function to create links that work with the router
  const NavLink: React.FC<{ to: string; className: string; children: React.ReactNode }> = ({ 
    to, 
    className, 
    children 
  }) => {
    // Only use Link for defined routes
    if (to === '/' || to.startsWith('/page/')) {
      return <Link to={to} className={className}>{children}</Link>;
    }
    // Use anchor tag for other routes
    return <a href="#" className={className}>{children}</a>;
  };

  const handleLogout = async () => {
    try {
      await logout();
      setMenuOpen(false);
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="app-logo">Horizon</div>
      </div>

      {/* Public Section */}
      <div className="sidebar-section">
        <div className="section-header">Public</div>
        <div className="section-items">
          <NavLink to="/" className="teamspace-subitem">
            <span className="subitem-icon">🏠</span>
            <span className="subitem-name">Home</span>
          </NavLink>
          <NavLink to="#" className="teamspace-subitem">
            <span className="subitem-icon">🔍</span>
            <span className="subitem-name">Explore</span>
          </NavLink>
        </div>
      </div>

      {/* Private Section */}
      <div className="sidebar-section">
        <div className="section-header">
          <span>Private</span>
          {userId && (
            <button 
              className="add-page-button"
              onClick={() => {
                if (userId) {
                  PageService.createPage(userId, 'New Page', '📄');
                }
              }}
            >
              +
            </button>
          )}
        </div>
        <div className="section-items">
          {isLoading ? (
            <div className="loading-pages">Loading pages...</div>
          ) : (
            pages.map(page => (
              <NavLink 
                to={`/page/${page.id}`}
                key={page.id} 
                className="teamspace-subitem"
              >
                <span className="subitem-icon">{page.icon || '📄'}</span>
                <span className="subitem-name">{page.title}</span>
              </NavLink>
            ))
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
              <button 
                className="logout-button"
                onClick={handleLogout}
                aria-label="Logout"
              >
                <span className="logout-icon">🚪</span>
                <span>Logout</span>
              </button>
            </div>
            <div className="user-menu-container" ref={menuRef}>
              <button 
                className="user-menu-button"
                onClick={() => setMenuOpen(!menuOpen)}
                aria-label="User menu"
              >
                ⋮
              </button>
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
