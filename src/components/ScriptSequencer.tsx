'use client';

import { useState, useEffect } from 'react';
import { ResultItem } from '@/types';

interface Scene {
  id: number;
  text: string;
  keywords: string;
  results: ResultItem[];
  selectedClip: ResultItem | null;
  status: 'idle' | 'searching' | 'matched';
  timeRange: { start: number; end: number };
}

interface ScriptSequencerProps {
  onDownloadScene: (item: ResultItem, start: number, end: number, customName?: string) => Promise<void>;
  isDownloading: (id: string) => boolean;
}

export default function ScriptSequencer({ onDownloadScene, isDownloading }: ScriptSequencerProps) {
  const [script, setScript] = useState('');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const parseScript = () => {
    setIsProcessing(true);
    // Split by sentences or double newlines to get better scenes
    const segments = script.split(/\n\n+|(?<=[.!?])\s+/).filter(s => s.trim().length > 10);
    
    const newScenes: Scene[] = segments.map((text, index) => {
      // Improved keyword extraction: take first 3 unique words with > 3 chars
      const keywords = text.toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
        .split(' ')
        .filter(w => w.length > 3)
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 3)
        .join(' ');

      return {
        id: index,
        text,
        keywords: keywords || 'vintage',
        results: [],
        selectedClip: null,
        status: 'idle',
        timeRange: { start: 0, end: 5 }
      };
    });

    setScenes(newScenes);
    setIsProcessing(false);
    
    // Automatically trigger search for each scene
    newScenes.forEach(scene => searchForScene(scene.id, scene.keywords));
  };

  const searchForScene = async (sceneId: number, keywords: string) => {
    setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, status: 'searching' } : s));
    
    try {
      // Use existing search API, specifically requesting VIDEOS for the sequencer
      const response = await fetch(`/api/search?q=${encodeURIComponent(keywords)}&type=video&era=vintage`);
      const data = await response.json();
      const results = data.results || [];
      
      // Filter for videos only to satisfy user request
      const videosOnly = results.filter((r: ResultItem) => r.type === 'video');

      setScenes(prev => prev.map(s => {
        if (s.id === sceneId) {
          return { 
            ...s, 
            results: videosOnly, 
            status: videosOnly.length > 0 ? 'matched' : 'idle',
            selectedClip: videosOnly[0] || null 
          };
        }
        return s;
      }));
    } catch (error) {
      console.error(`Search failed for scene ${sceneId}:`, error);
      setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, status: 'idle' } : s));
    }
  };

  const updateSceneClip = (sceneId: number, item: ResultItem) => {
    setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, selectedClip: item } : s));
  };

  const updateSceneTime = (sceneId: number, start: number, end: number) => {
    setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, timeRange: { start, end } } : s));
  };

  const handleBatchDownloadAll = async () => {
    for (const scene of scenes) {
      if (scene.selectedClip) {
        const sanitized = scene.text.substring(0, 15).replace(/[^a-z0-9]/gi, '_');
        const customName = `Scene_${String(scene.id + 1).padStart(2, '0')}_${sanitized}`;
        await onDownloadScene(scene.selectedClip, scene.timeRange.start, scene.timeRange.end, customName);
      }
    }
    alert('All sequenced scenes have been queued for download!');
  };

  return (
    <div className="script-sequencer">
      <div className="script-input-area">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label style={{ fontWeight: '700', color: 'var(--primary)' }}>Script Arranger (Video Sequence)</label>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Auto-targets: Prelinger & LOC Videos</div>
        </div>
        <textarea 
          className="script-textarea"
          placeholder="Enter your script. Example: 'A man walks down a rainy street in the 1940s. He enters a busy diner...'"
          value={script}
          onChange={(e) => setScript(e.target.value)}
        />
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          {scenes.length > 0 && (
            <button className="secondary-btn" onClick={() => setScenes([])} style={{ padding: '0.75rem 1.5rem' }}>
              Clear
            </button>
          )}
          <button 
            className="primary" 
            onClick={parseScript} 
            disabled={isProcessing || !script.trim()}
          >
            {isProcessing ? 'Processing...' : 'Arrange Sequence'}
          </button>
        </div>
      </div>

      {scenes.length > 0 && (
        <div className="timeline">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 1rem' }}>
            <h3 style={{ color: '#fff', fontSize: '1.25rem' }}>Sequence Timeline</h3>
            <button 
              className="primary" 
              onClick={handleBatchDownloadAll}
              style={{ fontSize: '0.9rem', padding: '0.5rem 1.5rem' }}
            >
              Download All Scenes
            </button>
          </div>
          
          <div className="film-strip">
            {scenes.map((scene, index) => (
              <div key={scene.id} className="scene-card horizontal">
                <div className="scene-number">{index + 1}</div>
                
                <div className="scene-content">
                  <div className="scene-header">
                    <span className="keywords-badge">Keywords: {scene.keywords}</span>
                    <span className={`status-badge ${scene.status}`}>{scene.status}</span>
                  </div>
                  <div className="scene-text-preview">{scene.text}</div>
                  <div className="scene-timer-controls" style={{ marginTop: '0.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <label style={{ fontSize: '0.7rem', opacity: 0.7 }}>Start:</label>
                      <input 
                        type="number" 
                        value={scene.timeRange.start} 
                        onChange={(e) => updateSceneTime(scene.id, Number(e.target.value), scene.timeRange.end)}
                        style={{ width: '50px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '4px', padding: '2px 5px' }}
                      />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <label style={{ fontSize: '0.7rem', opacity: 0.7 }}>End:</label>
                      <input 
                        type="number" 
                        value={scene.timeRange.end} 
                        onChange={(e) => updateSceneTime(scene.id, scene.timeRange.start, Number(e.target.value))}
                        style={{ width: '50px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', borderRadius: '4px', padding: '2px 5px' }}
                      />
                    </div>
                  </div>
                </div>

                <div className="scene-media-area">
                  <div className="mini-results scrollable">
                    {scene.results.map((result) => (
                      <div 
                        key={result.id} 
                        className={`mini-thumb-container ${scene.selectedClip?.id === result.id ? 'active' : ''}`}
                        onClick={() => updateSceneClip(scene.id, result)}
                      >
                        <img src={result.thumbnail} className="mini-thumb" />
                        <div className="source-label">{result.source.split(' ')[0]}</div>
                      </div>
                    ))}
                    {scene.status === 'searching' && <div className="loader">Searching Videos...</div>}
                    {scene.status === 'idle' && scene.results.length === 0 && <div className="no-matches">No Videos Found</div>}
                  </div>
                </div>

                <div className="scene-final-action">
                  <button 
                    className="download-scene-btn"
                    disabled={!scene.selectedClip || isDownloading(`${scene.selectedClip.id}_clip`)}
                    onClick={() => {
                      if (scene.selectedClip) {
                        const sanitized = scene.text.substring(0, 15).replace(/[^a-z0-9]/gi, '_');
                        const customName = `Scene_${String(scene.id + 1).padStart(2, '0')}_${sanitized}`;
                        onDownloadScene(scene.selectedClip, scene.timeRange.start, scene.timeRange.end, customName);
                      }
                    }}
                  >
                    {isDownloading(`${scene.selectedClip?.id}_clip`) ? '...' : '↓'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
