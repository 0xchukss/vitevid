'use client';

import { useState } from 'react';
import SearchBar from '@/components/SearchBar';
import ResultsGrid from '@/components/ResultsGrid';
import VideoPlayer from '@/components/VideoPlayer';

import { ResultItem } from '@/types';

import ScriptSequencer from '@/components/ScriptSequencer';

function getDownloadFilename(response: Response, fallback: string) {
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/i);
  return match?.[1] || fallback;
}

function fallbackFilename(item: ResultItem) {
  const cleanTitle = (item.title || 'download')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .substring(0, 50);
  return `${cleanTitle}${item.type === 'video' ? '.mp4' : '.jpg'}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

interface RenderScene {
  asset: ResultItem;
  duration: number;
  clipStart: number;
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'search' | 'script'>('search');
  const [results, setResults] = useState<ResultItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPlayerLoading, setIsPlayerLoading] = useState(false);
  const [downloadingItems, setDownloadingItems] = useState(new Set<string>());
  const [selectedIds, setSelectedIds] = useState(new Set<string>());
  const [downloadedPaths, setDownloadedPaths] = useState<Record<string, string>>({});
  const [activeVideo, setActiveVideo] = useState<ResultItem | null>(null);

  const handleSearch = async (query: string, type: string, era: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}&type=${type}&era=${era}`);
      const data = await response.json();
      setResults(data.results || []);
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleOpenPlayer = async (item: ResultItem) => {
    setIsPlayerLoading(true);
    try {
      if (item.source === 'Internet Archive') {
        const metaUrl = `https://archive.org/metadata/${item.id}`;
        const response = await fetch(metaUrl);
        const data = await response.json();
        const files = data.files || [];
        const mp4File = files.find((f: any) => f.name.endsWith('.mp4') && !f.name.includes('ia.mp4'));
        
        if (mp4File) {
          const videoUrl = `https://archive.org/download/${item.id}/${mp4File.name}`;
          setActiveVideo({ ...item, downloadUrl: videoUrl });
        } else {
          setActiveVideo(item);
        }
      } else {
        setActiveVideo(item);
      }
    } catch (error) {
      console.error('Failed to fetch video metadata:', error);
      setActiveVideo(item);
    } finally {
      setIsPlayerLoading(false);
    }
  };

  const handleDownload = async (item: ResultItem, customName?: string) => {
    setDownloadingItems((prev) => new Set(prev).add(item.id));
    try {
      const response = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [item], customName }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Download failed' }));
        alert(`Error: ${errorData.error || 'Download failed'}`);
        return;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        const blob = await response.blob();
        const filename = getDownloadFilename(
          response,
          customName ? `${customName}${item.type === 'video' ? '.mp4' : '.jpg'}` : fallbackFilename(item),
        );
        downloadBlob(blob, filename);
        setDownloadedPaths(prev => ({ ...prev, [item.id]: filename }));
        return;
      }

      const data = await response.json();
      const result = data.results[0];
      
      if (result.status === 'success') {
        setDownloadedPaths(prev => ({ ...prev, [item.id]: result.path }));
      } else {
        alert(`Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setDownloadingItems((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const triggerClip = async (item: ResultItem, start: number, end: number, customName?: string) => {
    setDownloadingItems((prev) => new Set(prev).add(`${item.id}_clip`));
    try {
      const response = await fetch('/api/clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item, start, end, customName }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Clipping failed' }));
        alert(`Clipping Error: ${errorData.error}${errorData.path ? `\nPath: ${errorData.path}` : ''}`);
        return;
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('video/mp4')) {
        const blob = await response.blob();
        const filename = getDownloadFilename(response, `${customName || item.title || 'clip'}.mp4`);
        downloadBlob(blob, filename);
        alert(`Clip downloaded: ${filename}`);
        return;
      }

      const data = await response.json();
      
      if (data.status === 'success') {
        alert(`Clip saved: ${data.filename}`);
        setDownloadedPaths(prev => ({ ...prev, [item.id]: data.path }));
      } else {
        alert(`Clipping Error: ${data.error}\nPath: ${data.path}`);
      }
    } catch (error) {
      console.error('Clipping failed:', error);
    } finally {
      setDownloadingItems((prev) => {
        const next = new Set(prev);
        next.delete(`${item.id}_clip`);
        return next;
      });
    }
  };

  const renderBlock = async (scenes: RenderScene[], blockIndex: number, blockSeconds: number) => {
    const response = await fetch('/api/render-block', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenes, blockIndex, blockSeconds }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Block export failed' }));
      throw new Error(errorData.error || 'Block export failed');
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('video/mp4')) {
      const blob = await response.blob();
      const filename = getDownloadFilename(response, `Storyboard_Block_${String(blockIndex + 1).padStart(3, '0')}.mp4`);
      downloadBlob(blob, filename);
      return filename;
    }

    const data = await response.json();
    return data.path || data.filename || `Block ${blockIndex + 1}`;
  };

  const handleBatchDownload = async () => {
    const itemsToDownload = results.filter((item) => selectedIds.has(item.id));
    if (itemsToDownload.length === 0) return;

    try {      
      for (const item of itemsToDownload) {
        await handleDownload(item);
      }
      setSelectedIds(new Set());
      alert(`Batch download started for ${itemsToDownload.length} item(s).`);
    } catch (error) {
      console.error('Batch download failed:', error);
    }
  };

  return (
    <main>
      <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1>Vintage Media Scraper</h1>
          <p style={{ color: 'var(--text-muted)' }}>
            High-speed public domain asset finder for YouTube automation.
          </p>
        </div>
        
        <nav className="tab-nav">
          <button 
            className={`tab-btn ${activeTab === 'search' ? 'active' : ''}`}
            onClick={() => setActiveTab('search')}
          >
            Manual Search
          </button>
          <button 
            className={`tab-btn ${activeTab === 'script' ? 'active' : ''}`}
            onClick={() => setActiveTab('script')}
          >
            Auto Storyboard
          </button>
        </nav>
      </header>

      {activeTab === 'search' ? (
        <>
          <SearchBar onSearch={handleSearch} isLoading={isLoading} />

          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '600' }}>
                {results.length > 0 ? `Showing ${results.length} results` : 'Recent Assets'}
              </h2>
              {selectedIds.size > 0 && (
                <button 
                  className="primary" 
                  style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
                  onClick={handleBatchDownload}
                >
                  Batch Download ({selectedIds.size})
                </button>
              )}
            </div>
            
            <ResultsGrid 
              results={results} 
              onDownload={handleDownload} 
              selectedIds={selectedIds}
              onSelect={toggleSelect}
              onOpenPlayer={handleOpenPlayer}
              downloadedPaths={downloadedPaths}
            />
          </section>
        </>
      ) : (
        <ScriptSequencer 
          onDownloadScene={triggerClip}
          onDownloadAsset={handleDownload}
          onRenderBlock={renderBlock}
          isDownloading={(id) => downloadingItems.has(id)}
        />
      )}

      {isPlayerLoading && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'var(--glass)',
          padding: '2rem',
          borderRadius: '1rem',
          zIndex: 2000,
          border: '1px solid var(--primary)',
          color: 'var(--primary)',
          fontWeight: 'bold',
          backdropFilter: 'blur(10px)',
        }}>
          Loading Video Player...
        </div>
      )}

      {activeVideo && (
        <VideoPlayer 
          item={activeVideo} 
          onClose={() => setActiveVideo(null)} 
          onClip={(start, end) => {
            triggerClip(activeVideo, start, end);
            setActiveVideo(null);
          }}
        />
      )}

      {downloadingItems.size > 0 && (
        <div style={{
          position: 'fixed',
          bottom: '2rem',
          right: '2rem',
          background: 'var(--primary)',
          color: '#000',
          padding: '1rem 2rem',
          borderRadius: '0.5rem',
          fontWeight: '700',
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
          zIndex: 100,
        }}>
          Downloading {downloadingItems.size} item(s)...
        </div>
      )}
    </main>
  );
}
