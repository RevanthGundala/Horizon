import React from 'react';
import '../styles/CardGrid.css';

export interface Card {
  id: string;
  title: string;
  description?: string;
  lastEdited?: string;
}

interface CardGridProps {
  cards: Card[];
  onCreateCard?: () => void;
  onCardClick?: (id: string) => void;
}

const CardGrid: React.FC<CardGridProps> = ({ 
  cards, 
  onCreateCard,
  onCardClick = (id) => window.location.href = `/page/${id}`
}) => {
  return (
    <div className="card-grid">
      {cards.map(card => (
        <div 
          key={card.id} 
          className="card" 
          onClick={() => onCardClick(card.id)}
        >
          <h3>{card.title}</h3>
          {card.description && <p className="card-desc">{card.description}</p>}
          {card.lastEdited && <p className="card-date">Last edited: {card.lastEdited}</p>}
        </div>
      ))}
      
      {onCreateCard && (
        <div className="card add-card" onClick={onCreateCard}>
          <div className="add-icon">+</div>
          <p>Create new</p>
        </div>
      )}
    </div>
  );
};

export default CardGrid;