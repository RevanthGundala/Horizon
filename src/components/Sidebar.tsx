import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import '../styles/Sidebar.css';
import PageService, { Page } from '../services/PageService'
import { useUser } from '@/hooks/use-user';

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
  const [expandedTeamspaces, setExpandedTeamspaces] = useState<Record<string, boolean>>({
    'mobbin-team-hq': true
  });
  const [pages, setPages] = useState<Page[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { user, loading } = useUser();

  console.log("user: ", user);


  // Fetch pages when user is authenticated
  useEffect(() => {
    const fetchPages = async () => {
      if (user && user.id) {
        setIsLoading(true);
        try {
          const userPages = await PageService.getUserPages(user.id);
          setPages(userPages);
        } catch (error) {
          console.error('Error fetching pages:', error);
        } finally {
          setIsLoading(false);
        }
      }
    };

    if (user) {
      fetchPages();
    }
  }, [user]);

  const toggleTeamspace = (id: string) => {
    setExpandedTeamspaces(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const teamspaces: TeamspaceItem[] = [
    {
      id: 'mobbin-team-hq',
      name: 'Mobbin Team HQ',
      icon: '🏠',
      items: [
        { id: 'tasks', name: 'Tasks', icon: '📋' },
        { id: 'projects', name: 'Projects', icon: '@' },
        { id: 'sprint-board', name: 'Sprint board', icon: '🏃' },
        { id: 'sprints', name: 'Sprints', icon: '📊' },
        { id: 'wiki', name: 'Wiki', icon: '📚' },
        { id: 'meetings', name: 'Meetings', icon: '📅' },
        { id: 'docs', name: 'Docs', icon: '📄' },
      ]
    }
  ];

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


  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="team-info">
          <div className="team-avatar">M</div>
          <div className="team-name">Mobbin Team</div>
        </div>
        <button className="sidebar-menu-button">⋮</button>
      </div>

      <div className="sidebar-section">
        <div className="section-header">Teamspaces</div>
        <div className="section-items">
          {teamspaces.map(teamspace => (
            <div key={teamspace.id} className="teamspace-item">
              <div 
                className="teamspace-header" 
                onClick={() => toggleTeamspace(teamspace.id)}
              >
                <span className="teamspace-icon">{teamspace.icon}</span>
                <span className="teamspace-name">{teamspace.name}</span>
                <span className="teamspace-toggle">
                  {expandedTeamspaces[teamspace.id] ? '▼' : '▶'}
                </span>
              </div>
              
              {expandedTeamspaces[teamspace.id] && teamspace.items && (
                <div className="teamspace-subitems">
                  {teamspace.items.map(item => (
                    <NavLink 
                      to="#"
                      key={item.id} 
                      className="teamspace-subitem"
                    >
                      <span className="subitem-icon">{item.icon}</span>
                      <span className="subitem-name">{item.name}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="teamspace-item all-teamspaces">
            <NavLink to="#" className="teamspace-link">
              <span className="teamspace-icon">•••</span>
              <span className="teamspace-name">All teamspaces</span>
            </NavLink>
          </div>
        </div>
      </div>

      <div className="sidebar-section">
        <div className="section-header">
          <span>Private</span>
          {user && (
            <button 
              className="add-page-button"
              onClick={() => {
                if (user) {
                  PageService.createPage(user.id, 'New Page', '📄');
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

      <div className="sidebar-footer">
        <NavLink to="#" className="footer-item">
          <span className="footer-icon">⚙️</span>
          <span className="footer-text">Settings</span>
        </NavLink>
        <NavLink to="#" className="footer-item">
          <span className="footer-icon">📅</span>
          <span className="footer-text">Calendar</span>
          <span className="external-link">↗</span>
        </NavLink>
        <NavLink to="#" className="footer-item">
          <span className="footer-icon">📋</span>
          <span className="footer-text">Templates</span>
        </NavLink>
        <NavLink to="#" className="footer-item">
          <span className="footer-icon">⬇️</span>
          <span className="footer-text">Import</span>
        </NavLink>
        <NavLink to="#" className="footer-item">
          <span className="footer-icon">🗑️</span>
          <span className="footer-text">Trash</span>
        </NavLink>
      </div>

      <div className="sidebar-trial">
        <div className="trial-info">
          <div className="trial-title">Trial of the Plus plan</div>
          <div className="trial-expiry">This workspace's trial ends March 6, 2024</div>
        </div>
        <button className="manage-plan-button">Manage plan</button>
      </div>
    </div>
  );
};

export default Sidebar;
