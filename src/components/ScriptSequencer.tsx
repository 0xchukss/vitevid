'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { ResultItem } from '@/types';

type InputMode = 'script' | 'audio';
type MediaPreference = 'all' | 'image' | 'video';
type SceneStatus = 'queued' | 'searching' | 'matched' | 'empty' | 'error';

interface Scene {
  id: number;
  text: string;
  keywords: string;
  searchTerms: string[];
  visualConcept: string;
  selectionReason: string;
  aiPlanned: boolean;
  results: ResultItem[];
  selectedAsset: ResultItem | null;
  status: SceneStatus;
  narrationStart: number;
  narrationEnd: number;
  clipStart: number;
}

interface ScriptSequencerProps {
  onDownloadScene: (item: ResultItem, start: number, end: number, customName?: string) => Promise<void>;
  onDownloadAsset: (item: ResultItem, customName?: string) => Promise<void>;
  onRenderBlock: (
    scenes: Array<{ asset: ResultItem; duration: number; clipStart: number }>,
    blockIndex: number,
    blockSeconds: number,
  ) => Promise<string>;
  isDownloading: (id: string) => boolean;
}

interface PlannedScene {
  scene_number: number;
  scene_text: string;
  duration_seconds: number;
  visual_description: string;
  search_terms: string[];
}

const SCENE_SECONDS = 4;
const WORDS_PER_MINUTE = 150;
const TRANSCRIPTION_CHUNK_SECONDS = 45;
const TRANSCRIPTION_SAMPLE_RATE = 16000;
const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'almost', 'along', 'also', 'among', 'another',
  'because', 'before', 'being', 'between', 'could', 'every', 'first', 'from', 'have',
  'into', 'itself', 'just', 'like', 'more', 'most', 'only', 'other', 'over', 'people',
  'same', 'should', 'some', 'such', 'than', 'that', 'their', 'there', 'these', 'they',
  'this', 'those', 'through', 'under', 'until', 'very', 'voice', 'what', 'when', 'where',
  'which', 'while', 'with', 'would', 'your',
]);

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function parseRuntime(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parts = trimmed.split(':').map(Number);
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return undefined;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return undefined;
}

function extractKeywords(text: string) {
  const uniqueWords = Array.from(
    new Set(
      (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [])
        .filter((word) => !STOP_WORDS.has(word)),
    ),
  );
  return uniqueWords.slice(0, 4).join(' ') || 'historical life';
}

function createFallbackQueries(scene: Scene) {
  const visibleSubject = extractKeywords(scene.visualConcept || scene.text)
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
  const sceneSubject = extractKeywords(scene.text)
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
  return Array.from(new Set([
    `${visibleSubject}`,
    `${sceneSubject} retro`,
    `${sceneSubject} american`,
  ].filter((query) => query.trim())));
}

function buildScenes(text: string, durationSeconds?: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const estimatedDuration = durationSeconds && durationSeconds > 0
    ? durationSeconds
    : (words.length / WORDS_PER_MINUTE) * 60;
  const count = Math.max(1, Math.ceil(estimatedDuration / SCENE_SECONDS));

  return Array.from({ length: count }, (_, index) => {
    const startWord = Math.floor((index * words.length) / count);
    const endWord = Math.floor(((index + 1) * words.length) / count);
    const sceneText = words.slice(startWord, Math.max(startWord + 1, endWord)).join(' ');
    const narrationStart = index * SCENE_SECONDS;
    const narrationEnd = Math.min(estimatedDuration, narrationStart + SCENE_SECONDS);

    return {
      id: index,
      text: sceneText,
      keywords: extractKeywords(sceneText),
      searchTerms: [],
      visualConcept: '',
      selectionReason: '',
      aiPlanned: false,
      results: [],
      selectedAsset: null,
      status: 'queued' as SceneStatus,
      narrationStart,
      narrationEnd: Math.max(narrationStart + 0.1, narrationEnd),
      clipStart: 0,
    };
  });
}

