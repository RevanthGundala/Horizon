import React, { useState, useRef, useEffect } from 'react';
import '../styles/SearchBar.css';

interface SearchBarProps {
  onSubmit: (query: string) => void;
  onFocusChange?: (isFocused: boolean) => void;
  onCancel?: () => void;
  isLoading?: boolean;
}

const SearchBar: React.FC<SearchBarProps> = ({ 
  onSubmit, 
  onFocusChange, 
  onCancel,
  isLoading = false 
}) => {
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [placeholder, setPlaceholder] = useState('Search Airbnb listings for Cairo');
  const inputRef = useRef<HTMLInputElement>(null);
  const searchBarRef = useRef<HTMLDivElement>(null);

  // Handle click outside to unfocus
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchBarRef.current && !searchBarRef.current.contains(event.target as Node)) {
        setIsFocused(false);
        if (onFocusChange) onFocusChange(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onFocusChange]);

  const handleFocus = () => {
    setIsFocused(true);
    setPlaceholder('');
    if (onFocusChange) onFocusChange(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim() && !isLoading) {
      onSubmit(query);
      // Keep focus after submission
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && query.trim() && !isLoading) {
      handleSubmit(e);
    }
  };

  const handleCancel = () => {
    if (onCancel) {
      onCancel();
    }
  };

  return (
    <div 
      className={`search-bar-container ${isFocused ? 'focused' : ''}`}
      ref={searchBarRef}
    >
      <div className={`search-bar-overlay ${isFocused ? 'active' : ''}`} />
      
      <div className={`search-bar-wrapper ${isFocused ? 'focused' : ''}`}>
        <div className="search-bar">
          <div className="search-icon">
            <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="presentation" focusable="false">
              <path d="M13 0c7.18 0 13 5.82 13 13 0 2.868-.929 5.519-2.502 7.669l7.916 7.917-2.122 2.121-7.917-7.916A12.942 12.942 0 0 1 13 26C5.82 26 0 20.18 0 13S5.82 0 13 0zm0 4a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" fill="#222"></path>
            </svg>
          </div>
          
          <div className="search-input-container">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={handleFocus}
              onKeyPress={handleKeyPress}
              placeholder={placeholder}
              className="search-input"
              disabled={isLoading}
            />
            {query && !isLoading && (
              <button 
                className="clear-button" 
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          
          {isLoading ? (
            <button 
              className="search-button loading" 
              onClick={handleCancel}
              aria-label="Cancel search"
            >
              <div className="loading-spinner"></div>
              <div className="stop-icon">✕</div>
            </button>
          ) : (
            <button 
              className="search-button" 
              onClick={handleSubmit}
              disabled={!query.trim()}
            >
              <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" role="presentation" focusable="false">
                <path d="M13 0c7.18 0 13 5.82 13 13 0 2.868-.929 5.519-2.502 7.669l7.916 7.917-2.122 2.121-7.917-7.916A12.942 12.942 0 0 1 13 26C5.82 26 0 20.18 0 13S5.82 0 13 0zm0 4a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" fill="#fff"></path>
              </svg>
            </button>
          )}
        </div>
        
        {isFocused && (
          <div className="search-dropdown">
            <div className="search-dropdown-item">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1112.314 0z" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Log into Airbnb account</span>
            </div>
            <div className="search-dropdown-item">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2z" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M16 2v4M8 2v4M3 10h18" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span>Filter listings by date and amenities</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchBar;
