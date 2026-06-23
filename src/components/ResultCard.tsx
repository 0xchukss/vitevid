'use client';

import { ResultItem } from '@/types';

interface ResultCardProps {
  item: ResultItem;
  onDownload: (item: ResultItem) => void;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onOpenPlayer?: (item: ResultItem) => void;
  localPath?: string;
}

export default function ResultCard({ item, onDownload, isSelected, onSelect, onOpenPlayer, localPath }: ResultCardProps) {
  const rightsClass = item.isCopyrightSafe && !item.needsRightsReview ? 'safe' : 'review';
  const rightsLabel = item.rightsLabel || (item.isCopyrightSafe ? 'License-filtered' : 'Review rights');

  const handleDragStart = (e: React.DragEvent) => {
    if (item.type === 'image') {
      console.log('Dragging image:', item.title);
      // "Download on Drag" trick for Chrome/Edge to allow dragging to local apps
      const downloadAttr = `image/jpeg:${item.title.replace(/[^a-z0-9]/gi, '_')}.jpg:${item.thumbnail}`;
      e.dataTransfer.setData('DownloadURL', downloadAttr);
      e.dataTransfer.setData('text/plain', item.thumbnail);
    }
  };

  const handleCopyPath = () => {
    if (localPath) {
      navigator.clipboard.writeText(localPath);
      alert('Path copied to clipboard!');
    } else {
      alert('Download first to copy path!');
    }
  };

  return (
    <div 
      className={`result-card ${isSelected ? 'selected' : ''}`} 
      onClick={() => onSelect(item.id)}
      draggable={item.type === 'image'}
      onDragStart={handleDragStart}
    >
      <div className="card-media">
        <img src={item.thumbnail} alt={item.title} loading="lazy" draggable={false} />
        
        {item.type === 'video' && (
          <button 
            className="play-btn" 
            onClick={(e) => { e.stopPropagation(); onOpenPlayer?.(item); }}
            title="Open Video Trimmer"
          >
            ▶
          </button>
        )}

        <button 
          className="download-btn" 
          onClick={(e) => { e.stopPropagation(); onDownload(item); }}
          title="Instant Download"
        >
          ↓
        </button>
        {isSelected && <div className="selection-overlay">✓</div>}
      </div>
      <div className="card-info">
        <div className="card-title" title={item.title}>{item.title}</div>
        <div className="card-meta">
          <span>{item.source} {item.year ? `(${item.year})` : ''}</span>
          <span className={`badge ${item.type}`}>{item.type}</span>
        </div>
        <div className="rights-row" title={item.rightsNote || rightsLabel}>
          <span className={`rights-pill ${rightsClass}`}>{rightsLabel}</span>
          {item.needsRightsReview && <span>verify before publish</span>}
        </div>
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
          <button 
            className={`copy-path-btn ${localPath ? 'active' : ''}`}
            onClick={(e) => { e.stopPropagation(); handleCopyPath(); }}
            disabled={!localPath}
          >
            {localPath ? 'Copy Path' : 'Not Downloaded'}
          </button>
          <a 
            href={item.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="view-source-link"
            onClick={(e) => e.stopPropagation()}
          >
            Source ↗
          </a>
        </div>
      </div>
    </div>
  );
}