function rankResults(
  results: ResultItem[],
  keywords: string,
  preference: MediaPreference,
) {
  const terms = keywords.toLowerCase().split(/\s+/).filter(Boolean);

  return results
    .filter((result) => preference === 'all' || result.type === preference)
    .sort((left, right) => {
    const score = (item: ResultItem) => {
      const title = `${item.title} ${item.description || ''}`.toLowerCase();
      let value = item.source === 'Pexels' || item.source === 'Pixabay' ? 4 : 0;
      value += terms.filter((term) => title.includes(term)).length * 3;
      if (preference !== 'all' && item.type === preference) value += 4;
      if (item.type === 'image') value += 1;
      return value;
    };

      return score(right) - score(left);
    });
}

function getAudioDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read voice-over duration.'));
    };
  });
}

function createWavBlob(samples: Int16Array, sampleRate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let index = 0; index < samples.length; index += 1) {
    view.setInt16(44 + index * 2, samples[index], true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

async function createTranscriptionChunks(file: File) {
  const context = new AudioContext();
  try {
    const source = await context.decodeAudioData(await file.arrayBuffer());
    const chunkCount = Math.max(1, Math.ceil(source.duration / TRANSCRIPTION_CHUNK_SECONDS));
    const chunks: Blob[] = [];

    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const startSecond = chunkIndex * TRANSCRIPTION_CHUNK_SECONDS;
      const endSecond = Math.min(source.duration, startSecond + TRANSCRIPTION_CHUNK_SECONDS);
      const outputLength = Math.ceil((endSecond - startSecond) * TRANSCRIPTION_SAMPLE_RATE);
      const samples = new Int16Array(outputLength);

      for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
        const sourceIndex = Math.min(
          source.length - 1,
          Math.floor((startSecond + outputIndex / TRANSCRIPTION_SAMPLE_RATE) * source.sampleRate),
        );
        let value = 0;
        for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
          value += source.getChannelData(channel)[sourceIndex] / source.numberOfChannels;
        }
        samples[outputIndex] = Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
      }

      chunks.push(createWavBlob(samples, TRANSCRIPTION_SAMPLE_RATE));
    }

    return chunks;
  } finally {
    await context.close();
  }
}

