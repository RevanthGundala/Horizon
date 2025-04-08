import React, { useState, useEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import '../styles/Sidebar.css';
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
  const { logout, userId } = useAuth();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

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
