'use client';

import { useState } from 'react';

interface SearchBarProps {
  onSearch: (query: string, type: string, era: string, niche: string) => void;
  isLoading: boolean;
}

const SEARCH_NICHES = [
  'history (vintage)',
  'true crime',
  'motivational',
  'self improvement',
  'personal finance and investing',
];

export default function SearchBar({ onSearch, isLoading }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [era, setEra] = useState('');
  const [niche, setNiche] = useState(SEARCH_NICHES[0]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query, type, era, niche);
  };

  return (
    <div className="search-container">
      <form onSubmit={handleSubmit}>
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search vintage assets (e.g. '1950s family', 'factory workers')..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="primary" disabled={isLoading}>
            {isLoading ? 'Searching...' : 'Search'}
          </button>
        </div>
        <div className="filters">
          <div className="filter-group">
            <label>Media Type:</label>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="all">All Media</option>
              <option value="video">Videos</option>
              <option value="image">Images</option>
            </select>
          </div>
          <div className="filter-group">
            <label>Era:</label>
            <select value={era} onChange={(e) => setEra(e.target.value)}>
              <option value="">Any Era</option>
              <option value="1920s">1920s</option>
              <option value="1930s">1930s</option>
              <option value="1940s">1940s</option>
              <option value="1950s">1950s</option>
              <option value="1960s">1960s</option>
            </select>
          </div>
          <div className="filter-group">
            <label>Niche:</label>
            <select value={niche} onChange={(e) => setNiche(e.target.value)}>
              {SEARCH_NICHES.map((entry) => (
                <option key={entry} value={entry}>{entry}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Orientation:</label>
            <select>
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
              <option value="square">Square</option>
            </select>
          </div>
        </div>
      </form>
    </div>
  );
}