export default function ScriptSequencer({
  onDownloadScene,
  onDownloadAsset,
  onRenderBlock,
  isDownloading,
}: ScriptSequencerProps) {
  const [inputMode, setInputMode] = useState<InputMode>('script');
  const [script, setScript] = useState('');
  const [scriptRuntime, setScriptRuntime] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioDuration, setAudioDuration] = useState(0);
  const [mediaPreference, setMediaPreference] = useState<MediaPreference>('all');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionProgress, setTranscriptionProgress] = useState('');
  const [blockSeconds, setBlockSeconds] = useState<30 | 45>(30);
  const [renderingBlocks, setRenderingBlocks] = useState(new Set<number>());
  const [exportMessage, setExportMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  const matchedCount = useMemo(
    () => scenes.filter((scene) => scene.selectedAsset).length,
    [scenes],
  );
  const scenesPerBlock = Math.max(1, Math.floor(blockSeconds / SCENE_SECONDS));
  const blocks = useMemo(() => {
    const groupedScenes = [];
    for (let index = 0; index < scenes.length; index += scenesPerBlock) {
      const group = scenes.slice(index, index + scenesPerBlock);
      groupedScenes.push({
        id: groupedScenes.length,
        scenes: group,
        isReady: group.length > 0 && group.every((scene) => scene.selectedAsset),
      });
    }
    return groupedScenes;
  }, [scenes, scenesPerBlock]);

  const updateScene = (sceneId: number, update: Partial<Scene>) => {
    setScenes((current) => current.map((scene) => (
      scene.id === sceneId ? { ...scene, ...update } : scene
    )));
  };

  const searchForScene = async (scene: Scene, preference: MediaPreference) => {
    updateScene(scene.id, { status: 'searching' });

    try {
      const primaryQueries = Array.from(new Set(
        (scene.searchTerms.length > 0 ? scene.searchTerms : [scene.keywords])
          .filter(Boolean),
      ));
      const fetchResults = async (queries: string[]) => {
        const responses = await Promise.all(queries.map((query) => fetch(
          `/api/search?q=${encodeURIComponent(query)}&type=${preference}&providers=stock`,
        )));
        if (responses.some((response) => !response.ok)) throw new Error('Search failed');
        return Promise.all(responses.map((response) => response.json()));
      };
      let queries = primaryQueries;
      let payloads = await fetchResults(queries);
      if (payloads.every((payload) => (payload.results || []).length === 0)) {
        queries = createFallbackQueries(scene);
        payloads = await fetchResults(queries);
      }
      if (payloads.every((payload) => (payload.results || []).length === 0) && scene.aiPlanned) {
        const retryResponse = await fetch('/api/plan-storyboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scenes: [{
              text: scene.text,
              narrationStart: scene.narrationStart,
              narrationEnd: scene.narrationEnd,
            }],
            startSceneNumber: scene.id + 1,
            retryForNoResults: true,
            failedSearchTerms: [...primaryQueries, ...queries],
          }),
        });
        if (retryResponse.ok) {
          const replacementPlan = (await retryResponse.json()) as PlannedScene[];
          const replacement = replacementPlan[0];
          if (replacement?.search_terms?.length) {
            queries = replacement.search_terms;
            payloads = await fetchResults(queries);
            updateScene(scene.id, {
              keywords: replacement.search_terms[0],
              searchTerms: replacement.search_terms,
              visualConcept: replacement.visual_description,
            });
          }
        }
      }
      const uniqueResults = new Map<string, ResultItem>();
      payloads.flatMap((payload) => payload.results || []).forEach((result: ResultItem) => {
        uniqueResults.set(`${result.source}:${result.id}`, result);
      });
      const ranked = rankResults(
        Array.from(uniqueResults.values()),
        queries.join(' '),
        preference,
      ).slice(0, 8);
      let selectedAsset = ranked[0] || null;
      let selectionReason = '';

      if (ranked.length > 0) {
        const selectionResponse = await fetch('/api/select-storyboard-media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scene: {
              text: scene.text,
              visualConcept: scene.visualConcept,
              query: scene.keywords,
              preferredType: preference === 'all' ? null : preference,
            },
            candidates: ranked,
          }),
        });
        if (selectionResponse.ok) {
          const selection = await selectionResponse.json();
          selectedAsset = ranked.find((result) => result.id === selection.selectedId) || selectedAsset;
          selectionReason = selection.reason || '';
        }
      }

      updateScene(scene.id, {
        results: ranked,
        selectedAsset,
        selectionReason,
        status: ranked.length > 0 ? 'matched' : 'empty',
      });
    } catch (reason) {
      console.error(`Search failed for scene ${scene.id}:`, reason);
      updateScene(scene.id, { status: 'error', results: [], selectedAsset: null });
    }
  };

  const searchStoryboard = async (storyboard: Scene[], preference: MediaPreference) => {
    setIsSearching(true);
    let cursor = 0;

    const runSearchWorker = async () => {
      while (cursor < storyboard.length) {
        const nextScene = storyboard[cursor];
        cursor += 1;
        await searchForScene(nextScene, preference);
      }
    };

    try {
      const workerCount = Math.min(3, storyboard.length);
      await Promise.all(Array.from({ length: workerCount }, () => runSearchWorker()));
    } finally {
      setIsSearching(false);
    }
  };

  const planAndSearchStoryboard = async (storyboard: Scene[], preference: MediaPreference) => {
    setIsPlanning(true);
    setError('');

    try {
      const response = await fetch('/api/plan-storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenes: storyboard.map((scene) => ({
            id: scene.id,
            text: scene.text,
            narrationStart: scene.narrationStart,
            narrationEnd: scene.narrationEnd,
          })),
          mediaPreference: preference,
          startSceneNumber: storyboard[0].id + 1,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'AI scene planning failed.');

      const plans = new Map<number, PlannedScene>(
        (Array.isArray(data) ? data : []).map((scene: PlannedScene) => [scene.scene_number - 1, scene]),
      );
      const plannedStoryboard = storyboard.map((scene) => {
        const plan = plans.get(scene.id);
        if (!plan) return scene;
        return {
          ...scene,
          text: plan.scene_text,
          keywords: plan.search_terms[0],
          searchTerms: plan.search_terms,
          visualConcept: plan.visual_description,
          aiPlanned: true,
        };
      });

      setScenes((current) => current.map((scene) => (
        plannedStoryboard.find((planned) => planned.id === scene.id) || scene
      )));
      await searchStoryboard(plannedStoryboard, preference);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'AI scene planning failed.');
    } finally {
      setIsPlanning(false);
    }
  };

  const planAndSearchAllScenes = async () => {
    for (let index = 0; index < scenes.length; index += scenesPerBlock) {
      await planAndSearchStoryboard(scenes.slice(index, index + scenesPerBlock), mediaPreference);
    }
  };

  const createStoryboard = async (text: string, duration?: number) => {
    const storyboard = buildScenes(text, duration);
    if (storyboard.length === 0) {
      setError('Add narration text before generating a storyboard.');
      return;
    }

    setError('');
    setIsProcessing(true);
    setScenes(storyboard);
    setIsProcessing(false);
    await planAndSearchStoryboard(storyboard.slice(0, scenesPerBlock), mediaPreference);
  };

  const handleAudioChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;

    setError('');
    setAudioFile(file);
    setAudioUrl((currentUrl) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      return URL.createObjectURL(file);
    });

    try {
      setAudioDuration(await getAudioDuration(file));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not read voice-over duration.');
      setAudioDuration(0);
    }
  };

  const createFromVoiceOver = async () => {
    if (!audioFile) return;
    setError('');
    setIsTranscribing(true);

    try {
      const chunks = await createTranscriptionChunks(audioFile);
      const transcript: string[] = [];

      for (let index = 0; index < chunks.length; index += 1) {
        setTranscriptionProgress(`${index + 1}/${chunks.length}`);
        const body = new FormData();
        body.append('audio', chunks[index], `voice_over_${index + 1}.wav`);
        const response = await fetch('/api/transcribe', { method: 'POST', body });
        const data = await response.json();

        if (!response.ok) {
          setError(data.error || 'Voice-over transcription failed.');
          return;
        }

        transcript.push(data.text || '');
      }

      const fullTranscript = transcript.join(' ').trim();
      setScript(fullTranscript);
      await createStoryboard(fullTranscript, audioDuration);
    } catch (reason) {
      console.error('Voice-over transcription failed:', reason);
      setError('Voice-over transcription failed.');
    } finally {
      setIsTranscribing(false);
      setTranscriptionProgress('');
    }
  };

  const downloadScene = async (scene: Scene) => {
    if (!scene.selectedAsset) return;

    const sceneName = `Scene_${String(scene.id + 1).padStart(3, '0')}_${scene.keywords}`
      .replace(/[^a-z0-9_]+/gi, '_')
      .substring(0, 50);
    if (scene.selectedAsset.type === 'video') {
      const duration = scene.narrationEnd - scene.narrationStart;
      await onDownloadScene(
        scene.selectedAsset,
        scene.clipStart,
        scene.clipStart + Math.min(SCENE_SECONDS, duration),
        sceneName,
      );
    } else {
      await onDownloadAsset(scene.selectedAsset, sceneName);
    }
  };

  const downloadStoryboard = async () => {
    for (const scene of scenes) {
      if (scene.selectedAsset) await downloadScene(scene);
    }
  };

  const exportBlock = async (block: { id: number; scenes: Scene[]; isReady: boolean }) => {
    if (!block.isReady) return;
    setError('');
    setExportMessage('');
    setRenderingBlocks((current) => new Set(current).add(block.id));

    try {
      const renderScenes = block.scenes.map((scene) => ({
        asset: scene.selectedAsset as ResultItem,
        duration: scene.narrationEnd - scene.narrationStart,
        clipStart: scene.clipStart,
      }));
      const filename = await onRenderBlock(renderScenes, block.id, blockSeconds);
      setExportMessage(`${filename} ready`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Block export failed.');
    } finally {
      setRenderingBlocks((current) => {
        const next = new Set(current);
        next.delete(block.id);
        return next;
      });
    }
  };

  const exportAllBlocks = async () => {
    for (const block of blocks) {
      if (block.isReady) await exportBlock(block);
    }
  };

  return (
    <div className="storyboard">
      <div className="storyboard-input">
        <div className="storyboard-toolbar">
          <div className="segmented-control" aria-label="Input type">
            <button
              type="button"
              className={inputMode === 'script' ? 'active' : ''}
              onClick={() => setInputMode('script')}
            >
              Script
            </button>
            <button
              type="button"
              className={inputMode === 'audio' ? 'active' : ''}
              onClick={() => setInputMode('audio')}
            >
              Voice-over
            </button>
          </div>
          <label className="storyboard-select">
            <span>Media</span>
            <select
              value={mediaPreference}
              onChange={(event) => setMediaPreference(event.target.value as MediaPreference)}
            >
              <option value="all">Images + video</option>
              <option value="image">Images</option>
              <option value="video">Video</option>
            </select>
          </label>
          <span className="duration-chip">up to {SCENE_SECONDS}s scenes</span>
        </div>

        {inputMode === 'script' ? (
          <>
            <textarea
              className="script-textarea"
              placeholder="Paste full narration script"
              value={script}
              onChange={(event) => setScript(event.target.value)}
            />
            <label className="runtime-input">
              <span>Narration runtime</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="08:00"
                value={scriptRuntime}
                onChange={(event) => setScriptRuntime(event.target.value)}
              />
            </label>
          </>
        ) : (
          <div className="audio-input">
            <label className="audio-picker">
              <span>{audioFile ? audioFile.name : 'Choose voice-over audio'}</span>
              <input
                type="file"
                accept=".mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm,audio/*"
                onChange={handleAudioChange}
              />
            </label>
            {audioUrl && (
              <audio className="audio-preview" controls src={audioUrl}>
                <track kind="captions" />
              </audio>
            )}
          </div>
        )}

        {error && <div className="storyboard-error" role="alert">{error}</div>}
        {exportMessage && <div className="storyboard-success">{exportMessage}</div>}

        <div className="storyboard-actions">
          {scenes.length > 0 && (
            <button type="button" className="secondary-btn" onClick={() => setScenes([])}>
              Clear timeline
            </button>
          )}
          {inputMode === 'script' ? (
            <button
              type="button"
              className="primary"
              onClick={() => createStoryboard(script, parseRuntime(scriptRuntime))}
              disabled={isProcessing || isPlanning || isSearching || !script.trim()}
            >
              {isPlanning ? 'AI planning...' : isSearching ? 'Matching scenes...' : 'Build storyboard'}
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={createFromVoiceOver}
              disabled={isTranscribing || isPlanning || isSearching || !audioFile}
            >
              {isTranscribing
                ? `Transcribing ${transcriptionProgress}`
                : isPlanning ? 'AI planning...' : isSearching ? 'Matching scenes...' : 'Build from audio'}
            </button>
          )}
        </div>
      </div>

      {scenes.length > 0 && (
        <section className="storyboard-timeline">
          <header className="timeline-header">
            <div>
              <h2>Storyboard Timeline</h2>
              <span>{matchedCount} of {scenes.length} scenes matched</span>
            </div>
            <div className="timeline-actions">
              <button
                type="button"
                className="secondary-btn"
                disabled={isPlanning || isSearching}
                onClick={planAndSearchAllScenes}
              >
                AI match all scenes
              </button>
              <button
                type="button"
                className="primary"
                disabled={matchedCount === 0}
                onClick={downloadStoryboard}
              >
                Download scene files
              </button>
            </div>
          </header>

          <div className="scene-list">
            {scenes.map((scene) => {
              const downloadingId = scene.selectedAsset?.type === 'video'
                ? `${scene.selectedAsset.id}_clip`
                : scene.selectedAsset?.id || '';
              const sceneIsDownloading = Boolean(downloadingId && isDownloading(downloadingId));

              return (
                <article className="storyboard-scene" key={scene.id}>
                  <div className="scene-time">
                    <strong>{String(scene.id + 1).padStart(2, '0')}</strong>
                    <span>{formatTime(scene.narrationStart)}</span>
                    <span>{formatTime(scene.narrationEnd)}</span>
                  </div>
                  <div className="scene-copy">
                    <p>{scene.text}</p>
                    {scene.aiPlanned && (
                      <div className="scene-concept">
                        <strong>{scene.visualConcept}</strong>
                        <span>{scene.searchTerms.join(' | ')}</span>
                      </div>
                    )}
                    <div className="query-row">
                      <input
                        type="text"
                        aria-label={`Search phrase for scene ${scene.id + 1}`}
                        value={scene.keywords}
                        onChange={(event) => updateScene(scene.id, {
                          keywords: event.target.value,
                          searchTerms: [event.target.value],
                        })}
                      />
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => searchForScene(scene, mediaPreference)}
                      >
                        Search
                      </button>
                    </div>
                  </div>
                  <div className="scene-options">
                    <div className="scene-results">
                      {scene.results.map((result) => (
                        <button
                          type="button"
                          key={result.id}
                          className={`scene-option ${scene.selectedAsset?.id === result.id ? 'selected' : ''}`}
                        onClick={() => updateScene(scene.id, { selectedAsset: result })}
                          title={`${result.source}: ${result.title}`}
                        >
                          {/* Third-party archival thumbnails need their original remote sources here. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={result.thumbnail} alt="" />
                          <span className={`media-tag ${result.type}`}>{result.type}</span>
                        </button>
                      ))}
                      {scene.status === 'searching' && <div className="scene-state">Searching...</div>}
                      {scene.status === 'empty' && <div className="scene-state">No matches</div>}
                      {scene.status === 'error' && <div className="scene-state">Search failed</div>}
                    </div>
                    {scene.selectedAsset?.type === 'video' && (
                      <label className="clip-offset">
                        <span>Clip starts at</span>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={scene.clipStart}
                          onChange={(event) => updateScene(scene.id, {
                            clipStart: Math.max(0, Number(event.target.value) || 0),
                          })}
                        />
                        <span>sec</span>
                      </label>
                    )}
                    {scene.selectionReason && (
                      <span className="selection-reason">{scene.selectionReason}</span>
                    )}
                  </div>
                  <div className="scene-download">
                    <button
                      type="button"
                      className="primary"
                      disabled={!scene.selectedAsset || sceneIsDownloading}
                      onClick={() => downloadScene(scene)}
                    >
                      {sceneIsDownloading ? 'Saving...' : 'Download'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          <section className="export-panel">
            <header className="export-header">
              <div>
                <h2>Vertical Exports</h2>
              </div>
              <label className="storyboard-select">
                <span>Block size</span>
                <select
                  value={blockSeconds}
                  onChange={(event) => setBlockSeconds(Number(event.target.value) as 30 | 45)}
                >
                  <option value="30">30 seconds</option>
                  <option value="45">45 seconds</option>
                </select>
              </label>
              <button
                type="button"
                className="primary"
                disabled={blocks.every((block) => !block.isReady) || renderingBlocks.size > 0}
                onClick={exportAllBlocks}
              >
                Export ready blocks
              </button>
            </header>
            <div className="export-blocks">
              {blocks.map((block) => {
                const selectedCount = block.scenes.filter((scene) => scene.selectedAsset).length;
                const isRendering = renderingBlocks.has(block.id);
                return (
                  <div className="export-block" key={block.id}>
                    <div>
                      <strong>Block {String(block.id + 1).padStart(2, '0')}</strong>
                      <span>
                        {formatTime(block.scenes[0].narrationStart)} - {formatTime(block.scenes[block.scenes.length - 1].narrationEnd)}
                      </span>
                    </div>
                    <span>{selectedCount}/{block.scenes.length} selected</span>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={isPlanning || isSearching}
                      onClick={() => planAndSearchStoryboard(block.scenes, mediaPreference)}
                    >
                      AI Match
                    </button>
                    <button
                      type="button"
                      className="secondary-btn"
                      disabled={!block.isReady || isRendering}
                      onClick={() => exportBlock(block)}
                    >
                      {isRendering ? 'Rendering...' : 'Export MP4'}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </section>
      )}
    </div>
  );
}
