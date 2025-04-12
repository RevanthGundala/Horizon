import React, { useState, useEffect, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import '../styles/Sidebar.css';
import { useAuth } from '@/contexts/auth-context';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaces, useWorkspaceNotes, useDeleteNote, useUpdateNote } from '../hooks/useWorkspaces';

const Sidebar: React.FC = () => {
  const { logout, userId } = useAuth();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeNoteMenu, setActiveNoteMenu] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  
  // Track the current location manually
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  
  // Get the query client for invalidating queries
  const queryClient = useQueryClient();
  
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
  
  // Fetch workspaces from the database
  const { data: workspaces, isLoading: isWorkspacesLoading } = useWorkspaces();
  
  // Set active workspace when workspaces are loaded
  useEffect(() => {
    if (!isWorkspacesLoading && workspaces && workspaces.length > 0 && !activeWorkspaceId) {
      setActiveWorkspaceId(workspaces[0].id);
    }
  }, [workspaces, isWorkspacesLoading, activeWorkspaceId]);
  
  // Fetch notes for the active workspace
  const { data: workspaceNotes, isLoading: isNotesLoading } = useWorkspaceNotes(
    activeWorkspaceId || '', 
    {
      queryKey: ['workspace-notes', activeWorkspaceId],
      enabled: !!activeWorkspaceId
    }
  );
  
  // Delete note mutation
  const { mutateAsync: deleteNoteMutation } = useDeleteNote();

  // Add update note mutation
  const { mutateAsync: updateNote } = useUpdateNote();

  // Handle clicks outside the menu to close it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
        setActiveNoteMenu(null);
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
    
    // Apply active class if this is the current route
    const linkClassName = isActive ? `${className} active-nav-item` : className;
    
    // Add click handler to update current path
    const handleClick = () => {
      setTimeout(() => {
        setCurrentPath(window.location.pathname);
      }, 50);
    };
    
    // Only use Link for defined routes
    if (to === '/' || to.startsWith('/note/')) {
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

  const handleWorkspaceChange = (workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
  };

  const handleNoteMenuToggle = (noteId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveNoteMenu(activeNoteMenu === noteId ? null : noteId);
  };

  const handleDeleteNote = async (noteId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await deleteNoteMutation(noteId);
      setActiveNoteMenu(null);
    } catch (error) {
      console.error('Error deleting note:', error);
    }
  };

  const handleDrop = async (draggedNoteId: string, targetNoteId: string) => {
    try {
      await updateNote({
        noteId: draggedNoteId,
        data: {
          parent_id: targetNoteId
        }
      });
      // Fix: Pass as query key object
      queryClient.invalidateQueries({ 
        queryKey: ['workspace-notes', activeWorkspaceId] 
      });
    } catch (error) {
      console.error('Error updating note parent:', error);
    }
  };

  const NoteItem: React.FC<{
    note: any;
    onNoteMenuToggle: (noteId: string, e: React.MouseEvent) => void;
    onDeleteNote: (noteId: string, e: React.MouseEvent) => void;
    currentPath: string;
    onDrop: (draggedNoteId: string, targetNoteId: string) => void;
  }> = ({ note, onNoteMenuToggle, onDeleteNote, currentPath, onDrop }) => {
    const ref = useRef<HTMLDivElement>(null);
    const [{ isDragging }, drag] = useDrag(() => ({
      type: 'NOTE',
      item: { id: note.id },
      collect: (monitor) => ({
        isDragging: !!monitor.isDragging(),
      }),
    }));

    const [{ isOver }, drop] = useDrop(() => ({
      accept: 'NOTE',
      drop: (item: { id: string }) => onDrop(item.id, note.id),
      collect: (monitor) => ({
        isOver: !!monitor.isOver(),
      }),
    }));

    drag(drop(ref));

    const isActive = `/note/${note.id}` === currentPath || 
                    currentPath.startsWith(`/note/${note.id}`);
                    
    const linkClassName = isActive ? 'nav-item active-nav-item' : 'nav-item';

    return (
      <div 
        ref={ref}
        className={`nav-item-container ${isDragging ? 'dragging' : ''} ${isOver ? 'drop-target' : ''}`}
      >
        <Link 
          to="/note/$noteId" 
          params={{ noteId: note.id }}
          className={linkClassName}
          onClick={() => setTimeout(() => setCurrentPath(window.location.pathname), 50)}
        >
          <span className="nav-icon">📝</span>
          <span className="nav-text">{note.title}</span>
        </Link>
        <button 
          className="page-menu-button" 
          onClick={(e) => onNoteMenuToggle(note.id, e)}
          aria-label="Note options"
        >
          ⋮
        </button>
        {activeNoteMenu === note.id && (
          <div className="page-dropdown-menu">
            <button 
              className="dropdown-item delete-item"
              onClick={(e) => onDeleteNote(note.id, e)}
            >
              <span className="dropdown-icon">🗑️</span>
              <span>Delete</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="sidebar" ref={menuRef}>
        <div className="sidebar-header">
          <div className="app-logo">Horizon</div>
        </div>
        
        {/* Main Navigation */}
        <div className="sidebar-nav">
          <NavLink to="/" className="nav-item">
            <span className="nav-icon">🏠</span>
            <span className="nav-text">Home</span>
          </NavLink>
          
          {/* Workspaces Dropdown */}
          <div className="nav-section">
            <div className="nav-section-header">
              <span>Workspaces</span>
            </div>
            
            {isWorkspacesLoading ? (
              <div className="nav-loading">Loading workspaces...</div>
            ) : (
              <div className="workspace-selector">
                {workspaces && workspaces.length > 0 ? (
                  <select 
                    value={activeWorkspaceId || ''} 
                    onChange={(e) => handleWorkspaceChange(e.target.value)}
                    className="workspace-select"
                  >
                    {workspaces.map(workspace => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="nav-empty">No workspaces yet</div>
                )}
              </div>
            )}
          </div>
          
          {/* Notes List for Active Workspace */}
          <div className="nav-section">
            <div className="nav-section-header">
              <span>Notes</span>
            </div>
            
            {isNotesLoading || !activeWorkspaceId ? (
              <div className="nav-loading">Loading notes...</div>
            ) : (
              <div className="nav-items">
                {workspaceNotes && workspaceNotes.length > 0 ? (
                  workspaceNotes.map(note => (
                    <NoteItem
                      key={note.id}
                      note={note}
                      onNoteMenuToggle={handleNoteMenuToggle}
                      onDeleteNote={handleDeleteNote}
                      currentPath={currentPath}
                      onDrop={handleDrop}
                    />
                  ))
                ) : (
                  <div className="nav-empty">No notes in this workspace yet</div>
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
                <button 
                  className="menu-button"
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
    </DndProvider>
  );
};

export default Sidebar;
