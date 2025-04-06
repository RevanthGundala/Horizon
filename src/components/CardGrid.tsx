import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import '../styles/CardGrid.css';

export interface Card {
  id: string;
  title: string;
  description?: string;
  lastEdited?: string;
  color?: string;
}

interface CardGridProps {
  cards: Card[];
  onCreateCard?: () => void;
}

const CardGrid: React.FC<CardGridProps> = ({ cards, onCreateCard }) => {
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  // Generate a random pastel color
  const getRandomColor = () => {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 70%, 85%)`;
  };

  return (
    <div className="card-grid-container">
      <div className="card-grid-header">
        <h2>Your Pages</h2>
        <button className="create-card-button" onClick={onCreateCard}>
          + New Page
        </button>
      </div>
      
      <div className="card-grid">
        {cards.map((card) => (
          <Link
            key={card.id}
            to="/page/$pageId"
            params={{ pageId: card.id }}
            className="card-link"
          >
            <div 
              className="card-item"
              style={{ backgroundColor: card.color || getRandomColor() }}
              onMouseEnter={() => setHoveredCard(card.id)}
              onMouseLeave={() => setHoveredCard(null)}
            >
              <h3 className="card-title">{card.title}</h3>
              {card.description && (
                <p className="card-description">{card.description}</p>
              )}
              {card.lastEdited && (
                <div className="card-footer">
                  <span className="last-edited">
                    Edited {card.lastEdited}
                  </span>
                </div>
              )}
              {hoveredCard === card.id && (
                <div className="card-hover-overlay">
                  <span>Open</span>
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default CardGrid;
