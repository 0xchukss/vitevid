'use client';

import {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ResultItem } from '@/types';
import { AutomatedClip, AutomatedVideoProps } from '@/remotion/automated-edit';
import type { StoryboardVoiceOver } from '@/components/ScriptSequencer';
import { isVisuallyUnsafeForScene } from '@/lib/mediaSafety';

type Transition = 'none' | 'fade' | 'slideleft' | 'slidedown' | 'screenburn' | 'glitch';
type AssetPanel = 'media' | 'audio' | 'text' | 'effects' | 'transitions' | 'canvas';
type CanvasRatio = '16:9' | '9:16' | '1:1' | '4:3' | 'custom';

const HISTORY_REFERENCE_RESET_SECONDS = 2.7;

const TIMELINE_ICONS = {
  undo: '\u21B6',
  redo: '\u21B7',
  split: '\u2702',
  left: '\u2190',
  right: '\u2192',
  duplicate: '\u2398',
  delete: '\u232B',
  snap: '\uD83E\uDDF2',
  mark: '\u25C6',
};

const SOUND_EFFECT_LIBRARY = [
  {
    id: 'keyboard-typing',
    label: 'Keyboard typing',
    src: '/sound-effects/keyboard-typing.mp3',
    description: 'Rhythmic typing for tech, writing, data entry, documents, and research scenes.',
  },
  {
    id: 'whoosh',
    label: 'Whoosh',
    src: '/sound-effects/whoosh.mp3',
    description: 'Quick whoosh for fast visual transitions, reveals, and motion changes.',
  },
  {
    id: 'pop-up',
    label: 'Pop up',
    src: '/sound-effects/pop-up.mp3',
    description: 'Short pop accent for text, icons, facts, and small visual reveals.',
  },
  {
    id: 'mouse-click',
    label: 'Mouse click',
    src: '/sound-effects/mouse-click.mp3',
    description: 'Single click for UI, selection, online action, and tech tool scenes.',
  },
  {
    id: 'cinematic-hit',
    label: 'Cinematic hit',
    src: '/sound-effects/cinematic-hit.mp3',
    description: 'Low cinematic impact for list transitions, chapter turns, and dramatic reveals.',
  },
  {
    id: 'clock-ticking',
    label: 'Clock ticking',
    src: '/sound-effects/clock-ticking.mp3',
    description: 'Clock ticking for suspense, deadlines, waiting, investigation, and time pressure.',
  },
] as const;

const TRUE_CRIME_SOUND_EFFECT_LIBRARY = [
  {
    id: 'tc-horror-impact',
    label: 'Horror impact',
    src: '/sound-effects/true-crime/mixkit-horror-impact-773.wav',
    description: 'Sharp horror hit for reveals, bodies of evidence, and chapter turns.',
  },
  {
    id: 'tc-hard-horror-hit',
    label: 'Hard horror hit',
    src: '/sound-effects/true-crime/mixkit-hard-horror-hit-drum-565.wav',
    description: 'Heavy drum hit for major true-crime shocks.',
  },
  {
    id: 'tc-terror-transition',
    label: 'Terror transition',
    src: '/sound-effects/true-crime/mixkit-terror-transition-2484.wav',
    description: 'Dark transition sweep for scene changes and cold reveals.',
  },
  {
    id: 'tc-terror-sweep',
    label: 'Terror sweep',
    src: '/sound-effects/true-crime/mixkit-terror-sweep-of-darkness-2630.wav',
    description: 'Longer sweep for suspense builds and ominous turns.',
  },
  {
    id: 'tc-horror-swish',
    label: 'Horror swish',
    src: '/sound-effects/true-crime/mixkit-horror-swish-1495.wav',
    description: 'Quick scary swish for captions, jump cuts, and evidence flashes.',
  },
  {
    id: 'tc-heartbeat-transition',
    label: 'Horror heartbeat transition',
    src: '/sound-effects/true-crime/mixkit-cinematic-horror-heartbeat-transition-489.wav',
    description: 'Heartbeat transition for danger, pursuit, and tension spikes.',
  },
  {
    id: 'tc-deep-drum-heartbeat',
    label: 'Deep drum heartbeat',
    src: '/sound-effects/true-crime/mixkit-horror-deep-drum-heartbeat-559.wav',
    description: 'Low heartbeat pulse for fear, suspicion, and unanswered questions.',
  },
  {
    id: 'tc-radio-frequency',
    label: 'Terror radio frequency',
    src: '/sound-effects/true-crime/mixkit-terror-radio-frequency-2566.wav',
    description: 'Police-radio style static for investigations, evidence, and case files.',
  },
  {
    id: 'tc-horror-ambience',
    label: 'Horror ambience',
    src: '/sound-effects/true-crime/mixkit-horror-ambience-2482.wav',
    description: 'Long dark ambience for quiet scary passages.',
  },
  {
    id: 'tc-scary-wind',
    label: 'Scary wind',
    src: '/sound-effects/true-crime/mixkit-scary-wind-1162.wav',
    description: 'Cold wind texture for night, isolated locations, and dread.',
  },
  {
    id: 'tc-graveyard-wind',
    label: 'Graveyard wind',
    src: '/sound-effects/true-crime/mixkit-scary-graveyard-wind-1157.wav',
    description: 'Short wind bed for graveyard, abandoned, and eerie outdoor moments.',
  },
  {
    id: 'tc-trailer-long-sweep',
    label: 'Horror trailer sweep',
    src: '/sound-effects/true-crime/mixkit-cinematic-horror-trailer-long-sweep-561.wav',
    description: 'Trailer-style sweep for dramatic evidence reveals.',
  },
  {
    id: 'tc-boot-stomp-mud',
    label: 'Boot stomp on mud',
    src: '/sound-effects/true-crime/mixkit-boot-stomp-on-mud-surface-3058.wav',
    description: 'Footstep impact for searches, crime scenes, and outdoor trails.',
  },
  {
    id: 'tc-blood-splash',
    label: 'Blood splash',
    src: '/sound-effects/true-crime/mixkit-gore-video-game-blood-splash-263.wav',
    description: 'Graphic splash accent for violent case details; use sparingly.',
  },
  {
    id: 'tc-zombie-gasp',
    label: 'Gasping zombie',
    src: '/sound-effects/true-crime/mixkit-gasping-zombie-963.wav',
    description: 'Fright gasp for horror-style danger moments.',
  },
  {
    id: 'tc-zombie-growl',
    label: 'Monster growl',
    src: '/sound-effects/true-crime/mixkit-zombie-monster-growl-1973.wav',
    description: 'Dark growl texture for nightmare or fear imagery.',
  },
  {
    id: 'tc-wolf-howling',
    label: 'Wolf howling',
    src: '/sound-effects/true-crime/mixkit-wolf-howling-1775.wav',
    description: 'Lonely night howl for remote outdoor scenes.',
  },
  {
    id: 'tc-wolves-pack-howling',
    label: 'Wolves pack howling',
    src: '/sound-effects/true-crime/mixkit-wolves-pack-howling-1776.wav',
    description: 'Pack howls for forest, night, and isolated locations.',
  },
  {
    id: 'tc-wolves-scary-forest',
    label: 'Wolves scary forest',
    src: '/sound-effects/true-crime/mixkit-wolves-at-scary-forest-2485.wav',
    description: 'Forest night texture for missing-person or remote-location scenes.',
  },
] as const;

const HISTORY_VINTAGE_SOUND_EFFECT_LIBRARY = [
  {
    id: 'history-typewriter',
    label: 'Vintage typewriter',
    src: '/sound-effects/history-vintage/freesound_community-typewriter-typing-68696.mp3',
    description: 'Use for every numbered list callout, document title, typed record, or archival note. Always prefer this for history numbering.',
  },
  {
    id: 'history-projector-start',
    label: '35mm projector start',
    src: '/sound-effects/history-vintage/freesound_community-35mm-film-projector-start-99740.mp3',
    description: 'Archival film-start texture for openings, flashbacks, and vintage footage reveals.',
  },
  {
    id: 'history-small-projector',
    label: 'Small film projector',
    src: '/sound-effects/history-vintage/freesound_community-small-film-projector-26188.mp3',
    description: 'Subtle projector bed for old footage, historic reels, and period montage moments.',
  },
  {
    id: 'history-paper-rip-fast',
    label: 'Fast paper rip',
    src: '/sound-effects/history-vintage/tanweraman-paper-rip-fast-252617.mp3',
    description: 'Fast paper tear for newspaper reveals, documents, bills, debts, letters, and records.',
  },
  {
    id: 'history-paper-cut',
    label: 'Paper cut',
    src: '/sound-effects/history-vintage/audiopapkin-cutting-paper-303736.mp3',
    description: 'Paper-cut accent for documents, newspaper clippings, ledgers, lists, and archive pages.',
  },
  {
    id: 'history-paper-tear',
    label: 'Paper tearing',
    src: '/sound-effects/history-vintage/54789481-paper-paper-tearing-tear-paper-hartie-rupta-494202.mp3',
    description: 'Rough paper tear for dramatic documents, contracts, letters, and historical records.',
  },
  {
    id: 'history-paper-crumple',
    label: 'Paper crumple',
    src: '/sound-effects/history-vintage/liecio-crumping-paper-109585.mp3',
    description: 'Crumpled paper accent for personal notes, hardship, scraps, budgets, and archive handling.',
  },
  {
    id: 'history-camera-shutter-flash',
    label: 'Camera shutter flash',
    src: '/sound-effects/history-vintage/freesound_community-camera-shutter-and-flash-combined-6827.mp3',
    description: 'Photo-flash hit for person reveals, old portraits, evidence photos, and historic snapshots.',
  },
  {
    id: 'history-camera-shutter-effect',
    label: 'Camera shutter effect',
    src: '/sound-effects/history-vintage/dragon-studio-camera-shutter-effect-390310.mp3',
    description: 'Clean shutter for photo changes, biographical reveals, and archival image cuts.',
  },
  {
    id: 'history-camera-shutter',
    label: 'Camera shutter',
    src: '/sound-effects/history-vintage/voicebosch-camera-shutter-187326.mp3',
    description: 'Short shutter for portraits, proof, discoveries, and newspaper-photo moments.',
  },
  {
    id: 'history-camera-shutter-clean',
    label: 'Clean camera shutter',
    src: '/sound-effects/history-vintage/alexis_gaming_cam-camera-shutter-346101.mp3',
    description: 'Lighter shutter for repeated image reveals without overpowering the voiceover.',
  },
  {
    id: 'history-tape-rewind',
    label: 'Tape rewind',
    src: '/sound-effects/history-vintage/mixkit-tape-rewind-cinematic-transition-1088.wav',
    description: 'Time jump or flashback accent for years, decades, then-vs-now beats, and historical reversals.',
  },
  {
    id: 'history-short-sweep',
    label: 'Short transition sweep',
    src: '/sound-effects/history-vintage/mixkit-short-transition-sweep-175.wav',
    description: 'Short sweep for years, statistics, quick scene changes, and punctuation beats.',
  },
  {
    id: 'history-fast-whoosh',
    label: 'Fast whoosh',
    src: '/sound-effects/history-vintage/mixkit-fast-whoosh-transition-1490.wav',
    description: 'Fast whoosh for bold overlays, percentage callouts, and energetic history pacing.',
  },
  {
    id: 'history-cinematic-whoosh',
    label: 'Cinematic whoosh',
    src: '/sound-effects/history-vintage/mixkit-cinematic-whoosh-fast-transition-1492.wav',
    description: 'Cinematic whoosh for visual resets, scene changes, and dramatic archive reveals.',
  },
  {
    id: 'history-fast-sweep',
    label: 'Fast sweep',
    src: '/sound-effects/history-vintage/mixkit-fast-small-sweep-transition-166.wav',
    description: 'Small sweep for rapid but clean text and image transitions.',
  },
  {
    id: 'history-transition-swoosh',
    label: 'Transition swoosh',
    src: '/sound-effects/history-vintage/mixkit-fast-transitions-swoosh-3115.wav',
    description: 'General transition swoosh for cutaways, lists, and visual momentum.',
  },
  {
    id: 'history-vacuum-swoosh',
    label: 'Vacuum swoosh',
    src: '/sound-effects/history-vintage/mixkit-vacuum-swoosh-transition-1465.wav',
    description: 'Deeper swoosh for bigger shifts, reversals, or chapter movement.',
  },
  {
    id: 'history-rocket-whoosh',
    label: 'Rocket whoosh',
    src: '/sound-effects/history-vintage/mixkit-fast-rocket-whoosh-1714.wav',
    description: 'High-energy whoosh for fast timelines, countdowns, and dramatic movement.',
  },
  {
    id: 'history-heartbeat-swoosh',
    label: 'Heartbeat swoosh',
    src: '/sound-effects/history-vintage/mixkit-cinematic-transition-swoosh-heartbeat-trailer-488.wav',
    description: 'Tension sweep for economic collapse, danger, panics, or high-stakes transitions.',
  },
  {
    id: 'history-tunnel-woosh',
    label: 'Tunnel woosh',
    src: '/sound-effects/history-vintage/mixkit-cinematic-tunnel-reverb-woosh-1486.wav',
    description: 'Reverb transition for mysterious historical turns and deep timeline shifts.',
  },
  {
    id: 'history-deep-impact',
    label: 'Deep whoosh impact',
    src: '/sound-effects/history-vintage/mixkit-cinematic-whoosh-deep-impact-1143.mp3',
    description: 'Deep impact for major historical stakes, collapse, discovery, or decisive turning points.',
  },
  {
    id: 'history-cool-impact',
    label: 'Movie trailer impact',
    src: '/sound-effects/history-vintage/mixkit-cool-impact-movie-trailer-2909.wav',
    description: 'Trailer-style impact for chapter turns and major reveals. Keep it under the voiceover.',
  },
  {
    id: 'history-big-impact',
    label: 'Big cinematic impact',
    src: '/sound-effects/history-vintage/mixkit-big-cinematic-impact-788.mp3',
    description: 'Large impact for only the most important historical moments or final reveals.',
  },
  {
    id: 'history-metal-impact',
    label: 'Metal explosion impact',
    src: '/sound-effects/history-vintage/mixkit-dramatic-metal-explosion-impact-1687.wav',
    description: 'Heavy impact for war, disaster, industrial collapse, or dramatic historical consequences.',
  },
  {
    id: 'history-stomp-impact',
    label: 'Apocalyptic stomp impact',
    src: '/sound-effects/history-vintage/mixkit-apocalyptic-stomp-impact-3057.wav',
    description: 'Low stomp for collapse, crisis, market panic, dust bowl hardship, or major list transitions.',
  },
  {
    id: 'history-orchestra-transition',
    label: 'Epic orchestra transition',
    src: '/sound-effects/history-vintage/mixkit-epic-orchestra-transition-2290.wav',
    description: 'Orchestral transition for patriotic, epic, or major historical chapter changes.',
  },
  {
    id: 'history-trailer-riser',
    label: 'Trailer riser',
    src: '/sound-effects/history-vintage/mixkit-cinematic-trailer-riser-790.wav',
    description: 'Short riser for building into a reveal, statistic, or next numbered point.',
  },
  {
    id: 'history-riser-helicopter',
    label: 'Cinematic riser',
    src: '/sound-effects/history-vintage/mixkit-cinematic-riser-helicopter-engine-2719.wav',
    description: 'Rising tension for war, machines, industry, crowds, and movement across time.',
  },
  {
    id: 'history-mystery-heartbeat',
    label: 'Mystery heartbeat',
    src: '/sound-effects/history-vintage/mixkit-cinematic-mystery-heartbeat-transition-492.wav',
    description: 'Mystery pulse for strange events, unanswered questions, and ominous history moments.',
  },
  {
    id: 'history-glass-hit',
    label: 'Glass suspense hit',
    src: '/sound-effects/history-vintage/mixkit-cinematic-glass-hit-suspense-677.wav',
    description: 'Suspense hit for fragile facts, sudden reversals, and shocking statistics.',
  },
  {
    id: 'history-thunder-hit',
    label: 'Thunder hit',
    src: '/sound-effects/history-vintage/mixkit-cinematic-laser-gun-thunder-1287.wav',
    description: 'Thunder-like hit for dramatic historical breaks, danger, or violent turns.',
  },
  {
    id: 'history-long-dark-sweep',
    label: 'Long dark sweep',
    src: '/sound-effects/history-vintage/mixkit-cinematic-horror-trailer-long-sweep-561 (1).wav',
    description: 'Dark long sweep for mystery-heavy history only; avoid overusing it in normal documentary scenes.',
  },
  {
    id: 'history-sci-fi-sweep',
    label: 'Fast transition sweep',
    src: '/sound-effects/history-vintage/mixkit-fast-sci-fi-transition-sweep-3114.wav',
    description: 'Fast sweep for graphical transitions, statistics, and energetic timelines.',
  },
  {
    id: 'history-technology-slide',
    label: 'Technology slide',
    src: '/sound-effects/history-vintage/mixkit-technology-transition-slide-3120.wav',
    description: 'Slide transition for charts, maps, data, newspaper columns, and modernized visual moves.',
  },
  {
    id: 'history-sparkle-whoosh',
    label: 'Sparkle whoosh',
    src: '/sound-effects/history-vintage/mixkit-magic-sparkle-whoosh-2350.wav',
    description: 'Light reveal for discoveries, inventions, wins, or hopeful historic turns.',
  },
] as const;

const NUMBERING_BLOCKED_EFFECT_FILENAMES = new Set(['mouse-click.mp3', 'cinematic-hit.mp3']);

interface BackgroundMusicAsset {
  id: string;
  label: string;
  src: string;
  description: string;
}

const HISTORY_VINTAGE_BACKGROUND_MUSIC: BackgroundMusicAsset[] = [
  {
    id: 'history-hitslab-documentary',
    label: 'History Historical Documentary',
    src: '/background-music/history-vintage/hitslab-history-historical-documentary-music-334820.mp3',
    description: 'Default American-history documentary bed for narration and archival visuals.',
  },
  {
    id: 'history-starostin-documentary',
    label: 'Documentary History',
    src: '/background-music/history-vintage/starostin-documentary-history-historical-documentary-music-261144.mp3',
    description: 'Steady historical documentary bed for serious exposition.',
  },
  {
    id: 'history-sigma-documentary',
    label: 'Documentary Background',
    src: '/background-music/history-vintage/sigmamusicart-documentary-background-music-462075.mp3',
    description: 'Neutral documentary music for voice-led scenes and timelines.',
  },
  {
    id: 'history-monume-documentary',
    label: 'Historical Documentary',
    src: '/background-music/history-vintage/monume-historical-documentary-498028.mp3',
    description: 'Softer emotional history bed for family, hardship, and human moments.',
  },
  {
    id: 'history-vastness',
    label: 'Vastness',
    src: '/background-music/history-vintage/mixkit-vastness-184.mp3',
    description: 'Wide cinematic atmosphere for scale, migration, cities, and landscapes.',
  },
  {
    id: 'history-epical-drums',
    label: 'Epical Drums',
    src: '/background-music/history-vintage/mixkit-epical-drums-01-676.mp3',
    description: 'Bigger stakes bed for wars, collapses, discoveries, and major turns.',
  },
  {
    id: 'history-echoes',
    label: 'Echoes',
    src: '/background-music/history-vintage/mixkit-echoes-188 (1).mp3',
    description: 'Mystery-leaning history atmosphere for unresolved or strange events.',
  },
  {
    id: 'history-silent-descent',
    label: 'Silent Descent',
    src: '/background-music/history-vintage/mixkit-silent-descent-614.mp3',
    description: 'Dark but restrained documentary tension for economic collapse and danger.',
  },
  {
    id: 'history-piano-horror',
    label: 'Piano Horror',
    src: '/background-music/history-vintage/mixkit-piano-horror-671 (1).mp3',
    description: 'Use sparingly for disturbing historical reveals, not normal history pacing.',
  },
  {
    id: 'history-fright-night',
    label: 'Fright Night',
    src: '/background-music/history-vintage/mixkit-fright-night-871.mp3',
    description: 'Darkest optional bed for mystery-heavy history episodes.',
  },
];

const TRUE_CRIME_BACKGROUND_MUSIC: BackgroundMusicAsset[] = [
  {
    id: 'selpan',
    label: 'Selpan',
    src: '/background-music/true-crime/mixkit-selpan-612.mp3',
    description: 'Cold investigation bed for true crime narration.',
  },
  {
    id: 'eerie-ambient-texture',
    label: 'Eerie Ambient Texture',
    src: '/background-music/true-crime/megalix-eerie-ambient-texture-for-true-crime-360771.mp3',
    description: 'Sparse true-crime atmosphere for narration-heavy scenes.',
  },
  {
    id: 'dark-suspense-thriller',
    label: 'Dark Suspense Thriller',
    src: '/background-music/true-crime/alex-morgan-dark-suspense-thriller-528314 (2).mp3',
    description: 'Darker thriller bed for scary reveals and tension builds.',
  },
  {
    id: 'torn-threads',
    label: 'Torn Threads',
    src: '/background-music/true-crime/mixkit-torn-threads-73.mp3',
    description: 'Tense documentary pulse for case reveals.',
  },
  {
    id: 'piano-horror',
    label: 'Piano Horror',
    src: '/background-music/true-crime/mixkit-piano-horror-671.mp3',
    description: 'Dark piano tension for frightening moments.',
  },
  {
    id: 'echoes',
    label: 'Echoes',
    src: '/background-music/true-crime/mixkit-echoes-188.mp3',
    description: 'Slow eerie atmosphere for unresolved mystery.',
  },
  {
    id: 'cyberpunk-city',
    label: 'Cyberpunk City',
    src: '/background-music/true-crime/mixkit-cyberpunk-city-140.mp3',
    description: 'Modern urban tension for digital crime stories.',
  },
  {
    id: 'epic-games',
    label: 'Epic Games',
    src: '/background-music/true-crime/mixkit-epic-games-76.mp3',
    description: 'Bigger dramatic stakes for major turns.',
  },
] as const;

function getAutoBackgroundMusicLibrary(niche: string) {
  const key = niche.toLowerCase();
  if (key.includes('true crime')) {
    return [
      TRUE_CRIME_BACKGROUND_MUSIC[1],
      TRUE_CRIME_BACKGROUND_MUSIC[0],
      TRUE_CRIME_BACKGROUND_MUSIC[2],
      TRUE_CRIME_BACKGROUND_MUSIC[3],
      TRUE_CRIME_BACKGROUND_MUSIC[5],
      TRUE_CRIME_BACKGROUND_MUSIC[4],
      TRUE_CRIME_BACKGROUND_MUSIC[6],
      TRUE_CRIME_BACKGROUND_MUSIC[7],
    ].filter(Boolean);
  }
  if (key.includes('history')) {
    return [
      HISTORY_VINTAGE_BACKGROUND_MUSIC[0],
      HISTORY_VINTAGE_BACKGROUND_MUSIC[2],
      HISTORY_VINTAGE_BACKGROUND_MUSIC[3],
      HISTORY_VINTAGE_BACKGROUND_MUSIC[1],
      HISTORY_VINTAGE_BACKGROUND_MUSIC[4],
      HISTORY_VINTAGE_BACKGROUND_MUSIC[5],
      HISTORY_VINTAGE_BACKGROUND_MUSIC[6],
      HISTORY_VINTAGE_BACKGROUND_MUSIC[7],
      HISTORY_VINTAGE_BACKGROUND_MUSIC[8],
      HISTORY_VINTAGE_BACKGROUND_MUSIC[9],
    ].filter(Boolean);
  }
  if (key.includes('motivat')) {
    return [
      HISTORY_VINTAGE_BACKGROUND_MUSIC[4],
      HISTORY_VINTAGE_BACKGROUND_MUSIC[5],
      HISTORY_VINTAGE_BACKGROUND_MUSIC[2],
      HISTORY_VINTAGE_BACKGROUND_MUSIC[0],
    ].filter(Boolean);
  }
  if (key.includes('finance') || key.includes('invest') || key.includes('self')) {
    return [
      HISTORY_VINTAGE_BACKGROUND_MUSIC[2],
      HISTORY_VINTAGE_BACKGROUND_MUSIC[0],
      HISTORY_VINTAGE_BACKGROUND_MUSIC[4],
      HISTORY_VINTAGE_BACKGROUND_MUSIC[1],
    ].filter(Boolean);
  }
  return HISTORY_VINTAGE_BACKGROUND_MUSIC.slice(0, 4);
}

function autoMusicVolumeForNiche(niche: string) {
  const key = niche.toLowerCase();
  if (key.includes('true crime')) return 18;
  if (key.includes('history')) return 20;
  return 16;
}

function isKeyboardTypingEffectFile(file: File) {
  const name = file.name.toLowerCase();
  return name.includes('keyboard-typing') || name.includes('typewriter');
}

function isBlockedNumberingEffectFile(file: File) {
  return NUMBERING_BLOCKED_EFFECT_FILENAMES.has(file.name.toLowerCase());
}

function isTrueCrimeNiche(niche: string) {
  return niche.toLowerCase().includes('true crime');
}

const CANVAS_PRESETS: Array<{ ratio: Exclude<CanvasRatio, 'custom'>; width: number; height: number }> = [
  { ratio: '16:9', width: 1280, height: 720 },
  { ratio: '9:16', width: 720, height: 1280 },
  { ratio: '1:1', width: 1080, height: 1080 },
  { ratio: '4:3', width: 1280, height: 960 },
];
const CLAUDE_EDIT_BATCH_SIZE = 12;

export interface VideoLabSourceScene {
  id: number;
  text: string;
  asset: ResultItem;
  alternatives: ResultItem[];
  duration: number;
  narrationStart?: number;
  narrationEnd?: number;
  clipStart: number;
}

interface VideoLabProps {
  initialScenes: VideoLabSourceScene[];
  niche: string;
  editingInstructions: string;
  initialVoiceOver: StoryboardVoiceOver | null;
  onClose: () => void;
}

interface EditorClip {
  clipId: string;
  sceneId: number;
  text: string;
  asset: ResultItem;
  alternatives: ResultItem[];
  duration: number;
  sourceStart: number;
  scale: number;
  positionX: number;
  positionY: number;
  rotation: number;
  opacity: number;
  brightness: number;
  contrast: number;
  saturation: number;
  sepia: number;
  blur: number;
  hidden?: boolean;
  keyframes: TransformKeyframe[];
  transition: Transition;
}

interface TransformKeyframe {
  id: string;
  time: number;
  scale: number;
  positionX: number;
  positionY: number;
  rotation: number;
}

interface EditorAudio {
  id?: string;
  file: File;
  duration: number;
  sourceDuration?: number;
  sourceStart: number;
  timelineStart: number;
  volume: number;
  label?: string;
  loop?: boolean;
}

interface TextOverlay {
  id: string;
  text: string;
  timelineStart: number;
  duration: number;
  fontSize: number;
  color: string;
  backgroundColor: string;
  positionX: number;
  positionY: number;
}

interface TimelineSoundEffect {
  id: string;
  file: File;
  duration: number;
  sourceStart: number;
  timelineStart: number;
  volume: number;
}

interface ProjectSnapshot {
  clips: EditorClip[];
  audioTrack: EditorAudio | null;
  musicTrack: EditorAudio | null;
  musicTracks: EditorAudio[];
  textOverlays: TextOverlay[];
  soundEffects: TimelineSoundEffect[];
  canvasColor: string;
  canvasRatio: CanvasRatio;
  canvasWidth: number;
  canvasHeight: number;
}

interface WordTiming {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

const VIDEO_LAB_DRAFT_KEY = 'vitevid-video-lab-draft-v4';

interface LocalMediaAsset {
  asset: ResultItem;
  file: File;
}

function safeSetLocalStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (reason) {
    console.warn(`Could not save ${key}:`, reason);
    try {
      window.localStorage.removeItem(key);
    } catch {}
  }
}

interface ClaudeSceneEdit {
  sceneId: number;
  motion: AutomatedClip['motion'];
  startScale: number;
  endScale: number;
  startX: number;
  endX: number;
  startY: number;
  endY: number;
  rotation: number;
  brightness: number;
  contrast: number;
  saturation: number;
  sepia: number;
  transition: Transition;
}

interface ClaudeEditPlan {
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3';
  canvasColor: string;
  scenes: ClaudeSceneEdit[];
  textOverlays?: ClaudeTextOverlayPlan[];
  soundEffects?: ClaudeSoundEffectPlan[];
}

interface ClaudeTextOverlayPlan {
  text: string;
  sceneId: number;
  startOffset: number;
  duration: number;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  positionX?: number;
  positionY?: number;
}

interface ClaudeSoundEffectPlan {
  assetId: string;
  sceneId: number;
  startOffset: number;
  duration: number;
  volume: number;
}

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatPlayheadTime(seconds: number) {
  return `${formatTime(seconds)}.${String(Math.floor((seconds % 1) * 10))}`;
}

function isImageAsset(asset: ResultItem) {
  return asset.type === 'image';
}

function isHistoryVintageNiche(niche: string) {
  return niche.toLowerCase().includes('history');
}

function isListNumberText(text: string) {
  return new RegExp(
    String.raw`^\s*(?:#?\d{1,3}|${CAPTION_NUMBER_PHRASE}|(?:number|no\.?|item|step)\s+${CAPTION_NUMBER_PHRASE})\s*(?:[\).:-]|\b)`,
    'i',
  ).test(text);
}

function isMoneyOrStatText(text: string) {
  return /[$%]|\b\d{3,4}\b/.test(text);
}

type RuleCalloutEffectKind = 'number' | 'money' | 'percentage' | 'year' | 'statistic';

function calloutEffectKindForText(text: string): RuleCalloutEffectKind | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (isListNumberText(clean)) return 'number';
  if (/\$/.test(clean) || /^\(\s*\$/.test(clean)) return 'money';
  if (/%/.test(clean)) return 'percentage';
  if (/^\(?\s*(17|18|19|20)\d{2}\s*\)?$/.test(clean)) return 'year';
  if (/^\(.+\)$/.test(clean) && /\d/.test(clean)) return 'statistic';
  return null;
}

function preferredEffectIdsForCallout(kind: RuleCalloutEffectKind, historyVintageMode: boolean) {
  if (kind === 'number') return historyVintageMode ? ['history-typewriter', 'keyboard-typing'] : ['keyboard-typing'];
  if (kind === 'money') return ['clock-ticking'];
  if (kind === 'percentage') return historyVintageMode ? ['history-fast-whoosh', 'whoosh'] : ['whoosh'];
  if (kind === 'year') return historyVintageMode ? ['history-tape-rewind', 'whoosh'] : ['whoosh'];
  return ['pop-up', 'mouse-click'];
}

function effectFileMatchesCalloutKind(file: File, kind: RuleCalloutEffectKind) {
  const name = file.name.toLowerCase();
  if (kind === 'number') return isKeyboardTypingEffectFile(file);
  if (kind === 'money') return name.includes('clock');
  if (kind === 'percentage' || kind === 'year') return /(whoosh|swoosh|sweep|rewind)/.test(name);
  return /(pop|click|shutter)/.test(name);
}

function calloutEffectVolume(kind: RuleCalloutEffectKind) {
  if (kind === 'money') return 86;
  if (kind === 'number') return 98;
  if (kind === 'year' || kind === 'percentage') return 90;
  return 84;
}

function calloutEffectMaxDuration(kind: RuleCalloutEffectKind) {
  if (kind === 'money') return 2.4;
  if (kind === 'number') return 1.9;
  if (kind === 'year' || kind === 'percentage') return 1.25;
  return 0.9;
}

function fitImageScale(scale: number, cinematic = false, maxScale = cinematic ? 118 : 104) {
  return Math.max(cinematic ? 98 : 98, Math.min(maxScale, scale));
}

function fitImagePosition(position: number) {
  return Math.max(-4, Math.min(4, position));
}

function fitImageRotation(rotation: number) {
  return Math.max(-0.5, Math.min(0.5, rotation));
}

type EditorStylePreset = 'default' | 'history-vintage' | 'true-crime-dark';

function historyVintageKeyframes(sceneId: number, duration: number, direction: number) {
  const safeDuration = Math.max(0.5, duration);
  const keyframes: TransformKeyframe[] = [
    {
      id: `scene-${sceneId}-auto-start`,
      time: 0,
      scale: 100,
      positionX: direction * 2,
      positionY: direction > 0 ? -1.4 : 1.4,
      rotation: 0,
    },
  ];

  for (
    let resetTime = HISTORY_REFERENCE_RESET_SECONDS;
    resetTime < safeDuration - 0.18;
    resetTime += HISTORY_REFERENCE_RESET_SECONDS
  ) {
    const segment = Math.round(resetTime / HISTORY_REFERENCE_RESET_SECONDS);
    const segmentDirection = segment % 2 === 0 ? direction : -direction;
    keyframes.push(
      {
        id: `scene-${sceneId}-reset-${segment}-pre`,
        time: Math.max(0.1, resetTime - 0.06),
        scale: 103 + (segment % 3),
        positionX: segmentDirection * 1.1,
        positionY: segmentDirection > 0 ? -0.6 : 0.6,
        rotation: segmentDirection * 0.04,
      },
      {
        id: `scene-${sceneId}-reset-${segment}-post`,
        time: resetTime,
        scale: 112 + (segment % 4),
        positionX: -segmentDirection * 1.7,
        positionY: segmentDirection > 0 ? 1 : -1,
        rotation: -segmentDirection * 0.12,
      },
    );
  }

  if (safeDuration > 4 && keyframes.length === 1) {
    const jumpTime = Math.min(4, Math.max(0.5, safeDuration - 0.08));
    keyframes.push(
      {
        id: `scene-${sceneId}-jump-post`,
        time: jumpTime,
        scale: 116,
        positionX: -direction * 1.8,
        positionY: direction > 0 ? 0.9 : -0.9,
        rotation: direction * 0.12,
      },
    );
  }
  keyframes.push({
    id: `scene-${sceneId}-auto-end`,
    time: safeDuration,
    scale: safeDuration > 4 ? 118 : 115,
    positionX: -direction * 2.8,
    positionY: direction > 0 ? 1.8 : -1.8,
    rotation: -direction * 0.16,
  });
  return keyframes;
}

function trueCrimeDarkKeyframes(sceneId: number, duration: number, direction: number) {
  const safeDuration = Math.max(0.5, duration);
  const keyframes: TransformKeyframe[] = [
    {
      id: `scene-${sceneId}-crime-start`,
      time: 0,
      scale: 101,
      positionX: -direction * 1.6,
      positionY: direction > 0 ? 0.8 : -0.8,
      rotation: -direction * 0.08,
    },
  ];
  keyframes.push({
    id: `scene-${sceneId}-crime-end`,
    time: safeDuration,
    scale: safeDuration >= 10 ? 113 : 109,
    positionX: direction * 2.2,
    positionY: direction > 0 ? -1.2 : 1.2,
    rotation: direction * 0.1,
  });
  return keyframes;
}

function historyReferenceTransition(index: number): Transition {
  if (index === 0) return 'none';
  if (index % 10 === 0) return 'glitch';
  if (index % 4 === 0 || index % 7 === 0) return 'screenburn';
  if (index % 6 === 0) return 'slideleft';
  return 'fade';
}

function safeFallbackAssetForScene(scene: VideoLabSourceScene): ResultItem {
  const label = `Safe fallback for scene ${scene.id + 1}`;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">',
    '<rect width="1280" height="720" fill="#071008"/>',
    '<rect x="80" y="74" width="1120" height="572" fill="#0f1b15" stroke="#1cff00" stroke-opacity=".28" stroke-width="3"/>',
    '<text x="640" y="342" text-anchor="middle" fill="#dff8d7" font-family="Arial, sans-serif" font-size="42" font-weight="700">ViteVid safe visual fallback</text>',
    '<text x="640" y="398" text-anchor="middle" fill="#8ddf80" font-family="Arial, sans-serif" font-size="24">Unsafe or unrelated web media was blocked</text>',
    '</svg>',
  ].join('');
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return {
    id: `vitevid-safe-fallback-${scene.id}`,
    source: 'ViteVid',
    title: label,
    type: 'image',
    thumbnail: dataUrl,
    downloadUrl: dataUrl,
    description: 'Neutral safe fallback used because the original web media failed channel-safety filtering.',
    rightsStatus: 'verified-safe',
    rightsLabel: 'Safe fallback',
    rightsNote: 'Generated locally as a neutral emergency frame to avoid unsafe or unrelated web media.',
    isCopyrightSafe: true,
    needsRightsReview: false,
  };
}

function safeSceneAsset(scene: VideoLabSourceScene) {
  return isVisuallyUnsafeForScene(scene.asset, {
    sceneText: scene.text,
    query: scene.text,
    visualConcept: scene.asset.description || scene.asset.title,
  })
    ? safeFallbackAssetForScene(scene)
    : scene.asset;
}

function createClips(scenes: VideoLabSourceScene[], stylePreset: EditorStylePreset = 'default'): EditorClip[] {
  return scenes.map((scene, index) => {
    const asset = safeSceneAsset(scene);
    const alternatives = (scene.alternatives || [scene.asset])
      .filter((candidate) => !isVisuallyUnsafeForScene(candidate, {
        sceneText: scene.text,
        query: scene.text,
        visualConcept: scene.asset.description || scene.asset.title,
      }));
    const imageAsset = isImageAsset(asset);
    const direction = index % 2 === 0 ? 1 : -1;
    const historyVintage = stylePreset === 'history-vintage';
    const trueCrimeDark = stylePreset === 'true-crime-dark';
    const safeDuration = Math.max(0.5, scene.duration);
    const startX = historyVintage ? direction * 2 : trueCrimeDark ? -direction * 1.6 : imageAsset ? direction * 1.5 : direction * 4;
    const endX = historyVintage ? -direction * 2.8 : trueCrimeDark ? direction * 2.2 : imageAsset ? -direction * 1.5 : -direction * 4;
    const startY = historyVintage
      ? (direction > 0 ? -1.4 : 1.4)
      : trueCrimeDark ? (direction > 0 ? 0.8 : -0.8)
        : imageAsset ? (index % 3 === 0 ? -0.5 : 0.5) : (index % 3 === 0 ? -2 : 1);
    const endY = imageAsset ? -startY : -startY;
    const startScale = historyVintage ? 100 : trueCrimeDark ? 101 : imageAsset ? 100 : 106;
    const endScale = historyVintage ? 115 : trueCrimeDark ? (safeDuration >= 10 ? 113 : 109) : imageAsset ? 103 : 118;
    const startRotation = trueCrimeDark ? -direction * 0.08 : imageAsset ? 0 : direction * 0.25;
    const endRotation = historyVintage ? -direction * 0.16 : trueCrimeDark ? direction * 0.1 : imageAsset ? 0 : -direction * 0.35;
    const transition: Transition = index === 0
      ? 'none'
      : trueCrimeDark
        ? 'fade'
        : historyVintage
          ? historyReferenceTransition(index)
          : index % 9 === 0 ? 'slidedown'
            : index % 5 === 0 ? 'slideleft'
              : 'fade';
    const keyframes = historyVintage
      ? historyVintageKeyframes(scene.id, safeDuration, direction)
      : trueCrimeDark
        ? trueCrimeDarkKeyframes(scene.id, safeDuration, direction)
        : [
          {
            id: `scene-${scene.id}-auto-start`,
            time: 0,
            scale: startScale,
            positionX: startX,
            positionY: startY,
            rotation: startRotation,
          },
          {
            id: `scene-${scene.id}-auto-end`,
            time: safeDuration,
            scale: endScale,
            positionX: endX,
            positionY: endY,
            rotation: endRotation,
          },
        ];
    return {
      clipId: `scene-${scene.id}`,
      sceneId: scene.id,
      text: scene.text,
      asset,
      alternatives: alternatives.length > 0 ? alternatives : [asset],
      duration: safeDuration,
      sourceStart: scene.clipStart,
      scale: startScale,
      positionX: startX,
      positionY: startY,
      rotation: startRotation,
      opacity: 100,
      brightness: historyVintage ? 92 : trueCrimeDark ? 82 : 96,
      contrast: historyVintage ? 126 : trueCrimeDark ? 134 : imageAsset ? 112 : 120,
      saturation: historyVintage ? 58 : trueCrimeDark ? 42 : imageAsset ? 80 : 92,
      sepia: historyVintage ? 42 : trueCrimeDark ? 6 : imageAsset ? 20 : 10,
      blur: 0,
      keyframes,
      transition,
    };
  });
}

function getTransformAtTime(clip: EditorClip, time: number) {
  const base = {
    scale: clip.scale ?? 100,
    positionX: clip.positionX,
    positionY: clip.positionY,
    rotation: clip.rotation,
  };
  const keyframes = [...clip.keyframes].sort((left, right) => left.time - right.time);
  const exact = keyframes.find((keyframe) => Math.abs(keyframe.time - time) < 0.01);
  if (exact) return exact;
  const target = keyframes.find((keyframe) => keyframe.time >= time);
  if (!target) return keyframes[keyframes.length - 1] || base;
  const previous = [...keyframes].reverse().find((keyframe) => keyframe.time < time);
  const start = previous || { ...base, time: 0 };
  const distance = Math.max(0.01, target.time - start.time);
  const progress = Math.min(1, Math.max(0, (time - start.time) / distance));
  return {
    scale: start.scale + (target.scale - start.scale) * progress,
    positionX: start.positionX + (target.positionX - start.positionX) * progress,
    positionY: start.positionY + (target.positionY - start.positionY) * progress,
    rotation: start.rotation + (target.rotation - start.rotation) * progress,
  };
}

function getFileDuration(file: File) {
  return new Promise<number>((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    let settled = false;
    const finish = (duration: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    const timeout = window.setTimeout(() => finish(0), 5000);
    audio.onloadedmetadata = () => {
      finish(Number.isFinite(audio.duration) ? audio.duration : 0);
    };
    audio.onerror = () => {
      finish(0);
    };
    audio.src = url;
  });
}

async function getAudioWaveform(file: File, sampleCount = 72) {
  try {
    const context = new AudioContext();
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / sampleCount));
    const waveform = Array.from({ length: sampleCount }, (_, index) => {
      let peak = 0;
      const start = index * step;
      const end = Math.min(data.length, start + step);
      for (let cursor = start; cursor < end; cursor += 1) peak = Math.max(peak, Math.abs(data[cursor]));
      return Math.max(0.08, peak);
    });
    await context.close();
    return waveform;
  } catch {
    return [];
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 60000);
}

function filenameFromPath(path: string) {
  return path.split('/').pop() || 'sound-effect.mp3';
}

function normalizeSpokenToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9$]/g, '');
}

function normalizeCaptionNumber(value: string) {
  const parts = value.toLowerCase().trim().split(/[^a-z0-9]+/).filter(Boolean);
  const word = normalizeSpokenToken(value);
  const numbers: Record<string, number> = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
  };
  const ordinals: Record<string, number> = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
    eleventh: 11,
    twelfth: 12,
    thirteenth: 13,
    fourteenth: 14,
    fifteenth: 15,
    sixteenth: 16,
    seventeenth: 17,
    eighteenth: 18,
    nineteenth: 19,
    twentieth: 20,
    thirtieth: 30,
    fortieth: 40,
    fiftieth: 50,
    sixtieth: 60,
    seventieth: 70,
    eightieth: 80,
    ninetieth: 90,
  };
  if (/^\d+$/.test(word)) return Number(word);
  if (parts.length === 1) return numbers[parts[0]] ?? ordinals[parts[0]];
  if (parts.length === 2) {
    const tens = numbers[parts[0]];
    const ones = numbers[parts[1]] ?? ordinals[parts[1]];
    if (tens >= 20 && ones > 0 && ones < 10) return tens + ones;
  }
  return numbers[word] ?? ordinals[word];
}

function formatMoneyCaption(words: WordTiming[], index: number) {
  const current = words[index];
  const currentToken = normalizeSpokenToken(current.word);
  if (/^\$\d+(?:\.\d+)?$/.test(currentToken)) return `(${current.word.replace(/[^\d.$]/g, '')})`;
  if (/^\d+(?:\.\d+)?$/.test(currentToken)) {
    if (isNumberPhraseToken(words[index - 1]?.word || '')) return '';
    const next = normalizeSpokenToken(words[index + 1]?.word || '');
    if (/^(dollars?)$/.test(next)) return `($${current.word.replace(/[^\d.]/g, '')})`;
    if (/^(cents?)$/.test(next)) return `(${current.word.replace(/[^\d.]/g, '')}c)`;
  }
  if (/^(dollars?|cents?)$/.test(currentToken)) {
    const phrase = getNumberPhraseEndingAt(words, index - 1);
    if (phrase?.text) {
      return currentToken.startsWith('cent') ? `(${phrase.text}c)` : `($${phrase.text})`;
    }
  }
  return '';
}

function formatPercentageCaption(words: WordTiming[], index: number) {
  const current = words[index];
  const currentToken = normalizeSpokenToken(current.word);
  if (/^\d+(?:\.\d+)?%$/.test(current.word.trim())) return `(${current.word.replace(/[^\d.%]/g, '')})`;
  if (/^\d+(?:\.\d+)?$/.test(currentToken)) {
    if (isNumberPhraseToken(words[index - 1]?.word || '')) return '';
    const next = normalizeSpokenToken(words[index + 1]?.word || '');
    if (/^(percent|percentage)$/.test(next)) return `(${current.word.replace(/[^\d.]/g, '')}%)`;
  }
  if (/^(percent|percentage)$/.test(currentToken)) {
    const phrase = getNumberPhraseEndingAt(words, index - 1);
    if (phrase?.text) return `(${phrase.text}%)`;
  }
  return '';
}

function formatYearCaption(word: string) {
  const digits = normalizeSpokenToken(word);
  return /^(17|18|19|20)\d{2}$/.test(digits) ? digits : '';
}

const CAPTION_NUMBER_PHRASE = String.raw`(?:\d{1,3}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth)(?:[-\s]+(?:one|two|three|four|five|six|seven|eight|nine|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth))?`;

function cleanTimingToken(value: string) {
  return value.toLowerCase().replace(/^[^a-z0-9$%.]+|[^a-z0-9$%.]+$/g, '').replace(/,/g, '');
}

function splitNumberTokens(value: string) {
  return value.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
}

function numberTokenValue(token: string) {
  const clean = cleanTimingToken(token);
  if (/^\d+(?:\.\d+)?$/.test(clean)) return Number(clean);
  return normalizeCaptionNumber(clean);
}

function isNumberLikeToken(token: string) {
  const clean = cleanTimingToken(token);
  return Number.isFinite(numberTokenValue(clean));
}

const SCALE_WORDS = new Set(['hundred', 'thousand', 'million', 'billion', 'trillion']);
const STATISTIC_UNITS = new Set([
  'people',
  'person',
  'men',
  'women',
  'children',
  'families',
  'households',
  'victims',
  'deaths',
  'murders',
  'cases',
  'crimes',
  'arrests',
  'documents',
  'homes',
  'banks',
  'businesses',
  'workers',
  'jobs',
  'days',
  'weeks',
  'months',
  'hours',
  'minutes',
  'seconds',
  'times',
  'points',
]);

function isNumberPhraseToken(token: string) {
  const clean = cleanTimingToken(token);
  return clean === 'and'
    || isNumberLikeToken(clean)
    || SCALE_WORDS.has(clean);
}

function parseSmallNumberTokens(tokens: string[]) {
  let total = 0;
  let current = 0;
  tokens.forEach((token) => {
    const clean = cleanTimingToken(token);
    if (!clean || clean === 'and') return;
    if (clean === 'hundred') {
      current = Math.max(1, current) * 100;
      return;
    }
    const value = numberTokenValue(clean);
    if (Number.isFinite(value)) current += value;
  });
  total += current;
  return total > 0 ? total : undefined;
}

function formatNumberPhraseFromTokens(rawTokens: string[]) {
  const tokens = rawTokens.flatMap(splitNumberTokens).filter((token) => token !== 'and');
  if (tokens.length === 0) return '';
  const digitToken = tokens.find((token) => /^\d+(?:\.\d+)?$/.test(token));
  const scaleIndex = tokens.findIndex((token) => SCALE_WORDS.has(token) && token !== 'hundred');
  if (scaleIndex >= 0) {
    const prefixTokens = tokens.slice(0, scaleIndex);
    const prefixValue = digitToken && prefixTokens.includes(digitToken)
      ? digitToken
      : parseSmallNumberTokens(prefixTokens);
    const prefix = prefixValue || prefixTokens.join(' ');
    return `${prefix || '1'} ${tokens[scaleIndex]}`;
  }
  if (digitToken) return digitToken;
  const value = parseSmallNumberTokens(tokens);
  return Number.isFinite(value) ? String(value) : tokens.join(' ');
}

function getNumberPhraseEndingAt(words: WordTiming[], endIndex: number) {
  if (endIndex < 0) return null;
  let start = endIndex;
  let count = 0;
  while (start >= 0 && count < 5 && isNumberPhraseToken(words[start]?.word || '')) {
    start -= 1;
    count += 1;
  }
  const phraseWords = words.slice(start + 1, endIndex + 1);
  if (phraseWords.length === 0) return null;
  const text = formatNumberPhraseFromTokens(phraseWords.map((word) => word.word));
  return text ? { text, start: phraseWords[0].start, endIndex } : null;
}

function getNumberPhraseStartingAt(words: WordTiming[], startIndex: number) {
  let end = startIndex;
  let count = 0;
  while (end < words.length && count < 5 && isNumberPhraseToken(words[end]?.word || '')) {
    end += 1;
    count += 1;
  }
  const phraseWords = words.slice(startIndex, end);
  if (phraseWords.length === 0) return null;
  const text = formatNumberPhraseFromTokens(phraseWords.map((word) => word.word));
  return text ? { text, start: phraseWords[0].start, endIndex: end - 1 } : null;
}

function formatYearCaptionFromWords(words: WordTiming[], index: number) {
  const digitYear = formatYearCaption(words[index].word);
  if (digitYear) return digitYear;
  const current = cleanTimingToken(words[index].word);
  const previous = cleanTimingToken(words[index - 1]?.word || '');
  if (['seventeen', 'eighteen', 'nineteen', 'twenty'].includes(previous)) return '';
  const centuryMap: Record<string, number> = {
    seventeen: 1700,
    eighteen: 1800,
    nineteen: 1900,
    twenty: 2000,
  };
  const century = centuryMap[current];
  if (!century) return '';
  const next = cleanTimingToken(words[index + 1]?.word || '');
  const third = cleanTimingToken(words[index + 2]?.word || '');
  const nextValue = numberTokenValue(next);
  const thirdValue = numberTokenValue(third);
  if (current === 'twenty' && nextValue >= 20 && nextValue <= 99) {
    const suffix = nextValue >= 20 && thirdValue > 0 && thirdValue < 10
      ? nextValue + thirdValue
      : nextValue;
    return suffix >= 0 && suffix <= 99 ? String(2000 + suffix) : '';
  }
  if (century < 2000 && nextValue >= 0 && nextValue <= 99) {
    const suffix = nextValue >= 20 && thirdValue > 0 && thirdValue < 10
      ? nextValue + thirdValue
      : nextValue;
    return suffix >= 0 && suffix <= 99 ? String(century + suffix) : '';
  }
  return '';
}

function formatStatisticCaption(words: WordTiming[], index: number) {
  const current = cleanTimingToken(words[index].word);
  if (!current || current.startsWith('$') || formatYearCaptionFromWords(words, index)) return '';
  if (isNumberPhraseToken(words[index - 1]?.word || '')) return '';
  if (!isNumberLikeToken(current)) return '';

  const ratioMiddle = cleanTimingToken(words[index + 1]?.word || '');
  const ratioBridge = cleanTimingToken(words[index + 2]?.word || '');
  const ratioEndIndex = ratioMiddle === 'out' && ratioBridge === 'of' ? index + 3 : index + 2;
  if ((ratioMiddle === 'in' || (ratioMiddle === 'out' && ratioBridge === 'of')) && isNumberLikeToken(words[ratioEndIndex]?.word || '')) {
    const left = formatNumberPhraseFromTokens([words[index].word]);
    const right = formatNumberPhraseFromTokens([words[ratioEndIndex].word]);
    return left && right ? `(${left} ${ratioMiddle === 'in' ? 'in' : 'out of'} ${right})` : '';
  }

  const phrase = getNumberPhraseStartingAt(words, index);
  if (!phrase || phrase.start !== words[index].start) return '';
  const next = cleanTimingToken(words[phrase.endIndex + 1]?.word || '');
  const nextAfterUnit = cleanTimingToken(words[phrase.endIndex + 2]?.word || '');
  if (/^(dollars?|cents?|percent|percentage)$/.test(next) || /^(dollars?|cents?|percent|percentage)$/.test(nextAfterUnit)) {
    return '';
  }
  if (STATISTIC_UNITS.has(next)) return `(${phrase.text} ${next})`;
  if (phrase.text.includes('thousand') || phrase.text.includes('million') || phrase.text.includes('billion') || phrase.text.includes('trillion')) {
    return `(${phrase.text})`;
  }
  if (/^\d{3,}$/.test(current) && !/^(17|18|19|20)\d{2}$/.test(current)) return `(${current})`;
  return '';
}

function cleanupNumberCaptionTitle(value: string) {
  const trimmed = value.trim();
  const prefixMatch = trimmed.match(new RegExp(
    String.raw`^(?:number|no\.?|item|step|#)\s+(${CAPTION_NUMBER_PHRASE})(?:\b|[\).,:;\-–—])\s*([\s\S]*)`,
    'i',
  ));
  const directMatch = trimmed.match(new RegExp(
    String.raw`^(${CAPTION_NUMBER_PHRASE})\s*[\).,:;\-–—]\s*([\s\S]*)`,
    'i',
  ));
  const match = prefixMatch || directMatch;
  const title = match && Number.isFinite(normalizeCaptionNumber(match[1])) ? match[2] : trimmed;
  return title
    .replace(/\s+/g, ' ')
    .replace(/[,;:.?!].*$/, '')
    .trim()
    .slice(0, 46);
}

function extractSceneNumberCaption(text: string, fallbackTitle = '') {
  const prefixMatch = text.match(new RegExp(
    String.raw`^\s*(?:number|no\.?|item|step|#)\s+(${CAPTION_NUMBER_PHRASE})(?:\b|[\).,:;\-–—])\s*([\s\S]*)`,
    'i',
  ));
  const directMatch = text.match(new RegExp(
    String.raw`^\s*(${CAPTION_NUMBER_PHRASE})\s*[\).,:;\-–—]\s*([\s\S]*)`,
    'i',
  ));
  const looseListMatch = text.match(new RegExp(
    String.raw`^\s*(${CAPTION_NUMBER_PHRASE})\s+(?:(?:item|items|strategy|strategies|reason|reasons|tip|tips|method|methods|way|ways|rule|rules|secret|secrets|mistake|mistakes|lesson|lessons|number)\b|(?:was|is|were|are)\b|[a-z][a-z'-]+\s+(?:on\s+this\s+list|was|is|were|are)\b)\s*([\s\S]*)`,
    'i',
  ));
  const leadingDigitTitleMatch = text.match(/^\s*(\d{1,3})\s+([a-z][\s\S]{8,})/i);
  const match = prefixMatch || directMatch || looseListMatch || leadingDigitTitleMatch;
  if (!match) return '';
  const number = normalizeCaptionNumber(match[1]);
  if (!Number.isFinite(number) || number <= 0) return '';
  const title = cleanupNumberCaptionTitle(match[2] || '') || cleanupNumberCaptionTitle(fallbackTitle);
  return title ? `${number}. ${title}` : `${number}.`;
}

const NUMBER_LIST_MARKERS = new Set(['number', 'no', 'item', 'step']);
const NUMBER_LIST_TITLE_FILLERS = new Set([
  'was',
  'is',
  'were',
  'are',
  'the',
  'a',
  'an',
  'item',
  'items',
  'strategy',
  'strategies',
  'reason',
  'reasons',
  'tip',
  'tips',
  'method',
  'methods',
  'way',
  'ways',
  'rule',
  'rules',
  'secret',
  'secrets',
  'lesson',
  'lessons',
  'on',
  'this',
  'list',
]);
const NUMBER_LIST_CUE_WORDS = new Set([
  ...NUMBER_LIST_TITLE_FILLERS,
  'countdown',
  'rank',
  'ranked',
  'comes',
  'came',
]);

function cleanCaptionTitleWord(value: string) {
  return value.replace(/^[^a-z0-9$]+|[^a-z0-9$]+$/gi, '');
}

function buildNumberCaptionTitle(words: WordTiming[], startIndex: number) {
  const titleWords: string[] = [];
  let index = startIndex;
  while (index < words.length && titleWords.length < 7) {
    const clean = cleanCaptionTitleWord(words[index].word);
    const token = clean.toLowerCase();
    if (!clean) {
      index += 1;
      continue;
    }
    if (titleWords.length === 0 && NUMBER_LIST_TITLE_FILLERS.has(token)) {
      index += 1;
      continue;
    }
    if (titleWords.length > 0 && /[.!?;:]$/.test(words[index - 1]?.word || '')) break;
    if (titleWords.length > 0 && NUMBER_LIST_MARKERS.has(token)) break;
    titleWords.push(clean);
    index += 1;
  }
  return cleanupNumberCaptionTitle(titleWords.join(' '));
}

function formatNumberListCaptionFromWords(words: WordTiming[], index: number) {
  const current = cleanTimingToken(words[index]?.word || '').replace(/\.$/, '');
  const next = cleanTimingToken(words[index + 1]?.word || '');
  const previous = cleanTimingToken(words[index - 1]?.word || '').replace(/\.$/, '');
  const currentIsMarker = NUMBER_LIST_MARKERS.has(current) || current === '#';
  const previousIsMarker = NUMBER_LIST_MARKERS.has(previous) || previous === '#';
  const phrase = currentIsMarker
    ? getNumberPhraseStartingAt(words, index + 1)
    : previousIsMarker
      ? getNumberPhraseStartingAt(words, index)
      : getNumberPhraseStartingAt(words, index);

  if (!phrase || phrase.start !== (currentIsMarker ? words[index + 1]?.start : words[index]?.start)) return null;
  if (!currentIsMarker && !previousIsMarker) {
    const cue = cleanTimingToken(words[phrase.endIndex + 1]?.word || '');
    if (!NUMBER_LIST_CUE_WORDS.has(cue)) return null;
  }

  const number = normalizeCaptionNumber(phrase.text);
  if (!Number.isFinite(number) || number <= 0) return null;
  const title = buildNumberCaptionTitle(words, phrase.endIndex + 1);
  const startWord = currentIsMarker ? words[index] : words[index];
  return {
    text: title ? `${number}. ${title}` : `${number}.`,
    start: startWord.start,
    endIndex: Math.max(index, phrase.endIndex + 6),
  };
}

function getVoiceoverDuration(voiceOver: StoryboardVoiceOver | null, timings: WordTiming[] = [], overrideDuration = 0) {
  const timingDuration = timings[timings.length - 1]?.end || 0;
  const bestKnown = Math.max(overrideDuration || 0, timingDuration || 0);
  const metadataDuration = voiceOver?.duration || 0;
  if (bestKnown > 0 && (!metadataDuration || metadataDuration > bestKnown * 1.35 || metadataDuration < bestKnown * 0.65)) {
    return bestKnown;
  }
  return metadataDuration || bestKnown;
}

function getReliableAudioDuration(metadataDuration: number, expectedDuration: number) {
  if (!metadataDuration || metadataDuration <= 0) return expectedDuration || 0;
  if (expectedDuration > 0 && (metadataDuration > expectedDuration * 1.35 || metadataDuration < expectedDuration * 0.65)) {
    return expectedDuration;
  }
  return metadataDuration;
}

function textOverlaySignature(overlay: Pick<TextOverlay, 'text' | 'timelineStart'>) {
  const text = overlay.text.toLowerCase().replace(/[^a-z0-9$]+/g, ' ').trim();
  return text;
}

function mergeTextOverlays(current: TextOverlay[], incoming: TextOverlay[]) {
  const accepted: TextOverlay[] = [];
  incoming.forEach((overlay) => {
    const signature = textOverlaySignature(overlay);
    const duplicate = [...current, ...accepted].some((entry) => (
      textOverlaySignature(entry) === signature
      && Math.abs(entry.timelineStart - overlay.timelineStart) <= 3
    ));
    if (duplicate) return;
    accepted.push(overlay);
  });
  return [...current, ...accepted];
}

function dedupeTextOverlays(overlays: TextOverlay[]) {
  return mergeTextOverlays([], overlays);
}

function effectSignature(effect: Pick<TimelineSoundEffect, 'file' | 'timelineStart'>) {
  return effect.file.name.toLowerCase().replace(/\s+/g, ' ');
}

function mergeSoundEffects(current: TimelineSoundEffect[], incoming: TimelineSoundEffect[]) {
  const accepted: TimelineSoundEffect[] = [];
  incoming.forEach((effect) => {
    const signature = effectSignature(effect);
    const duplicate = [...current, ...accepted].some((entry) => (
      effectSignature(entry) === signature
      && Math.abs(entry.timelineStart - effect.timelineStart) <= 0.25
    ));
    if (duplicate) return;
    accepted.push(effect);
  });
  return [...current, ...accepted];
}

function dedupeSoundEffects(effects: TimelineSoundEffect[]) {
  return mergeSoundEffects([], effects);
}

function alignScenesToVoiceOver(
  scenes: VideoLabSourceScene[],
  voiceOver: StoryboardVoiceOver | null,
  timings: WordTiming[] = [],
  overrideDuration = 0,
  hyperPaced = false,
) {
  const sourceDuration = scenes.reduce((total, scene) => total + scene.duration, 0);
  const targetDuration = getVoiceoverDuration(voiceOver, timings, overrideDuration || sourceDuration);
  const scenesHaveVoiceClock = scenes.every((scene) => (
    Number.isFinite(scene.narrationStart)
    && Number.isFinite(scene.narrationEnd)
    && (scene.narrationEnd || 0) > (scene.narrationStart || 0)
  ));
  if (scenesHaveVoiceClock) {
    return scenes.map((scene, index) => {
      const start = Math.max(0, scene.narrationStart || 0);
      const sceneEnd = scene.narrationEnd || start + scene.duration;
      const nextStart = scenes[index + 1]?.narrationStart;
      const end = Number.isFinite(nextStart) && (nextStart || 0) > start
        ? Math.max(sceneEnd, nextStart || sceneEnd)
        : Math.max(start, sceneEnd);
      return {
        ...scene,
        duration: Math.max(0.1, Math.round(Math.max(0.1, end - start) * 10) / 10),
      };
    });
  }
  if (timings.length > 0) {
    let wordCursor = 0;
    const adjustedScenes = scenes.map((scene, index) => {
      const sceneWordCount = Math.max(1, scene.text.trim().split(/\s+/).filter(Boolean).length);
      const firstWord = timings[wordCursor];
      const nextSceneWord = timings[wordCursor + sceneWordCount];
      const lastSceneWord = timings[Math.min(timings.length - 1, wordCursor + sceneWordCount - 1)];
      const previousEnd = index === 0
        ? 0
        : timings[Math.max(0, wordCursor - 1)]?.end || 0;
      const start = firstWord?.start ?? previousEnd;
      const end = hyperPaced
        ? (lastSceneWord?.end ?? nextSceneWord?.start ?? start + scene.duration)
        : (nextSceneWord?.start
          ?? (index === scenes.length - 1 && targetDuration > 0 ? targetDuration : lastSceneWord?.end)
          ?? start + scene.duration);
      wordCursor += sceneWordCount;
      return {
        ...scene,
        duration: Math.max(0.5, Math.round(Math.max(0.5, end - start) * 10) / 10),
      };
    });
    const adjustedDuration = adjustedScenes.reduce((total, scene) => total + scene.duration, 0);
    if (targetDuration > 0 && adjustedScenes.length > 0 && Math.abs(adjustedDuration - targetDuration) > 0.2) {
      const lastScene = adjustedScenes[adjustedScenes.length - 1];
      adjustedScenes[adjustedScenes.length - 1] = {
        ...lastScene,
        duration: Math.max(0.5, Math.round((lastScene.duration + targetDuration - adjustedDuration) * 10) / 10),
      };
    }
    return adjustedScenes;
  }
  if (!targetDuration || !sourceDuration || Math.abs(targetDuration - sourceDuration) < 0.5) return scenes;
  const wordWeights = scenes.map((scene) => Math.max(1, scene.text.trim().split(/\s+/).filter(Boolean).length));
  const totalWeight = wordWeights.reduce((total, weight) => total + weight, 0);
  let accumulatedDuration = 0;
  return scenes.map((scene, index) => ({
    ...scene,
    duration: Math.max(
      0.5,
      Math.round(((targetDuration * wordWeights[index] / totalWeight) || 0.5) * 10) / 10,
    ),
  })).map((scene, index, adjustedScenes) => {
    if (index < adjustedScenes.length - 1) {
      accumulatedDuration += scene.duration;
      return scene;
    }
    return {
      ...scene,
      duration: Math.max(0.5, Math.round((targetDuration - accumulatedDuration) * 10) / 10),
    };
  });
}

function getVideoFileDuration(file: File) {
  return new Promise<number>((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(video.duration) ? video.duration : 0);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(0);
    };
    video.src = url;
  });
}

export default function VideoLab({
  initialScenes,
  niche,
  editingInstructions,
  initialVoiceOver,
  onClose,
}: VideoLabProps) {
  const historyVintageMode = isHistoryVintageNiche(niche);
  const trueCrimeMode = isTrueCrimeNiche(niche);
  const editorStylePreset: EditorStylePreset = historyVintageMode
    ? 'history-vintage'
    : trueCrimeMode ? 'true-crime-dark' : 'default';
  const [wordTimings, setWordTimings] = useState<WordTiming[]>(() => initialVoiceOver?.words || []);
  const [alignedVoiceOverDuration, setAlignedVoiceOverDuration] = useState(
    () => initialVoiceOver?.words?.[initialVoiceOver.words.length - 1]?.end || 0,
  );
  const [alignmentStatus, setAlignmentStatus] = useState<'idle' | 'running' | 'ready' | 'failed'>(
    initialVoiceOver?.words?.length ? 'ready' : initialVoiceOver ? 'running' : 'idle',
  );
  const timelineScenes = useMemo(
    () => alignScenesToVoiceOver(initialScenes, initialVoiceOver, wordTimings, alignedVoiceOverDuration, historyVintageMode),
    [alignedVoiceOverDuration, historyVintageMode, initialScenes, initialVoiceOver, wordTimings],
  );
  const initialStoryboardDuration = initialScenes.reduce((total, scene) => total + scene.duration, 0);
  const [clips, setClips] = useState<EditorClip[]>(() => createClips(timelineScenes, editorStylePreset));
  const [selectedClipId, setSelectedClipId] = useState(() => `scene-${timelineScenes[0]?.id}`);
  const availableSoundEffectLibrary = useMemo(() => {
    if (trueCrimeMode) return [...SOUND_EFFECT_LIBRARY, ...TRUE_CRIME_SOUND_EFFECT_LIBRARY];
    if (historyVintageMode) return [...SOUND_EFFECT_LIBRARY, ...HISTORY_VINTAGE_SOUND_EFFECT_LIBRARY];
    return [...SOUND_EFFECT_LIBRARY];
  }, [historyVintageMode, trueCrimeMode]);
  const [selectedTrack, setSelectedTrack] = useState<'visual' | 'audio' | 'music' | 'text' | 'effect'>('visual');
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioTrack, setAudioTrack] = useState<EditorAudio | null>(() => (initialVoiceOver ? {
    file: initialVoiceOver.file,
    duration: Math.max(
      0.5,
      getReliableAudioDuration(initialVoiceOver.duration, initialStoryboardDuration)
        || timelineScenes.reduce((total, scene) => total + scene.duration, 0),
    ),
    sourceStart: 0,
    timelineStart: 0,
    volume: 100,
    label: 'Voiceover',
    sourceDuration: Math.max(0.5, getReliableAudioDuration(initialVoiceOver.duration, initialStoryboardDuration)),
  } : null));
  const [musicTrack, setMusicTrack] = useState<EditorAudio | null>(null);
  const [musicTracks, setMusicTracks] = useState<EditorAudio[]>([]);
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>([]);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [soundEffects, setSoundEffects] = useState<TimelineSoundEffect[]>([]);
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);
  const [localMediaAssets, setLocalMediaAssets] = useState<LocalMediaAsset[]>([]);
  const [audioWaveform, setAudioWaveform] = useState<number[]>([]);
  const [musicWaveform, setMusicWaveform] = useState<number[]>([]);
  const [musicWaveforms, setMusicWaveforms] = useState<Record<string, number[]>>({});
  const [effectWaveforms, setEffectWaveforms] = useState<Record<string, number[]>>({});
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [timelineExtraSeconds, setTimelineExtraSeconds] = useState(0);
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<AssetPanel>('media');
  const [visualHidden, setVisualHidden] = useState(false);
  const [textHidden, setTextHidden] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [musicMuted, setMusicMuted] = useState(false);
  const [effectsMuted, setEffectsMuted] = useState(false);
  const [lockedTracks, setLockedTracks] = useState({
    visual: false,
    text: false,
    audio: false,
    music: false,
    effect: false,
  });
  const [snapping, setSnapping] = useState(true);
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [canvasColor, setCanvasColor] = useState('#000000');
  const [canvasRatio, setCanvasRatio] = useState<CanvasRatio>('16:9');
  const [canvasWidth, setCanvasWidth] = useState(1280);
  const [canvasHeight, setCanvasHeight] = useState(720);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const [clipContextMenu, setClipContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [hasCopiedClip, setHasCopiedClip] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportedVideo, setExportedVideo] = useState<{ url: string; filename: string } | null>(null);
  const [message, setMessage] = useState(() => (
    initialVoiceOver ? `${initialVoiceOver.file.name} attached to the audio track.` : ''
  ));
  const [editPlanStatus, setEditPlanStatus] = useState(() => (
    timelineScenes.length > CLAUDE_EDIT_BATCH_SIZE
      ? `Claude is preparing automated edits in ${Math.ceil(timelineScenes.length / CLAUDE_EDIT_BATCH_SIZE)} batches...`
      : 'Claude is preparing the automated edit...'
  ));
  const audioRef = useRef<HTMLAudioElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const musicRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const timelineViewportRef = useRef<HTMLDivElement>(null);
  const copiedClipRef = useRef<EditorClip | null>(null);
  const effectRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const localMediaAssetsRef = useRef<LocalMediaAsset[]>([]);
  const hasRequestedAlignmentRef = useRef(false);
  const hasRequestedEditPlanRef = useRef(false);
  const hasAppliedInstructionCalloutsRef = useRef(false);
  const hasRepairedNumberCalloutsRef = useRef(false);
  const hasLoadedNumberingTypingAssetRef = useRef<Promise<{ file: File; sourceDuration: number } | null> | null>(null);
  const hasAppliedHistoryReferenceFxRef = useRef(false);
  const hasAppliedHistoryMusicRef = useRef(false);
  const hasAppliedTrueCrimeMusicRef = useRef(false);
  const hasLoadedVideoDraftRef = useRef(false);
  const selectedClipIdRef = useRef(selectedClipId);
  const idCounterRef = useRef(0);
  const historyRef = useRef<ProjectSnapshot[]>([]);
  const redoRef = useRef<ProjectSnapshot[]>([]);
  const pendingHistoryRef = useRef<ProjectSnapshot | null>(null);
  const historyTimerRef = useRef<number | null>(null);
  const restoringHistoryRef = useRef(false);
  const lastProjectRef = useRef<ProjectSnapshot>({
    clips,
    audioTrack,
    musicTrack,
    musicTracks,
    textOverlays,
    soundEffects,
    canvasColor,
    canvasRatio,
    canvasWidth,
    canvasHeight,
  });

  const visualDuration = useMemo(
    () => clips.reduce((total, clip) => total + clip.duration, 0),
    [clips],
  );

  useEffect(() => {
    if (hasLoadedVideoDraftRef.current || typeof window === 'undefined') return;
    hasLoadedVideoDraftRef.current = true;
    try {
      const rawDraft = window.localStorage.getItem(VIDEO_LAB_DRAFT_KEY);
      if (!rawDraft) return;
      const draft = JSON.parse(rawDraft) as {
        sceneIds?: number[];
        canvasColor?: string;
        canvasRatio?: CanvasRatio;
        canvasWidth?: number;
        canvasHeight?: number;
      };
      const currentSceneIds = initialScenes.map((scene) => scene.id).join(',');
      if (!draft.sceneIds || draft.sceneIds.join(',') !== currentSceneIds) return;
      if (draft.canvasColor) setCanvasColor(draft.canvasColor);
      if (draft.canvasRatio) setCanvasRatio(draft.canvasRatio);
      if (typeof draft.canvasWidth === 'number') setCanvasWidth(draft.canvasWidth);
      if (typeof draft.canvasHeight === 'number') setCanvasHeight(draft.canvasHeight);
      setMessage('Restored your saved Video Lab canvas settings.');
    } catch (reason) {
      console.warn('Could not load ViteVid Video Lab draft:', reason);
    }
  }, [initialScenes, initialVoiceOver]);

  useEffect(() => {
    if (!hasLoadedVideoDraftRef.current || typeof window === 'undefined') return;
    const draft = {
      sceneIds: initialScenes.map((scene) => scene.id),
      canvasColor,
      canvasRatio,
      canvasWidth,
      canvasHeight,
      savedAt: Date.now(),
    };
    safeSetLocalStorage(VIDEO_LAB_DRAFT_KEY, draft);
  }, [canvasColor, canvasHeight, canvasRatio, canvasWidth, initialScenes]);

  const clipRanges = useMemo(() => {
    return clips.reduce<Array<{ clip: EditorClip; start: number; end: number }>>((ranges, clip) => {
      const start = ranges[ranges.length - 1]?.end || 0;
      return [...ranges, { clip, start, end: start + clip.duration }];
    }, []);
  }, [clips]);
  const playheadClipIndex = clipRanges.findIndex((range) => (
    playheadTime >= range.start && playheadTime < range.end
  ));
  const previewIndex = playheadClipIndex >= 0 ? playheadClipIndex : Math.max(0, clips.length - 1);
  const activeClip = clips[previewIndex] || clips[clips.length - 1];
  const activeRange = clipRanges[previewIndex];
  const activeClipTime = activeRange
    ? Math.min(activeClip.duration, Math.max(0, playheadTime - activeRange.start))
    : 0;
  const activeTransform = getTransformAtTime(activeClip, activeClipTime);
  const selectedIndex = Math.max(0, clips.findIndex((clip) => clip.clipId === selectedClipId));
  const selectedClip = clips[selectedIndex] || activeClip;
  const selectedKeyframe = selectedClip.keyframes.find((keyframe) => keyframe.id === selectedKeyframeId);
  const selectedRange = clipRanges[selectedIndex];
  const selectedClipTime = selectedRange
    ? Math.min(selectedClip.duration, Math.max(0, playheadTime - selectedRange.start))
    : 0;
  const keyframeAtPlayhead = selectedClip.keyframes.find((keyframe) => (
    Math.abs(keyframe.time - selectedClipTime) < 0.05
  ));
  const selectedText = textOverlays.find((overlay) => overlay.id === selectedTextId);
  const selectedEffect = soundEffects.find((effect) => effect.id === selectedEffectId);
  const activeTextOverlays = textOverlays.filter((overlay) => (
    !textHidden
    && playheadTime >= overlay.timelineStart
    && playheadTime < overlay.timelineStart + overlay.duration
  ));
  const localMediaFiles = useMemo(() => {
    return localMediaAssets.reduce<Record<string, File>>((files, entry) => {
      files[entry.asset.id] = entry.file;
      return files;
    }, {});
  }, [localMediaAssets]);
  const textDuration = textOverlays.reduce((end, overlay) => Math.max(end, overlay.timelineStart + overlay.duration), 0);
  const effectDuration = soundEffects.reduce((end, effect) => Math.max(end, effect.timelineStart + effect.duration), 0);
  const musicDuration = Math.max(
    musicTrack ? musicTrack.timelineStart + musicTrack.duration : 0,
    ...musicTracks.map((track) => track.timelineStart + track.duration),
    0,
  );
  const contentDuration = Math.max(
    visualDuration,
    audioTrack ? audioTrack.timelineStart + audioTrack.duration : 0,
    musicDuration,
    textDuration,
    effectDuration,
  );
  const storyboardDuration = useMemo(
    () => initialScenes.reduce((total, scene) => total + scene.duration, 0),
    [initialScenes],
  );
  const voiceoverTimelineEnd = audioTrack
    ? audioTrack.timelineStart + audioTrack.duration
    : alignedVoiceOverDuration || storyboardDuration || 0;
  const timelineDuration = Math.max(
    voiceoverTimelineEnd || contentDuration,
    visualDuration,
    voiceoverTimelineEnd > 60 ? 0 : 60,
    timelineExtraSeconds,
  );
  const basePixelsPerSecond = timelineDuration > 300 ? 16 : timelineDuration > 120 ? 24 : 52;
  const pixelsPerSecond = basePixelsPerSecond * timelineZoom;
  const timelineWidth = Math.max(760, timelineViewportWidth, Math.ceil(timelineDuration * pixelsPerSecond));
  const tickSeconds = timelineDuration > 300 ? 60 : timelineDuration > 120 ? 30 : timelineDuration > 45 ? 10 : 5;
  const timelineTicks = Array.from(
    { length: Math.floor(timelineDuration / tickSeconds) + 1 },
    (_, index) => index * tickSeconds,
  );

  useEffect(() => {
    if (!voiceoverTimelineEnd || voiceoverTimelineEnd <= 0) return;
    setClips((current) => {
      let cursor = 0;
      let changed = false;
      const clamped: EditorClip[] = [];
      for (const clip of current) {
        const remaining = voiceoverTimelineEnd - cursor;
        if (remaining <= 0.05) {
          changed = true;
          break;
        }
        const nextDuration = Math.max(0.1, Math.min(clip.duration, remaining));
        cursor += nextDuration;
        if (Math.abs(nextDuration - clip.duration) > 0.05) changed = true;
        clamped.push({
          ...clip,
          duration: Math.round(nextDuration * 10) / 10,
          keyframes: clip.keyframes.map((keyframe, index, keyframes) => ({
            ...keyframe,
            time: index === keyframes.length - 1
              ? Math.round(nextDuration * 10) / 10
              : Math.min(keyframe.time, Math.round(nextDuration * 10) / 10),
          })),
        });
      }
      return changed ? clamped : current;
    });
  }, [voiceoverTimelineEnd]);

  const backgroundAudioUrl = useMemo(
    () => (audioTrack ? URL.createObjectURL(audioTrack.file) : ''),
    [audioTrack],
  );
  const backgroundMusicUrl = useMemo(
    () => (musicTrack ? URL.createObjectURL(musicTrack.file) : ''),
    [musicTrack],
  );
  const backgroundMusicUrls = useMemo(
    () => musicTracks.map((track, index) => ({
      id: track.id || `music-${index}`,
      url: URL.createObjectURL(track.file),
    })),
    [musicTracks],
  );
  const soundEffectUrls = useMemo(
    () => soundEffects.map((effect) => ({ id: effect.id, url: URL.createObjectURL(effect.file) })),
    [soundEffects],
  );
  const remotionProject = useMemo<AutomatedVideoProps>(() => {
    const remotionClips: AutomatedClip[] = clips.map((clip, index) => {
      const sortedKeyframes = [...clip.keyframes].sort((left, right) => left.time - right.time);
      const firstKeyframe = sortedKeyframes[0];
      const finalKeyframe = sortedKeyframes[sortedKeyframes.length - 1];
      const imageAsset = isImageAsset(clip.asset);
      const rawStartScale = firstKeyframe?.scale ?? clip.scale ?? 100;
      const startScale = imageAsset ? fitImageScale(rawStartScale, historyVintageMode || trueCrimeMode, trueCrimeMode ? 122 : undefined) : rawStartScale;
      const rawEndScale = finalKeyframe?.scale ?? Math.min(125, startScale + 8);
      const endScale = imageAsset ? fitImageScale(rawEndScale, historyVintageMode || trueCrimeMode, trueCrimeMode ? 122 : undefined) : rawEndScale;
      const startX = firstKeyframe?.positionX ?? clip.positionX;
      const endX = finalKeyframe?.positionX ?? (index % 2 === 0 ? 4 : -4);
      const startY = firstKeyframe?.positionY ?? clip.positionY;
      const endY = finalKeyframe?.positionY ?? (index % 2 === 0 ? -2 : 0);
      const rotation = finalKeyframe?.rotation ?? clip.rotation;
      return {
        id: clip.clipId,
        sceneId: clip.sceneId,
        title: clip.asset.title || `Scene ${index + 1}`,
        text: clip.text,
        type: clip.asset.type,
        src: clip.asset.downloadUrl || clip.asset.thumbnail,
        poster: clip.asset.thumbnail || clip.asset.downloadUrl,
        duration: clip.duration,
        sourceStart: clip.sourceStart,
        transition: clip.transition,
        motion: index % 4 === 0 ? 'push-in' : index % 4 === 1 ? 'pan-right' : index % 4 === 2 ? 'pull-out' : 'pan-left',
        startScale,
        endScale,
        startX: imageAsset ? fitImagePosition(startX) : startX,
        endX: imageAsset ? fitImagePosition(endX) : endX,
        startY: imageAsset ? fitImagePosition(startY) : startY,
        endY: imageAsset ? fitImagePosition(endY) : endY,
        rotation: imageAsset ? fitImageRotation(rotation) : rotation,
        brightness: clip.brightness,
        contrast: clip.contrast,
        saturation: clip.saturation,
        sepia: clip.sepia,
        rightsStatus: clip.asset.rightsStatus,
        rightsLabel: clip.asset.rightsLabel,
        rightsNote: clip.asset.rightsNote,
        license: clip.asset.license,
        licenseUrl: clip.asset.licenseUrl,
        attribution: clip.asset.attribution,
        sourcePageUrl: clip.asset.sourcePageUrl || clip.asset.url,
        isCopyrightSafe: clip.asset.isCopyrightSafe,
        needsRightsReview: clip.asset.needsRightsReview,
      };
    });
    return {
      clips: remotionClips,
      textOverlays: textHidden ? [] : textOverlays.map((overlay) => ({
        id: overlay.id,
        text: overlay.text,
        start: overlay.timelineStart,
        duration: overlay.duration,
        x: overlay.positionX,
        y: overlay.positionY,
        size: overlay.fontSize,
        color: overlay.color,
        background: overlay.backgroundColor,
      })),
      canvasColor,
      width: canvasWidth,
      height: canvasHeight,
      fps: 24,
      durationInFrames: Math.max(1, Math.ceil(contentDuration * 24)),
      audioTrack: null,
      musicTrack: null,
      musicTracks: [],
      soundEffects: [],
      stylePreset: historyVintageMode ? 'history-vintage' : trueCrimeMode ? 'true-crime-dark' : undefined,
    };
  }, [canvasColor, canvasHeight, canvasWidth, clips, contentDuration, historyVintageMode, textHidden, textOverlays, trueCrimeMode]);

  const createTimelineId = useCallback((prefix: string) => {
    idCounterRef.current += 1;
    return `${prefix}-${idCounterRef.current}`;
  }, []);

  useEffect(() => {
    if (hasAppliedInstructionCalloutsRef.current) return;
    if (alignmentStatus !== 'ready') return;

    hasAppliedInstructionCalloutsRef.current = true;

    const applyInstructionCallouts = async () => {
      const sceneStarts = timelineScenes.reduce<Record<number, number>>((starts, scene, index) => {
        const previous = index === 0 ? 0 : starts[timelineScenes[index - 1].id] + timelineScenes[index - 1].duration;
        const voiceStart = Number.isFinite(scene.narrationStart) ? Math.max(0, scene.narrationStart || 0) : previous;
        return { ...starts, [scene.id]: voiceStart };
      }, {});
      const callouts: Array<{
        text: string;
        start: number;
        effectId: string;
        kind: 'money' | 'percentage' | 'year' | 'number' | 'statistic';
      }> = [];
      const seen = new Set<string>();
      const addCallout = (
        text: string,
        start: number,
        effectId: string,
        kind: 'money' | 'percentage' | 'year' | 'number' | 'statistic',
      ) => {
        const cleanText = text.replace(/\s+/g, ' ').trim().slice(0, 90);
        if (!cleanText || !Number.isFinite(start)) return;
        const roundedStart = Math.max(0, Math.round((start - 0.18) * 10) / 10);
        const key = `${effectId}:${cleanText.toLowerCase()}:${Math.round(roundedStart * 2) / 2}`;
        if (seen.has(key)) return;
        seen.add(key);
        callouts.push({ text: cleanText, start: roundedStart, effectId, kind });
      };

      if (wordTimings.length > 0) {
        let consumedNumberListEndIndex = -1;
        wordTimings.forEach((word, index) => {
          if (index > consumedNumberListEndIndex) {
            const numberCaption = formatNumberListCaptionFromWords(wordTimings, index);
            if (numberCaption) {
              addCallout(numberCaption.text, numberCaption.start, 'keyboard-typing', 'number');
              consumedNumberListEndIndex = numberCaption.endIndex;
            }
          }
          const moneyCaption = formatMoneyCaption(wordTimings, index);
          if (moneyCaption) {
            const start = normalizeSpokenToken(word.word).match(/^(dollars?|cents?)$/)
              ? wordTimings[index - 1]?.start ?? word.start
              : word.start;
            addCallout(moneyCaption, start, 'clock-ticking', 'money');
          }
          const percentageCaption = formatPercentageCaption(wordTimings, index);
          if (percentageCaption) {
            const start = normalizeSpokenToken(word.word).match(/^(percent|percentage)$/)
              ? wordTimings[index - 1]?.start ?? word.start
              : word.start;
            addCallout(percentageCaption, start, 'whoosh', 'percentage');
          }
          const yearCaption = formatYearCaptionFromWords(wordTimings, index);
          if (yearCaption) addCallout(yearCaption, word.start, 'whoosh', 'year');
          const statisticCaption = formatStatisticCaption(wordTimings, index);
          if (statisticCaption) addCallout(statisticCaption, word.start, 'pop-up', 'statistic');
        });
      }

      timelineScenes.forEach((scene, index) => {
        const numberCaption = extractSceneNumberCaption(scene.text, timelineScenes[index + 1]?.text || '');
        if (numberCaption) addCallout(numberCaption, sceneStarts[scene.id] || 0, 'keyboard-typing', 'number');
      });

      const verticalPositionForCallout = (callout: typeof callouts[number]) => {
        const overlaps = callouts.filter((entry) => Math.abs(entry.start - callout.start) <= 0.45);
        const hasYear = overlaps.some((entry) => entry.kind === 'year');
        const hasMoney = overlaps.some((entry) => entry.kind === 'money');
        if (hasYear && hasMoney) {
          if (callout.kind === 'year') return 20;
          if (callout.kind === 'money') return 82;
        }
        if (callout.kind === 'year') return 24;
        if (callout.kind === 'money') return 80;
        if (callout.kind === 'percentage') return 74;
        if (callout.kind === 'statistic') return 68;
        return 72;
      };
      const newTextOverlays = callouts.map((callout, index): TextOverlay => ({
        id: createTimelineId(`text-rule-${index}`),
        text: callout.text,
        timelineStart: callout.start,
        duration: callout.effectId === 'keyboard-typing' ? 2.8 : 2,
        fontSize: callout.effectId === 'keyboard-typing' ? 46 : 62,
        color: '#f8efe1',
        backgroundColor: '#1d1510',
        positionX: 50,
        positionY: verticalPositionForCallout(callout),
      }));
      if (newTextOverlays.length > 0) {
        setTextOverlays((current) => mergeTextOverlays(current, newTextOverlays));
      }

      const plannedEffects = await Promise.all(callouts.map(async (callout, index) => {
        try {
          const preferredEffectId = historyVintageMode && callout.effectId === 'keyboard-typing'
            ? 'history-typewriter'
            : callout.effectId;
          const asset = availableSoundEffectLibrary.find((entry) => entry.id === preferredEffectId)
            || SOUND_EFFECT_LIBRARY.find((entry) => entry.id === callout.effectId);
          if (!asset) return null;
          const response = await fetch(asset.src);
          if (!response.ok) return null;
          const blob = await response.blob();
          const file = new File([blob], filenameFromPath(asset.src), { type: blob.type || 'audio/mpeg' });
          const sourceDuration = await getFileDuration(file);
          return {
            id: createTimelineId(`effect-rule-${asset.id}-${index}`),
            file,
            duration: Math.round(Math.max(0.1, Math.min(sourceDuration || 1.4, callout.effectId === 'clock-ticking' ? 2.2 : 1.5)) * 10) / 10,
            sourceStart: 0,
            timelineStart: callout.start,
            volume: callout.effectId === 'clock-ticking' ? 70 : callout.kind === 'number' ? 88 : 82,
          } satisfies TimelineSoundEffect;
        } catch (reason) {
          console.warn(`Could not add ${callout.effectId} effect:`, reason);
          return null;
        }
      }));
      const validEffects = plannedEffects.filter((effect): effect is TimelineSoundEffect => Boolean(effect));
      const cinematicTransitionEffects: TimelineSoundEffect[] = [];
      try {
        const whoosh = SOUND_EFFECT_LIBRARY.find((entry) => entry.id === 'whoosh');
        if (whoosh) {
          const response = await fetch(whoosh.src);
          if (response.ok) {
            const blob = await response.blob();
            const file = new File([blob], filenameFromPath(whoosh.src), { type: blob.type || 'audio/mpeg' });
            const sourceDuration = await getFileDuration(file);
            let lastStart = -999;
            timelineScenes.forEach((scene, index) => {
              const start = sceneStarts[scene.id] || 0;
              if (index === 0 || start - lastStart < 18 || scene.duration < 0.7) return;
              lastStart = start;
              cinematicTransitionEffects.push({
                id: createTimelineId(`effect-cinematic-whoosh-${index}`),
                file,
                duration: Math.round(Math.max(0.1, Math.min(sourceDuration || 0.8, 0.9)) * 10) / 10,
                sourceStart: 0,
                timelineStart: Math.max(0, Math.round((start - 0.12) * 10) / 10),
                volume: 50,
              });
            });
          }
        }
      } catch (reason) {
        console.warn('Could not add cinematic transition effects:', reason);
      }
      const allEffects = [...validEffects, ...cinematicTransitionEffects];
      if (allEffects.length > 0) {
        setSoundEffects((current) => mergeSoundEffects(current, allEffects));
        allEffects.forEach((effect) => {
          getAudioWaveform(effect.file, 36).then((waveform) => {
            setEffectWaveforms((current) => ({ ...current, [effect.id]: waveform }));
          });
        });
      }
      setMessage(
        `Added ${callouts.length} rule-based callout captions, ${validEffects.length} callout sound effects, and ${cinematicTransitionEffects.length} cinematic transition accents from the voiceover timing.`,
      );
    };

    applyInstructionCallouts().catch((error) => {
      console.warn('Instruction callouts failed:', error);
      setMessage('Caption callouts were added where possible, but some sound effects could not be loaded.');
    });
  }, [alignmentStatus, availableSoundEffectLibrary, createTimelineId, historyVintageMode, timelineScenes, wordTimings]);

  useEffect(() => {
    if (hasRepairedNumberCalloutsRef.current) return;
    if (alignmentStatus !== 'ready') return;
    if (wordTimings.length === 0 && timelineScenes.length === 0) return;
    hasRepairedNumberCalloutsRef.current = true;
    let cancelled = false;

    const repairNumberCallouts = async () => {
      const sceneStarts = timelineScenes.reduce<Record<number, number>>((starts, scene, index) => {
        const previous = index === 0 ? 0 : starts[timelineScenes[index - 1].id] + timelineScenes[index - 1].duration;
        const voiceStart = Number.isFinite(scene.narrationStart) ? Math.max(0, scene.narrationStart || 0) : previous;
        return { ...starts, [scene.id]: voiceStart };
      }, {});
      const callouts: Array<{ text: string; start: number }> = [];
      const seen = new Set<string>();
      const addNumberCallout = (text: string, start: number) => {
        const cleanText = text.replace(/\s+/g, ' ').trim().slice(0, 90);
        if (!cleanText || !Number.isFinite(start)) return;
        const roundedStart = Math.max(0, Math.round((start - 0.18) * 10) / 10);
        const key = `${cleanText.toLowerCase()}:${Math.round(roundedStart * 2) / 2}`;
        if (seen.has(key)) return;
        seen.add(key);
        callouts.push({ text: cleanText, start: roundedStart });
      };

      let consumedNumberListEndIndex = -1;
      wordTimings.forEach((_, index) => {
        if (index <= consumedNumberListEndIndex) return;
        const numberCaption = formatNumberListCaptionFromWords(wordTimings, index);
        if (!numberCaption) return;
        addNumberCallout(numberCaption.text, numberCaption.start);
        consumedNumberListEndIndex = numberCaption.endIndex;
      });
      timelineScenes.forEach((scene, index) => {
        const numberCaption = extractSceneNumberCaption(scene.text, timelineScenes[index + 1]?.text || '');
        if (numberCaption) addNumberCallout(numberCaption, sceneStarts[scene.id] || 0);
      });
      if (callouts.length === 0 || cancelled) return;

      const textRepairs = callouts.map((callout, index): TextOverlay => ({
        id: createTimelineId(`text-number-repair-${index}`),
        text: callout.text,
        timelineStart: callout.start,
        duration: 2.8,
        fontSize: 46,
        color: '#f8efe1',
        backgroundColor: '#1d1510',
        positionX: 50,
        positionY: 72,
      }));
      setTextOverlays((current) => {
        const merged = mergeTextOverlays(current, textRepairs);
        return merged.length === current.length ? current : merged;
      });

      const typewriterAsset = availableSoundEffectLibrary.find((entry) => (
        historyVintageMode ? entry.id === 'history-typewriter' : entry.id === 'keyboard-typing'
      )) || availableSoundEffectLibrary.find((entry) => entry.id === 'keyboard-typing');
      if (!typewriterAsset) return;
      const response = await fetch(typewriterAsset.src);
      if (!response.ok || cancelled) return;
      const blob = await response.blob();
      const file = new File([blob], filenameFromPath(typewriterAsset.src), { type: blob.type || 'audio/mpeg' });
      const sourceDuration = await getFileDuration(file);
      const effects = callouts.map((callout, index): TimelineSoundEffect => ({
        id: createTimelineId(`effect-number-typewriter-repair-${index}`),
        file,
        duration: Math.round(Math.max(0.5, Math.min(sourceDuration || 1.6, 1.8)) * 10) / 10,
        sourceStart: 0,
        timelineStart: callout.start,
        volume: 96,
      }));
      setSoundEffects((current) => {
        const merged = mergeSoundEffects(current, effects);
        return merged.length === current.length ? current : merged;
      });
      effects.forEach((effect) => {
        getAudioWaveform(effect.file, 36).then((waveform) => {
          setEffectWaveforms((current) => ({ ...current, [effect.id]: waveform }));
        });
      });
    };

    repairNumberCallouts().catch((reason) => {
      console.warn('Could not repair numbered callout sound effects:', reason);
    });
    return () => {
      cancelled = true;
    };
  }, [alignmentStatus, availableSoundEffectLibrary, createTimelineId, historyVintageMode, timelineScenes, wordTimings]);

  useEffect(() => {
    if (alignmentStatus !== 'ready' && textOverlays.length === 0) return;
    if (wordTimings.length === 0 && timelineScenes.length === 0 && textOverlays.length === 0) return;
    let cancelled = false;

    const ensureHardNumberingTypingSfx = async () => {
      const sceneStarts = timelineScenes.reduce<Record<number, number>>((starts, scene, index) => {
        const previous = index === 0 ? 0 : starts[timelineScenes[index - 1].id] + timelineScenes[index - 1].duration;
        const voiceStart = Number.isFinite(scene.narrationStart) ? Math.max(0, scene.narrationStart || 0) : previous;
        return { ...starts, [scene.id]: voiceStart };
      }, {});
      const targets: Array<{ text: string; start: number }> = [];
      const seen = new Set<string>();
      const addTarget = (text: string, start: number) => {
        if (!Number.isFinite(start)) return;
        const cleanText = text.replace(/\s+/g, ' ').trim().slice(0, 90);
        if (!cleanText) return;
        const roundedStart = Math.max(0, Math.round((start - 0.18) * 10) / 10);
        const key = `${cleanText.toLowerCase()}:${Math.round(roundedStart * 2) / 2}`;
        if (seen.has(key)) return;
        seen.add(key);
        targets.push({ text: cleanText, start: roundedStart });
      };

      let consumedNumberListEndIndex = -1;
      wordTimings.forEach((_, index) => {
        if (index <= consumedNumberListEndIndex) return;
        const numberCaption = formatNumberListCaptionFromWords(wordTimings, index);
        if (!numberCaption) return;
        addTarget(numberCaption.text, numberCaption.start);
        consumedNumberListEndIndex = numberCaption.endIndex;
      });
      timelineScenes.forEach((scene, index) => {
        const numberCaption = extractSceneNumberCaption(scene.text, timelineScenes[index + 1]?.text || '');
        if (numberCaption) addTarget(numberCaption, sceneStarts[scene.id] || 0);
      });
      textOverlays.forEach((overlay) => {
        if (isListNumberText(overlay.text)) addTarget(overlay.text, overlay.timelineStart);
      });

      if (targets.length === 0) return;
      if (!hasLoadedNumberingTypingAssetRef.current) {
        hasLoadedNumberingTypingAssetRef.current = (async () => {
          const asset = SOUND_EFFECT_LIBRARY.find((entry) => entry.id === 'keyboard-typing');
          if (!asset) return null;
          const response = await fetch(asset.src);
          if (!response.ok) return null;
          const blob = await response.blob();
          const file = new File([blob], 'keyboard-typing-numbering.mp3', { type: blob.type || 'audio/mpeg' });
          return { file, sourceDuration: await getFileDuration(file) };
        })();
      }
      const loaded = await hasLoadedNumberingTypingAssetRef.current;
      if (!loaded || cancelled) return;

      setSoundEffects((current) => {
        const incoming = targets
          .filter((target) => !current.some((effect) => (
            isKeyboardTypingEffectFile(effect.file)
            && Math.abs(effect.timelineStart - target.start) <= 0.5
          )))
          .map((target, index): TimelineSoundEffect => ({
            id: createTimelineId(`effect-numbering-keyboard-hard-${index}`),
            file: loaded.file,
            duration: Math.round(Math.max(0.6, Math.min(loaded.sourceDuration || 1.8, 1.8)) * 10) / 10,
            sourceStart: 0,
            timelineStart: target.start,
            volume: 100,
          }));
        if (incoming.length === 0) return current;
        incoming.forEach((effect) => {
          getAudioWaveform(effect.file, 36).then((waveform) => {
            setEffectWaveforms((waveforms) => ({ ...waveforms, [effect.id]: waveform }));
          });
        });
        setMessage(`Added ${incoming.length} keyboard typing SFX for numbered captions.`);
        return [...current, ...incoming];
      });
    };

    ensureHardNumberingTypingSfx().catch((reason) => {
      console.warn('Could not enforce numbering keyboard SFX:', reason);
    });

    return () => {
      cancelled = true;
    };
  }, [alignmentStatus, createTimelineId, textOverlays, timelineScenes, wordTimings]);

  useEffect(() => {
    if (hasRequestedEditPlanRef.current) return;
    if (initialVoiceOver && alignmentStatus === 'running') return;
    hasRequestedEditPlanRef.current = true;
    const deterministicCalloutsEnabled = true;
    const plannedSoundEffectsEnabled = trueCrimeMode || historyVintageMode;

    const applyClaudePlan = async () => {
      try {
        const sceneStarts = timelineScenes.reduce<Record<number, number>>((starts, scene, index) => {
          const previous = index === 0 ? 0 : starts[timelineScenes[index - 1].id] + timelineScenes[index - 1].duration;
          const voiceStart = Number.isFinite(scene.narrationStart) ? Math.max(0, scene.narrationStart || 0) : previous;
          return { ...starts, [scene.id]: voiceStart };
        }, {});
        const batches: VideoLabSourceScene[][] = [];
        for (let index = 0; index < timelineScenes.length; index += CLAUDE_EDIT_BATCH_SIZE) {
          batches.push(timelineScenes.slice(index, index + CLAUDE_EDIT_BATCH_SIZE));
        }

        for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
          const batch = batches[batchIndex];
          const batchStart = sceneStarts[batch[0].id] || 0;
          const batchEnd = batch.reduce((end, scene) => (
            Math.max(end, (sceneStarts[scene.id] || 0) + scene.duration)
          ), batchStart);
          setEditPlanStatus(`Claude edit batch ${batchIndex + 1}/${batches.length} running...`);
          const response = await fetch('/api/plan-edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              niche,
              editingInstructions,
              soundEffectAssets: availableSoundEffectLibrary.map((effect) => ({
                id: effect.id,
                label: effect.label,
                description: effect.description,
              })),
              scenes: batch.map((scene) => ({
                id: scene.id,
                text: scene.text,
                start: sceneStarts[scene.id] || 0,
                duration: scene.duration,
                asset: scene.asset,
              })),
              wordTimings: wordTimings.filter((word) => (
                word.start >= batchStart - 0.5 && word.end <= batchEnd + 0.5
              )),
            }),
          });
          const plan = await response.json() as ClaudeEditPlan | { error?: string };
          if (!response.ok || !('scenes' in plan)) {
            const message = 'error' in plan ? plan.error : 'Claude edit planning failed.';
            setEditPlanStatus(`Claude edit batch ${batchIndex + 1}/${batches.length} failed: ${message || 'request failed'}. Continuing...`);
            continue;
          }

          if (batchIndex === 0) {
            const preset = CANVAS_PRESETS.find((entry) => entry.ratio === plan.aspectRatio);
            if (preset) {
              setCanvasRatio(preset.ratio);
              setCanvasWidth(preset.width);
              setCanvasHeight(preset.height);
            }
            if (/^#[0-9a-f]{6}$/i.test(plan.canvasColor || '')) setCanvasColor(plan.canvasColor);
          }

          setClips((current) => current.map((clip, clipIndex) => {
            const scenePlan = plan.scenes.find((entry) => entry.sceneId === clip.sceneId);
            if (!scenePlan) return clip;
            const imageAsset = isImageAsset(clip.asset);
            const cinematicStill = historyVintageMode || trueCrimeMode;
            const startScale = imageAsset
              ? fitImageScale(scenePlan.startScale, cinematicStill, trueCrimeMode ? 122 : historyVintageMode ? 118 : undefined)
              : scenePlan.startScale;
            const endScale = imageAsset
              ? fitImageScale(scenePlan.endScale, cinematicStill, trueCrimeMode ? 122 : historyVintageMode ? 118 : undefined)
              : scenePlan.endScale;
            const startX = imageAsset ? fitImagePosition(scenePlan.startX) : scenePlan.startX;
            const endX = imageAsset ? fitImagePosition(scenePlan.endX) : scenePlan.endX;
            const startY = imageAsset ? fitImagePosition(scenePlan.startY) : scenePlan.startY;
            const endY = imageAsset ? fitImagePosition(scenePlan.endY) : scenePlan.endY;
            const rotation = imageAsset ? fitImageRotation(scenePlan.rotation) : scenePlan.rotation;
            const trueCrimeKeyframes = trueCrimeMode
              ? trueCrimeDarkKeyframes(clip.sceneId, clip.duration, clipIndex % 2 === 0 ? 1 : -1)
              : null;
            const plannedTransition = !historyVintageMode && (scenePlan.transition === 'screenburn' || scenePlan.transition === 'glitch')
              ? 'fade'
              : scenePlan.transition;
            return {
              ...clip,
              scale: startScale,
              positionX: startX,
              positionY: startY,
              rotation,
              brightness: trueCrimeMode ? Math.min(scenePlan.brightness, 86) : historyVintageMode ? Math.min(scenePlan.brightness, 94) : scenePlan.brightness,
              contrast: trueCrimeMode ? Math.max(scenePlan.contrast, 128) : historyVintageMode ? Math.max(scenePlan.contrast, 122) : scenePlan.contrast,
              saturation: trueCrimeMode ? Math.min(scenePlan.saturation, 52) : historyVintageMode ? Math.min(scenePlan.saturation, 62) : scenePlan.saturation,
              sepia: trueCrimeMode ? Math.min(scenePlan.sepia, 10) : historyVintageMode ? Math.max(scenePlan.sepia, 38) : scenePlan.sepia,
              transition: trueCrimeMode
                ? clipIndex === 0 ? 'none' : 'fade'
                : historyVintageMode
                  ? clipIndex === 0 ? 'none' : plannedTransition
                  : plannedTransition,
              keyframes: trueCrimeKeyframes || [
                {
                  id: `${clip.clipId}-claude-start`,
                  time: 0,
                  scale: startScale,
                  positionX: startX,
                  positionY: startY,
                  rotation,
                },
                {
                  id: `${clip.clipId}-claude-end`,
                  time: clip.duration,
                  scale: endScale,
                  positionX: endX,
                  positionY: endY,
                  rotation: imageAsset ? fitImageRotation(-rotation / 2) : -rotation / 2,
                },
              ],
            };
          }));

          if (!deterministicCalloutsEnabled && Array.isArray(plan.textOverlays) && plan.textOverlays.length > 0) {
            const plannedText = plan.textOverlays
              .map((overlay, index) => {
                const sceneStart = sceneStarts[overlay.sceneId];
                if (sceneStart === undefined || !overlay.text.trim()) return null;
                const timelineStart = Math.max(0, sceneStart + Math.max(0, overlay.startOffset || 0) - 0.35);
                return {
                  id: createTimelineId(`text-auto-${batchIndex}-${index}`),
                  text: overlay.text,
                  timelineStart: Math.round(timelineStart * 10) / 10,
                  duration: Math.max(0.4, overlay.duration || 2),
                  fontSize: overlay.fontSize ?? 56,
                  color: overlay.color ?? '#ffffff',
                  backgroundColor: overlay.backgroundColor ?? '#000000',
                  positionX: overlay.positionX ?? 50,
                  positionY: overlay.positionY ?? 78,
                } satisfies TextOverlay;
              })
              .filter((overlay): overlay is TextOverlay => Boolean(overlay));
            if (plannedText.length > 0) setTextOverlays((current) => mergeTextOverlays(current, plannedText));
          }

          if (plannedSoundEffectsEnabled && Array.isArray(plan.soundEffects) && plan.soundEffects.length > 0) {
            const plannedEffects = await Promise.all(plan.soundEffects.map(async (planned, index) => {
              const asset = availableSoundEffectLibrary.find((entry) => entry.id === planned.assetId);
              const sceneStart = sceneStarts[planned.sceneId];
              if (!asset || sceneStart === undefined) return null;
              const sceneIndex = batch.findIndex((scene) => scene.id === planned.sceneId);
              const scene = sceneIndex >= 0 ? batch[sceneIndex] : null;
              const numberedScene = scene
                ? Boolean(extractSceneNumberCaption(scene.text, batch[sceneIndex + 1]?.text || ''))
                : false;
              const typingAsset = asset.id === 'keyboard-typing' || asset.id === 'history-typewriter';
              if (numberedScene && !typingAsset && (planned.startOffset || 0) < 1) return null;
              const effectResponse = await fetch(asset.src);
              if (!effectResponse.ok) return null;
              const blob = await effectResponse.blob();
              const file = new File([blob], filenameFromPath(asset.src), { type: blob.type || 'audio/mpeg' });
              const sourceDuration = await getFileDuration(file);
              const timelineStart = Math.max(0, sceneStart + Math.max(0, planned.startOffset || 0) - 0.35);
              const duration = Math.max(
                0.1,
                Math.min(planned.duration || sourceDuration || 1.5, sourceDuration || 8),
              );
              return {
                id: createTimelineId(`effect-${asset.id}-auto-${batchIndex}-${index}`),
                file,
                duration: Math.round(duration * 10) / 10,
                sourceStart: 0,
                timelineStart,
                volume: Math.round(Math.min(100, Math.max(0, planned.volume || 75))),
              } satisfies TimelineSoundEffect;
            }));
            const validEffects = plannedEffects.filter((effect): effect is TimelineSoundEffect => Boolean(effect));
            if (validEffects.length > 0) {
              setSoundEffects((current) => mergeSoundEffects(current, validEffects));
              validEffects.forEach((effect) => {
                setEffectWaveforms((current) => ({ ...current, [effect.id]: [] }));
                getAudioWaveform(effect.file, 36).then((waveform) => {
                  setEffectWaveforms((current) => ({ ...current, [effect.id]: waveform }));
                });
              });
            }
          }

          setEditPlanStatus(`Claude edit batch ${batchIndex + 1}/${batches.length} applied.`);
        }
        setEditPlanStatus(`Claude automated edit applied for ${timelineScenes.length} scenes in ${batches.length} batches.`);
      } catch (error) {
        console.warn('Claude edit planning stopped:', error);
        setEditPlanStatus('Claude edit planning stopped. Batches already applied remain editable.');
      }
    };

    applyClaudePlan();
  }, [alignmentStatus, availableSoundEffectLibrary, createTimelineId, editingInstructions, historyVintageMode, initialVoiceOver, niche, timelineScenes, trueCrimeMode, wordTimings]);

  useEffect(() => {
    if (!historyVintageMode || hasAppliedHistoryReferenceFxRef.current || clipRanges.length === 0) return;
    if (initialVoiceOver && alignmentStatus === 'running') return;
    hasAppliedHistoryReferenceFxRef.current = true;
    let cancelled = false;

    const loadHistoryEffectFile = async (libraryIds: string[]) => {
      for (const libraryId of libraryIds) {
        const asset = availableSoundEffectLibrary.find((entry) => entry.id === libraryId);
        if (!asset) continue;
        const response = await fetch(asset.src);
        if (!response.ok) continue;
        const blob = await response.blob();
        const file = new File([blob], filenameFromPath(asset.src), { type: blob.type || 'audio/mpeg' });
        return { asset, file, sourceDuration: await getFileDuration(file) };
      }
      return null;
    };

    const applyHistoryReferenceTransitionFx = async () => {
      const [burnEffect, glitchEffect, slideEffect] = await Promise.all([
        loadHistoryEffectFile(['history-short-sweep', 'history-fast-whoosh', 'whoosh']),
        loadHistoryEffectFile(['history-sci-fi-sweep', 'history-technology-slide', 'history-cinematic-whoosh']),
        loadHistoryEffectFile(['history-transition-swoosh', 'history-cinematic-whoosh', 'whoosh']),
      ]);
      if (cancelled) return;
      const incoming: TimelineSoundEffect[] = [];
      clipRanges.forEach((range, index) => {
        if (index === 0 || range.start < 0.15) return;
        const transition = range.clip.transition;
        const effect = transition === 'screenburn'
          ? burnEffect
          : transition === 'glitch'
            ? glitchEffect
            : transition === 'slideleft' && index % 12 === 0 ? slideEffect : null;
        if (!effect) return;
        const targetDuration = transition === 'glitch' ? 0.45 : transition === 'screenburn' ? 0.75 : 0.55;
        incoming.push({
          id: createTimelineId(`effect-history-${transition}-${index}`),
          file: effect.file,
          duration: Math.round(Math.max(0.1, Math.min(effect.sourceDuration || targetDuration, targetDuration)) * 10) / 10,
          sourceStart: 0,
          timelineStart: Math.max(0, Math.round((range.start - 0.1) * 10) / 10),
          volume: transition === 'screenburn' ? 64 : transition === 'glitch' ? 58 : 48,
        });
      });
      if (incoming.length === 0) return;
      setSoundEffects((current) => mergeSoundEffects(current, incoming));
      incoming.forEach((effect) => {
        setEffectWaveforms((current) => ({ ...current, [effect.id]: [] }));
        getAudioWaveform(effect.file, 36).then((waveform) => {
          setEffectWaveforms((current) => ({ ...current, [effect.id]: waveform }));
        });
      });
    };

    applyHistoryReferenceTransitionFx().catch((reason) => {
      console.warn('Could not apply history reference transition SFX:', reason);
    });

    return () => {
      cancelled = true;
    };
  }, [alignmentStatus, availableSoundEffectLibrary, clipRanges, createTimelineId, historyVintageMode, initialVoiceOver]);

  useEffect(() => {
    selectedClipIdRef.current = selectedClipId;
  }, [selectedClipId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTextOverlays((current) => {
        const deduped = dedupeTextOverlays(current);
        return deduped.length === current.length ? current : deduped;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [textOverlays.length]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSoundEffects((current) => {
        const deduped = dedupeSoundEffects(current);
        return deduped.length === current.length ? current : deduped;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [soundEffects.length]);

  useEffect(() => {
    if (textOverlays.length === 0) return;
    let cancelled = false;

    const ensureCaptionCalloutSoundEffects = async () => {
      const calloutOverlays = textOverlays
        .map((overlay) => ({ overlay, kind: calloutEffectKindForText(overlay.text) }))
        .filter((entry): entry is { overlay: TextOverlay; kind: RuleCalloutEffectKind } => Boolean(entry.kind));
      if (calloutOverlays.length === 0) return;

      const hasMatchingEffect = (
        effects: TimelineSoundEffect[],
        overlay: TextOverlay,
        kind: RuleCalloutEffectKind,
      ) => effects.some((effect) => (
        effectFileMatchesCalloutKind(effect.file, kind)
        && Math.abs(effect.timelineStart - overlay.timelineStart) <= 0.42
      ));

      const missing = calloutOverlays.filter(({ overlay, kind }) => (
        !hasMatchingEffect(soundEffects, overlay, kind)
      ));
      if (missing.length === 0) return;

      const loadedEffects = new Map<string, Promise<{ file: File; sourceDuration: number } | null>>();
      const loadEffectForKind = async (kind: RuleCalloutEffectKind) => {
        const cacheKey = `${historyVintageMode ? 'history' : 'default'}:${kind}`;
        if (!loadedEffects.has(cacheKey)) {
          loadedEffects.set(cacheKey, (async () => {
            for (const id of preferredEffectIdsForCallout(kind, historyVintageMode)) {
              const asset = availableSoundEffectLibrary.find((entry) => entry.id === id)
                || SOUND_EFFECT_LIBRARY.find((entry) => entry.id === id);
              if (!asset) continue;
              const response = await fetch(asset.src);
              if (!response.ok) continue;
              const blob = await response.blob();
              const file = new File([blob], filenameFromPath(asset.src), { type: blob.type || 'audio/mpeg' });
              return { file, sourceDuration: await getFileDuration(file) };
            }
            return null;
          })());
        }
        return loadedEffects.get(cacheKey);
      };

      const incoming = await Promise.all(missing.map(async ({ overlay, kind }, index) => {
        const loaded = await loadEffectForKind(kind);
        if (!loaded || cancelled) return null;
        const maxDuration = calloutEffectMaxDuration(kind);
        return {
          kind,
          overlayStart: overlay.timelineStart,
          effect: {
            id: createTimelineId(`effect-callout-sync-${kind}-${index}`),
            file: loaded.file,
            duration: Math.round(Math.max(0.1, Math.min(loaded.sourceDuration || maxDuration, maxDuration)) * 10) / 10,
            sourceStart: 0,
            timelineStart: Math.max(0, Math.round((overlay.timelineStart - 0.04) * 100) / 100),
            volume: calloutEffectVolume(kind),
          } satisfies TimelineSoundEffect,
        };
      }));

      if (cancelled) return;
      const resolvedIncoming = incoming.filter((entry): entry is {
        kind: RuleCalloutEffectKind;
        overlayStart: number;
        effect: TimelineSoundEffect;
      } => Boolean(entry));
      if (resolvedIncoming.length === 0) return;

      setSoundEffects((current) => {
        const fresh = resolvedIncoming.filter(({ kind, overlayStart }) => (
          !current.some((effect) => (
            effectFileMatchesCalloutKind(effect.file, kind)
            && Math.abs(effect.timelineStart - overlayStart) <= 0.42
          ))
        ));
        if (fresh.length === 0) return current;
        return [...current, ...fresh.map(({ effect }) => effect)];
      });
      resolvedIncoming.forEach(({ effect }) => {
        getAudioWaveform(effect.file, 36).then((waveform) => {
          setEffectWaveforms((current) => ({ ...current, [effect.id]: waveform }));
        });
      });
      setMessage(`Repaired ${resolvedIncoming.length} missing caption sound effects from the visible callouts.`);
    };

    ensureCaptionCalloutSoundEffects().catch((reason) => {
      console.warn('Could not repair caption callout sound effects:', reason);
    });

    return () => {
      cancelled = true;
    };
  }, [availableSoundEffectLibrary, createTimelineId, historyVintageMode, soundEffects, textOverlays]);

  useEffect(() => {
    if (!historyVintageMode || textOverlays.length === 0) return;
    let cancelled = false;
    const applyHistorySoundDesign = async () => {
      const loadLibraryFile = async (libraryId: string) => {
        const asset = availableSoundEffectLibrary.find((entry) => entry.id === libraryId);
        if (!asset) return null;
        const response = await fetch(asset.src);
        if (!response.ok) return null;
        const blob = await response.blob();
        return new File([blob], filenameFromPath(asset.src), { type: blob.type || 'audio/mpeg' });
      };
      const loadFirstAvailableLibraryFile = async (libraryIds: string[]) => {
        for (const libraryId of libraryIds) {
          const file = await loadLibraryFile(libraryId);
          if (file) return file;
        }
        return null;
      };
      const [typewriterFile, paperFile, cameraFile] = await Promise.all([
        loadFirstAvailableLibraryFile(['history-typewriter', 'keyboard-typing']),
        loadFirstAvailableLibraryFile(['history-paper-crumple', 'history-paper-cut', 'mouse-click']),
        loadFirstAvailableLibraryFile(['history-camera-shutter-flash', 'history-camera-shutter', 'pop-up']),
      ]);
      if (cancelled) return;
      setSoundEffects((current) => {
        const sortedOverlays = [...textOverlays]
          .filter((overlay) => overlay.text.trim())
          .sort((left, right) => left.timelineStart - right.timelineStart);
        const listOverlays = sortedOverlays.filter((overlay) => isListNumberText(overlay.text));
        const existing = current.filter((effect) => !(
          isBlockedNumberingEffectFile(effect.file)
          && !isKeyboardTypingEffectFile(effect.file)
          && listOverlays.some((overlay) => Math.abs(effect.timelineStart - overlay.timelineStart) <= 0.45)
        ));
        const incoming: TimelineSoundEffect[] = [];
        const hasEffectNear = (file: File, start: number, tolerance = 0.25) => (
          [...existing, ...incoming].some((effect) => (
            effect.file.name === file.name
            && Math.abs(effect.timelineStart - start) <= tolerance
          ))
        );

        sortedOverlays.forEach((overlay, index) => {
          const isList = isListNumberText(overlay.text);
          const hasListAtSameTime = listOverlays.some((listOverlay) => (
            Math.abs(listOverlay.timelineStart - overlay.timelineStart) <= 0.35
          ));
          if (!isList && hasListAtSameTime) return;
          if (!isList && isMoneyOrStatText(overlay.text)) return;
          const accentFiles = [paperFile, cameraFile].filter((file): file is File => Boolean(file));
          const file = isList
            ? typewriterFile
            : accentFiles[index % Math.max(1, accentFiles.length)];
          if (!file) return;
          const start = Math.max(0, Math.round((overlay.timelineStart - 0.04) * 100) / 100);
          if (isList && hasEffectNear(file, start, 0.45)) return;
          if (!isList && hasEffectNear(file, start)) return;
          incoming.push({
            id: createTimelineId(`effect-history-${isList ? 'typewriter' : 'click'}-${index}`),
            file,
            duration: isList ? 0.5 : 0.35,
            sourceStart: 0,
            timelineStart: start,
            volume: isList ? 88 : 72,
          });
        });

        return incoming.length > 0 || existing.length !== current.length ? [...existing, ...incoming] : current;
      });
    };
    applyHistorySoundDesign().catch((reason) => {
      console.warn('Could not apply history vintage sound design:', reason);
    });
    return () => {
      cancelled = true;
    };
  }, [availableSoundEffectLibrary, createTimelineId, historyVintageMode, textOverlays]);

  useEffect(() => {
    if (!initialVoiceOver || audioWaveform.length > 0) return;
    getAudioWaveform(initialVoiceOver.file).then((waveform) => {
      setAudioWaveform(waveform);
    });
  }, [audioWaveform.length, initialVoiceOver]);

  useEffect(() => {
    if (!initialVoiceOver) return;
    if (hasRequestedAlignmentRef.current) return;
    hasRequestedAlignmentRef.current = true;
    if (initialVoiceOver.words?.length) {
      const reliableDuration = initialVoiceOver.words[initialVoiceOver.words.length - 1]?.end || initialVoiceOver.duration || 0;
      setWordTimings(initialVoiceOver.words);
      setAlignedVoiceOverDuration(reliableDuration);
      setAudioTrack((current) => (current && reliableDuration > 0
        ? { ...current, duration: Math.round(reliableDuration * 10) / 10 }
        : current));
      setAlignmentStatus('ready');
      setMessage('Voiceover word timings loaded from the original storyboard transcription.');
      return;
    }

    const alignVoiceOver = async () => {
      setAlignmentStatus('running');
      try {
        const formData = new FormData();
        formData.append('audio', initialVoiceOver.file);
        formData.append('duration', String(initialVoiceOver.duration || storyboardDuration || contentDuration));
        formData.append('timingSource', 'audio');
        formData.append('script', timelineScenes.map((scene) => scene.text).join(' '));
        const response = await fetch('/api/align-voiceover', {
          method: 'POST',
          body: formData,
        });
        const data = await response.json() as {
          mode?: string;
          provider?: string;
          words?: WordTiming[];
          durationSeconds?: number;
          warning?: string;
        };
        if (!response.ok || !Array.isArray(data.words)) {
          throw new Error('Voiceover alignment failed.');
        }
        const transcriptDuration = typeof data.durationSeconds === 'number' ? data.durationSeconds : 0;
        const finalWordDuration = data.words[data.words.length - 1]?.end || 0;
        const measuredDuration = Math.max(transcriptDuration, finalWordDuration);
        const reliableDuration = measuredDuration;
        if (reliableDuration > 0) {
          setAlignedVoiceOverDuration(reliableDuration);
          setAudioTrack((current) => {
            if (!current) return current;
            if (Math.abs(current.duration - reliableDuration) < 1) return current;
            return { ...current, duration: Math.round(reliableDuration * 10) / 10 };
          });
        }
        setWordTimings(data.words);
        setAlignmentStatus('ready');
        setMessage(
          data.mode === 'transcribed'
            ? `Voiceover word timings loaded from ${data.provider}.`
            : data.warning || 'Estimated voiceover word timings loaded.',
        );
      } catch (error) {
        console.warn('Voiceover alignment failed:', error);
        setAlignmentStatus('failed');
        setMessage('Voiceover alignment failed. Claude will use scene timing only.');
      }
    };

    alignVoiceOver();
  }, [contentDuration, initialVoiceOver, storyboardDuration, timelineScenes]);

  useEffect(() => {
    if (alignmentStatus !== 'ready' || timelineScenes.length === 0) return;
    const timer = window.setTimeout(() => {
      const defaultClips = createClips(timelineScenes, editorStylePreset);
      const defaultClipsByScene = new Map(defaultClips.map((clip) => [clip.sceneId, clip]));

      setClips((current) => {
        const currentClipsByScene = new Map(current.map((clip) => [clip.sceneId, clip]));
        const synced = timelineScenes
          .map((scene) => {
            const defaultClip = defaultClipsByScene.get(scene.id);
            const baseClip = currentClipsByScene.get(scene.id) || defaultClip;
            if (!baseClip) return null;
            const duration = Math.max(0.1, Math.round(scene.duration * 10) / 10);
            const asset = safeSceneAsset(scene);
            const alternatives = (scene.alternatives || [scene.asset])
              .filter((candidate) => !isVisuallyUnsafeForScene(candidate, {
                sceneText: scene.text,
                query: scene.text,
                visualConcept: scene.asset.description || scene.asset.title,
              }));
            const sourceKeyframes = baseClip.keyframes.length > 0
              ? baseClip.keyframes
              : defaultClip?.keyframes || [];
            const keyframes = sourceKeyframes.map((keyframe, index, keyframeList) => ({
              ...keyframe,
              time: index === keyframeList.length - 1
                ? duration
                : Math.min(keyframe.time, duration),
            }));

            return {
              ...baseClip,
              clipId: baseClip.clipId || `scene-${scene.id}`,
              sceneId: scene.id,
              text: scene.text,
              asset,
              alternatives: alternatives.length > 0 ? alternatives : [asset],
              duration,
              sourceStart: scene.clipStart,
              keyframes,
            };
          })
          .filter((clip): clip is EditorClip => Boolean(clip));

        const changed = current.length !== synced.length || synced.some((clip, index) => {
          const existing = current[index];
          if (!existing) return true;
          const existingFinalKeyframe = existing.keyframes[existing.keyframes.length - 1];
          const clipFinalKeyframe = clip.keyframes[clip.keyframes.length - 1];
          return existing.sceneId !== clip.sceneId
            || existing.text !== clip.text
            || existing.asset.id !== clip.asset.id
            || existing.asset.downloadUrl !== clip.asset.downloadUrl
            || Math.abs(existing.duration - clip.duration) > 0.05
            || Math.abs(existing.sourceStart - clip.sourceStart) > 0.05
            || Math.abs((existingFinalKeyframe?.time || 0) - (clipFinalKeyframe?.time || 0)) > 0.05;
        });

        return changed ? synced : current;
      });
      setSelectedClipId((current) => (
        timelineScenes.some((scene) => `scene-${scene.id}` === current)
          ? current
          : `scene-${timelineScenes[0]?.id}`
      ));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [alignmentStatus, editorStylePreset, timelineScenes]);

  useEffect(() => () => {
    if (backgroundAudioUrl) URL.revokeObjectURL(backgroundAudioUrl);
  }, [backgroundAudioUrl]);

  useEffect(() => () => {
    if (backgroundMusicUrl) URL.revokeObjectURL(backgroundMusicUrl);
  }, [backgroundMusicUrl]);

  useEffect(() => () => {
    backgroundMusicUrls.forEach((track) => URL.revokeObjectURL(track.url));
  }, [backgroundMusicUrls]);

  useEffect(() => () => {
    if (exportedVideo) URL.revokeObjectURL(exportedVideo.url);
  }, [exportedVideo]);

  useEffect(() => () => {
    soundEffectUrls.forEach((effect) => URL.revokeObjectURL(effect.url));
  }, [soundEffectUrls]);

  useEffect(() => {
    localMediaAssetsRef.current = localMediaAssets;
  }, [localMediaAssets]);

  useEffect(() => () => {
    localMediaAssetsRef.current.forEach((entry) => {
      if (entry.asset.downloadUrl.startsWith('blob:')) URL.revokeObjectURL(entry.asset.downloadUrl);
    });
  }, []);

  useEffect(() => {
    const nextSnapshot = {
      clips,
      audioTrack,
      musicTrack,
      musicTracks,
      textOverlays,
      soundEffects,
      canvasColor,
      canvasRatio,
      canvasWidth,
      canvasHeight,
    };
    const previousSnapshot = lastProjectRef.current;
    if (
      previousSnapshot.clips === clips
      && previousSnapshot.audioTrack === audioTrack
      && previousSnapshot.musicTrack === musicTrack
      && previousSnapshot.musicTracks === musicTracks
      && previousSnapshot.textOverlays === textOverlays
      && previousSnapshot.soundEffects === soundEffects
      && previousSnapshot.canvasColor === canvasColor
      && previousSnapshot.canvasRatio === canvasRatio
      && previousSnapshot.canvasWidth === canvasWidth
      && previousSnapshot.canvasHeight === canvasHeight
    ) return;
    lastProjectRef.current = nextSnapshot;
    if (restoringHistoryRef.current) {
      restoringHistoryRef.current = false;
      return;
    }
    if (!pendingHistoryRef.current) pendingHistoryRef.current = previousSnapshot;
    redoRef.current = [];
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current);
    historyTimerRef.current = window.setTimeout(() => {
      if (!pendingHistoryRef.current) return;
      historyRef.current = [...historyRef.current, pendingHistoryRef.current].slice(-60);
      pendingHistoryRef.current = null;
      setCanUndo(true);
      setCanRedo(false);
    }, 180);
  }, [audioTrack, canvasColor, canvasHeight, canvasRatio, canvasWidth, clips, musicTrack, musicTracks, soundEffects, textOverlays]);

  useEffect(() => () => {
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isPlaying) return undefined;
    let lastTick = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      const deltaSeconds = (now - lastTick) / 1000;
      lastTick = now;
      setPlayheadTime((current) => {
        const nextTime = Math.min(contentDuration, current + deltaSeconds);
        if (nextTime >= contentDuration) window.setTimeout(() => setIsPlaying(false), 0);
        const range = clipRanges.find((clipRange) => (
          nextTime >= clipRange.start && nextTime < clipRange.end
        )) || clipRanges[clipRanges.length - 1];
        if (range && selectedClipIdRef.current !== range.clip.clipId) {
          selectedClipIdRef.current = range.clip.clipId;
          window.setTimeout(() => setSelectedClipId(range.clip.clipId), 0);
        }
        return nextTime;
      });
    }, 100);
    return () => window.clearInterval(interval);
  }, [clipRanges, contentDuration, isPlaying]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioTrack) return;
    audio.volume = audioMuted ? 0 : audioTrack.volume / 100;
    const withinAudio = playheadTime >= audioTrack.timelineStart
      && playheadTime < audioTrack.timelineStart + audioTrack.duration;
    const desiredTime = audioTrack.sourceStart + playheadTime - audioTrack.timelineStart;
    if (!isPlaying && withinAudio && Math.abs(audio.currentTime - desiredTime) > 0.08) {
      audio.currentTime = Math.max(0, desiredTime);
    }
    if (isPlaying && withinAudio) {
      audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, [audioMuted, audioTrack, isPlaying, playheadTime]);

  useEffect(() => {
    const audio = musicRef.current;
    if (!audio || !musicTrack) return;
    const musicSourceDuration = Math.max(0.1, musicTrack.sourceDuration || audio.duration || musicTrack.duration);
    audio.volume = musicMuted ? 0 : musicTrack.volume / 100;
    const withinMusic = playheadTime >= musicTrack.timelineStart
      && playheadTime < musicTrack.timelineStart + musicTrack.duration;
    const desiredTime = (musicTrack.sourceStart + playheadTime - musicTrack.timelineStart) % musicSourceDuration;
    if (withinMusic && Math.abs(audio.currentTime - desiredTime) > 0.3) {
      audio.currentTime = Math.max(0, desiredTime);
    }
    if (isPlaying && withinMusic) {
      audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, [isPlaying, musicMuted, musicTrack, playheadTime]);

  useEffect(() => {
    musicTracks.forEach((track, index) => {
      const key = track.id || `music-${index}`;
      const audio = musicRefs.current[key];
      if (!audio) return;
      const musicSourceDuration = Math.max(0.1, track.sourceDuration || audio.duration || track.duration);
      audio.volume = musicMuted ? 0 : track.volume / 100;
      const withinMusic = playheadTime >= track.timelineStart
        && playheadTime < track.timelineStart + track.duration;
      const desiredTime = track.loop
        ? (track.sourceStart + playheadTime - track.timelineStart) % musicSourceDuration
        : track.sourceStart + playheadTime - track.timelineStart;
      if (withinMusic && Math.abs(audio.currentTime - desiredTime) > 0.3) {
        audio.currentTime = Math.max(0, desiredTime);
      }
      if (isPlaying && withinMusic) {
        audio.play().catch(() => undefined);
      } else {
        audio.pause();
      }
    });
  }, [isPlaying, musicMuted, musicTracks, playheadTime]);

  useEffect(() => {
    soundEffects.forEach((effect) => {
      const audio = effectRefs.current[effect.id];
      if (!audio) return;
      const withinEffect = playheadTime >= effect.timelineStart
        && playheadTime < effect.timelineStart + effect.duration;
      audio.volume = effectsMuted ? 0 : effect.volume / 100;
      const desiredTime = effect.sourceStart + playheadTime - effect.timelineStart;
      if (withinEffect && Math.abs(audio.currentTime - desiredTime) > 0.2) {
        audio.currentTime = Math.max(0, desiredTime);
      }
      if (isPlaying && withinEffect) {
        audio.play().catch(() => undefined);
      } else {
        audio.pause();
      }
    });
  }, [effectsMuted, isPlaying, playheadTime, soundEffects]);

  const updateClip = (update: Partial<EditorClip>) => {
    setClips((current) => current.map((clip, index) => (
      index === selectedIndex ? { ...clip, ...update } : clip
    )));
  };

  const updateTransform = (update: Partial<TransformKeyframe>) => {
    if (selectedKeyframe) {
      updateClip({
        keyframes: selectedClip.keyframes.map((keyframe) => (
          keyframe.id === selectedKeyframe.id ? { ...keyframe, ...update } : keyframe
        )),
      });
      return;
    }
    updateClip(update as Partial<EditorClip>);
  };

  const loadBackgroundMusic = useCallback(async (
    asset: BackgroundMusicAsset,
    options: { silent?: boolean } = {},
  ) => {
    const response = await fetch(asset.src);
    if (!response.ok) throw new Error(`Could not load ${asset.label}.`);
    const blob = await response.blob();
    const file = new File([blob], filenameFromPath(asset.src), { type: blob.type || 'audio/mpeg' });
    const sourceDuration = await getFileDuration(file);
    const duration = Math.max(0.5, voiceoverTimelineEnd || visualDuration || contentDuration || sourceDuration || 5);
    setMusicTrack({
      file,
      duration: Math.round(duration * 10) / 10,
      sourceDuration: Math.max(0.5, sourceDuration || duration),
      sourceStart: 0,
      timelineStart: 0,
      volume: 8,
      label: asset.label,
      loop: true,
    });
    setMusicTracks([]);
    setMusicWaveforms({});
    setMusicWaveform([]);
    getAudioWaveform(file, 72).then(setMusicWaveform);
    setSelectedTrack('music');
    if (!options.silent) setMessage(`${asset.label} added as looping background music.`);
  }, [contentDuration, visualDuration, voiceoverTimelineEnd]);

  const applyAutoBackgroundMusicPlaylist = useCallback(async (
    library: BackgroundMusicAsset[],
    messageText: string,
  ) => {
    const targetDuration = Math.max(
      0.5,
      voiceoverTimelineEnd || storyboardDuration || visualDuration || contentDuration || 5,
    );
    const loadedAssets = (await Promise.all(library.map(async (asset) => {
      const response = await fetch(asset.src);
      if (!response.ok) return null;
      const blob = await response.blob();
      const file = new File([blob], filenameFromPath(asset.src), { type: blob.type || 'audio/mpeg' });
      const sourceDuration = Math.max(0.5, await getFileDuration(file));
      return { asset, file, sourceDuration };
    }))).filter((entry): entry is { asset: BackgroundMusicAsset; file: File; sourceDuration: number } => Boolean(entry));

    if (loadedAssets.length === 0) {
      throw new Error('No background music files could be loaded.');
    }

    const tracks: EditorAudio[] = [];
    let cursor = 0;
    let index = 0;
    while (cursor < targetDuration - 0.05 && tracks.length < 80) {
      const entry = loadedAssets[index % loadedAssets.length];
      const remaining = targetDuration - cursor;
      const duration = Math.max(0.5, Math.min(entry.sourceDuration, remaining));
      tracks.push({
        id: createTimelineId(`music-${entry.asset.id}`),
        file: entry.file,
        duration: Math.round(duration * 10) / 10,
        sourceDuration: entry.sourceDuration,
        sourceStart: 0,
        timelineStart: Math.round(cursor * 10) / 10,
        volume: autoMusicVolumeForNiche(niche),
        label: entry.asset.label,
        loop: false,
      });
      cursor += duration;
      index += 1;
    }

    setMusicTrack(null);
    setMusicWaveform([]);
    setMusicTracks(tracks);
    setMusicWaveforms({});
    tracks.slice(0, 8).forEach((track) => {
      const key = track.id || track.file.name;
      getAudioWaveform(track.file, 48).then((waveform) => {
        setMusicWaveforms((current) => ({ ...current, [key]: waveform }));
      });
    });
    setSelectedTrack('music');
    setMessage(`${messageText} ${tracks.length} music bed${tracks.length === 1 ? '' : 's'} cover ${formatTime(targetDuration)}.`);
  }, [contentDuration, createTimelineId, niche, storyboardDuration, visualDuration, voiceoverTimelineEnd]);

  const handleBackgroundAudio = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const duration = await getFileDuration(file);
    setAudioWaveform(await getAudioWaveform(file));
    setAudioTrack({
      file,
      duration: Math.max(0.5, duration || contentDuration || 5),
      sourceDuration: Math.max(0.5, duration || contentDuration || 5),
      sourceStart: 0,
      timelineStart: 0,
      volume: 100,
      label: 'Voiceover',
    });
    setSelectedTrack('audio');
  };

  const handleBackgroundMusic = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const sourceDuration = await getFileDuration(file);
    const duration = Math.max(0.5, voiceoverTimelineEnd || visualDuration || contentDuration || sourceDuration || 5);
    setMusicTrack({
      file,
      duration: Math.round(duration * 10) / 10,
      sourceDuration: Math.max(0.5, sourceDuration || duration),
      sourceStart: 0,
      timelineStart: 0,
      volume: 8,
      label: file.name,
      loop: true,
    });
    setMusicTracks([]);
    setMusicWaveforms({});
    setMusicWaveform(await getAudioWaveform(file, 72));
    setSelectedTrack('music');
    event.target.value = '';
  };

  useEffect(() => {
    if (!historyVintageMode || hasAppliedHistoryMusicRef.current || musicTrack || musicTracks.length > 0) return;
    if (!voiceoverTimelineEnd && !visualDuration && !contentDuration) return;
    hasAppliedHistoryMusicRef.current = true;
    let cancelled = false;
    let retryTimer: number | null = null;
    let attempts = 0;
    const applyMusic = () => {
      attempts += 1;
      applyAutoBackgroundMusicPlaylist(getAutoBackgroundMusicLibrary(niche), 'History documentary background music added automatically.')
        .then(() => {
          if (!cancelled) hasAppliedHistoryMusicRef.current = true;
        })
        .catch((reason) => {
          console.warn('Could not apply history background music:', reason);
          if (cancelled) return;
          if (attempts < 3) {
            retryTimer = window.setTimeout(applyMusic, 1200);
            return;
          }
          setMessage('History background music could not be loaded automatically. Use Regenerate auto music in the Music track.');
        });
    };
    const timer = window.setTimeout(() => {
      applyMusic();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [applyAutoBackgroundMusicPlaylist, contentDuration, historyVintageMode, musicTrack, musicTracks.length, niche, visualDuration, voiceoverTimelineEnd]);

  useEffect(() => {
    if (!trueCrimeMode || hasAppliedTrueCrimeMusicRef.current || musicTrack || musicTracks.length > 0) return;
    if (!voiceoverTimelineEnd && !visualDuration && !contentDuration) return;
    hasAppliedTrueCrimeMusicRef.current = true;
    let cancelled = false;
    let retryTimer: number | null = null;
    let attempts = 0;
    const applyMusic = () => {
      attempts += 1;
      applyAutoBackgroundMusicPlaylist(getAutoBackgroundMusicLibrary(niche), 'True-crime background music added automatically.')
        .then(() => {
          if (!cancelled) hasAppliedTrueCrimeMusicRef.current = true;
        })
        .catch((reason) => {
          console.warn('Could not apply true-crime background music:', reason);
          if (cancelled) return;
          if (attempts < 3) {
            retryTimer = window.setTimeout(applyMusic, 1200);
            return;
          }
          setMessage('True-crime background music could not be loaded automatically. Use Regenerate auto music in the Music track.');
        });
    };
    const timer = window.setTimeout(() => {
      applyMusic();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [applyAutoBackgroundMusicPlaylist, contentDuration, musicTrack, musicTracks.length, niche, trueCrimeMode, visualDuration, voiceoverTimelineEnd]);

  const handleTimelineSoundEffect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const sourceDuration = await getFileDuration(file);
    const timelineStart = Math.max(0, playheadTime);
    const duration = Math.max(0.1, sourceDuration || 2);
    const effect: TimelineSoundEffect = {
      id: createTimelineId('effect'),
      file,
      duration: Math.round(duration * 10) / 10,
      sourceStart: 0,
      timelineStart,
      volume: 100,
    };
    setSoundEffects((current) => [...current, effect]);
    setEffectWaveforms((current) => ({ ...current, [effect.id]: [] }));
    getAudioWaveform(file, 36).then((waveform) => {
      setEffectWaveforms((current) => ({ ...current, [effect.id]: waveform }));
    });
    setSelectedEffectId(effect.id);
    setSelectedTrack('effect');
    event.target.value = '';
  };

  const createLocalMediaAsset = async (file: File): Promise<LocalMediaAsset | null> => {
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    if (!isVideo && !isImage) return null;

    const url = URL.createObjectURL(file);
    const asset: ResultItem = {
      id: createTimelineId('local-media'),
      source: 'Local Upload',
      title: file.name,
      type: isVideo ? 'video' : 'image',
      thumbnail: url,
      downloadUrl: url,
      description: 'Imported from your storage.',
      tags: ['local', 'imported'],
    };
    return { asset, file };
  };

  const addAlternativeToSelectedClip = (asset: ResultItem) => {
    updateClip({
      alternatives: Array.from(
        new Map([...selectedClip.alternatives, asset].map((entry) => [entry.id, entry])).values(),
      ),
    });
  };

  const importLocalMedia = async (
    event: ChangeEvent<HTMLInputElement>,
    mode: 'library' | 'replace' | 'insert',
  ) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (files.length === 0) return;

    const imported = (await Promise.all(files.map(createLocalMediaAsset))).filter(Boolean) as LocalMediaAsset[];
    if (imported.length === 0) {
      setMessage('Choose image or video files to import.');
      return;
    }

    setLocalMediaAssets((current) => [...current, ...imported]);

    if (mode === 'replace') {
      const first = imported[0].asset;
      updateClip({
        asset: first,
        alternatives: Array.from(
          new Map([...selectedClip.alternatives, ...imported.map((entry) => entry.asset)].map((entry) => [entry.id, entry])).values(),
        ),
        sourceStart: 0,
      });
      setSelectedTrack('visual');
      setMessage(`${first.title} replaced the selected clip.`);
      return;
    }

    if (mode === 'insert') {
      const insertionIndex = Math.max(0, playheadClipIndex >= 0 ? playheadClipIndex + 1 : selectedIndex + 1);
      const newClips = await Promise.all(imported.map(async ({ asset, file }, index) => {
        const sourceDuration = asset.type === 'video' ? await getVideoFileDuration(file) : 0;
        const duration = Math.max(0.5, Math.round((sourceDuration || selectedClip.duration || 5) * 10) / 10);
        const clip: EditorClip = {
          ...selectedClip,
          clipId: createTimelineId(`local-clip-${index}`),
          sceneId: Date.now() + index,
          text: asset.title,
          asset,
          alternatives: [asset],
          duration,
          sourceStart: 0,
          keyframes: selectedClip.keyframes.map((keyframe) => ({
            ...keyframe,
            id: createTimelineId(`${keyframe.id}-local`),
            time: Math.min(keyframe.time, duration),
          })),
          transition: insertionIndex === 0 && index === 0 ? 'none' : 'fade',
        };
        return clip;
      }));
      setClips((current) => [
        ...current.slice(0, insertionIndex),
        ...newClips,
        ...current.slice(insertionIndex),
      ]);
      setSelectedTrack('visual');
      setSelectedClipId(newClips[0].clipId);
      setMessage(`${newClips.length} local media file${newClips.length === 1 ? '' : 's'} inserted.`);
      return;
    }

    imported.forEach((entry) => addAlternativeToSelectedClip(entry.asset));
    setMessage(`${imported.length} local media file${imported.length === 1 ? '' : 's'} added to Assets.`);
  };

  const addLibrarySoundEffect = async (
    libraryId: string,
    options: { timelineStart?: number; duration?: number; volume?: number } = {},
  ) => {
    const asset = availableSoundEffectLibrary.find((entry) => entry.id === libraryId);
    if (!asset) return null;
    const response = await fetch(asset.src);
    if (!response.ok) throw new Error(`Could not load ${asset.label}.`);
    const blob = await response.blob();
    const file = new File([blob], filenameFromPath(asset.src), { type: blob.type || 'audio/mpeg' });
    const sourceDuration = await getFileDuration(file);
    const timelineStart = Math.min(
      Math.max(0, options.timelineStart ?? playheadTime),
      Math.max(0, timelineDuration - 0.1),
    );
    const availableDuration = Math.max(0.1, timelineDuration - timelineStart);
    const requestedDuration = options.duration ?? (sourceDuration || 2);
    const duration = Math.max(0.1, Math.min(requestedDuration, availableDuration));
    const effect: TimelineSoundEffect = {
      id: createTimelineId(`effect-${asset.id}`),
      file,
      duration: Math.round(duration * 10) / 10,
      sourceStart: 0,
      timelineStart,
      volume: Math.round(Math.min(100, Math.max(0, options.volume ?? 85))),
    };
    setSoundEffects((current) => [...current, effect]);
    setEffectWaveforms((current) => ({ ...current, [effect.id]: [] }));
    getAudioWaveform(file, 36).then((waveform) => {
      setEffectWaveforms((current) => ({ ...current, [effect.id]: waveform }));
    });
    setSelectedEffectId(effect.id);
    setSelectedTrack('effect');
    return effect;
  };

  const addTextAtPlayhead = (preset: Partial<TextOverlay> = {}) => {
    const timelineStart = Math.min(playheadTime, Math.max(0, timelineDuration - 0.5));
    const overlay: TextOverlay = {
      id: createTimelineId('text'),
      text: 'Text',
      timelineStart,
      duration: Math.min(3, Math.max(0.5, timelineDuration - timelineStart)),
      fontSize: 44,
      color: '#ffffff',
      backgroundColor: '#000000',
      positionX: 50,
      positionY: 88,
      ...preset,
    };
    setTextOverlays((current) => [...current, overlay]);
    setSelectedTextId(overlay.id);
    setSelectedTrack('text');
    setMessage('Text added at the playhead.');
  };

  const previewFromStart = () => {
    seekTimeline(0);
    setIsPlaying(true);
    if (audioRef.current && audioTrack) audioRef.current.currentTime = audioTrack.sourceStart;
    if (musicRef.current && musicTrack) musicRef.current.currentTime = musicTrack.sourceStart;
    musicTracks.forEach((track, index) => {
      const audio = musicRefs.current[track.id || `music-${index}`];
      if (audio) audio.currentTime = track.sourceStart;
    });
  };

  const playFromPlayhead = () => {
    const startTime = playheadTime >= timelineDuration ? 0 : playheadTime;
    seekTimeline(startTime);
    setIsPlaying(true);
    if (audioRef.current && audioTrack) {
      const withinAudio = startTime >= audioTrack.timelineStart
        && startTime < audioTrack.timelineStart + audioTrack.duration;
      if (withinAudio) {
        audioRef.current.currentTime = Math.max(0, audioTrack.sourceStart + startTime - audioTrack.timelineStart);
      }
    }
    if (musicRef.current && musicTrack) {
      const withinMusic = startTime >= musicTrack.timelineStart
        && startTime < musicTrack.timelineStart + musicTrack.duration;
      const musicSourceDuration = Math.max(0.1, musicTrack.sourceDuration || musicTrack.duration);
      if (withinMusic) {
        musicRef.current.currentTime = Math.max(0, (musicTrack.sourceStart + startTime - musicTrack.timelineStart) % musicSourceDuration);
      }
    }
    musicTracks.forEach((track, index) => {
      const audio = musicRefs.current[track.id || `music-${index}`];
      if (!audio) return;
      const withinMusic = startTime >= track.timelineStart
        && startTime < track.timelineStart + track.duration;
      const musicSourceDuration = Math.max(0.1, track.sourceDuration || track.duration);
      if (withinMusic) {
        audio.currentTime = Math.max(0, track.loop
          ? (track.sourceStart + startTime - track.timelineStart) % musicSourceDuration
          : track.sourceStart + startTime - track.timelineStart);
      }
    });
  };

  const pausePreview = () => {
    setIsPlaying(false);
  };

  const togglePlayback = () => {
    if (isPlaying) {
      pausePreview();
    } else {
      playFromPlayhead();
    }
  };

  const seekTimeline = (time: number) => {
    const nextTime = Math.min(timelineDuration, Math.max(0, time));
    if (nextTime > timelineDuration - 10) {
      setTimelineExtraSeconds((current) => current + 60);
    }
    setPlayheadTime(nextTime);
    const range = clipRanges.find((clipRange) => (
      nextTime >= clipRange.start && nextTime < clipRange.end
    )) || clipRanges[clipRanges.length - 1];
    if (range) setSelectedClipId(range.clip.clipId);
  };

  const seekFromPointer = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    seekTimeline((event.clientX - bounds.left) / pixelsPerSecond);
  };

  const restoreProject = (snapshot: ProjectSnapshot) => {
    restoringHistoryRef.current = true;
    lastProjectRef.current = snapshot;
    setClips(snapshot.clips);
    setAudioTrack(snapshot.audioTrack);
    setMusicTrack(snapshot.musicTrack);
    setMusicTracks(snapshot.musicTracks || []);
    setTextOverlays(snapshot.textOverlays);
    setSoundEffects(snapshot.soundEffects);
    setCanvasColor(snapshot.canvasColor ?? '#000000');
    setCanvasRatio(snapshot.canvasRatio ?? '16:9');
    setCanvasWidth(snapshot.canvasWidth ?? 1280);
    setCanvasHeight(snapshot.canvasHeight ?? 720);
    setSelectedTrack('visual');
    setSelectedKeyframeId(null);
  };

  const undoProject = () => {
    const current = lastProjectRef.current;
    let previous = pendingHistoryRef.current;
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current);
    pendingHistoryRef.current = null;
    if (!previous) previous = historyRef.current.pop() || null;
    if (!previous) return;
    redoRef.current.push(current);
    restoreProject(previous);
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(true);
  };

  const redoProject = () => {
    if (pendingHistoryRef.current) return;
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push(lastProjectRef.current);
    restoreProject(next);
    setCanUndo(true);
    setCanRedo(redoRef.current.length > 0);
  };

  const startTimelineMove = (
    event: ReactPointerEvent<HTMLElement>,
    timelineStart: number,
    duration: number,
    update: (nextTime: number) => void,
  ) => {
    event.stopPropagation();
    const startX = event.clientX;
    const maximum = Math.max(0, timelineDuration - Math.min(duration, timelineDuration));
    const move = (moveEvent: PointerEvent) => {
      let nextStart = Math.min(maximum, Math.max(0, timelineStart + (
        moveEvent.clientX - startX
      ) / pixelsPerSecond));
      if (snapping) {
        const candidates = [0, playheadTime, ...bookmarks, ...clipRanges.flatMap((range) => [range.start, range.end])];
        const nearby = candidates.find((candidate) => Math.abs(candidate - nextStart) <= 0.22);
        nextStart = nearby ?? Math.round(nextStart * 2) / 2;
      }
      update(Math.round(nextStart * 10) / 10);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const deleteSelectedClip = () => {
    if (clips.length <= 1) {
      setMessage('At least one visual clip is required.');
      return;
    }
    const removedRange = clipRanges[selectedIndex];
    const remaining = clips.filter((clip) => clip.clipId !== selectedClipId);
    const nextIndex = Math.min(selectedIndex, remaining.length - 1);
    setClips(remaining);
    setSelectedClipId(remaining[nextIndex].clipId);
    setSelectedKeyframeId(null);
    setPlayheadTime(Math.min(removedRange?.start || 0, remaining.reduce((total, clip) => total + clip.duration, 0)));
    setMessage('Clip deleted.');
  };

  const duplicateSelectedClip = () => {
    const copy: EditorClip = {
      ...selectedClip,
      clipId: createTimelineId(`${selectedClip.clipId}-copy`),
      keyframes: selectedClip.keyframes.map((keyframe) => ({
        ...keyframe,
        id: createTimelineId(`${keyframe.id}-copy`),
      })),
    };
    setClips((current) => [
      ...current.slice(0, selectedIndex + 1),
      copy,
      ...current.slice(selectedIndex + 1),
    ]);
    setSelectedClipId(copy.clipId);
    setMessage('Clip duplicated.');
  };

  const copySelectedClip = () => {
    copiedClipRef.current = {
      ...selectedClip,
      keyframes: selectedClip.keyframes.map((keyframe) => ({ ...keyframe })),
    };
    setHasCopiedClip(true);
    setMessage('Clip copied. Press Ctrl+V to paste it after the selected clip.');
  };

  const pasteCopiedClip = () => {
    const copiedClip = copiedClipRef.current;
    if (!copiedClip) return;
    const pastedClip: EditorClip = {
      ...copiedClip,
      clipId: createTimelineId(`${copiedClip.clipId}-paste`),
      keyframes: copiedClip.keyframes.map((keyframe) => ({
        ...keyframe,
        id: createTimelineId(`${keyframe.id}-paste`),
      })),
    };
    setClips((current) => [
      ...current.slice(0, selectedIndex + 1),
      pastedClip,
      ...current.slice(selectedIndex + 1),
    ]);
    setSelectedTrack('visual');
    setSelectedClipId(pastedClip.clipId);
    setSelectedKeyframeId(null);
    setMessage('Clip pasted.');
  };

  const revealSelectedMedia = (replace = false) => {
    setActivePanel('media');
    setMessage(replace
      ? 'Choose an alternative in Assets to replace this clip.'
      : 'The selected clip is shown in Assets.');
  };

  const updateSelectedText = (update: Partial<TextOverlay>) => {
    if (!selectedText) return;
    setTextOverlays((current) => current.map((overlay) => (
      overlay.id === selectedText.id ? { ...overlay, ...update } : overlay
    )));
  };

  const updateSelectedEffect = (update: Partial<TimelineSoundEffect>) => {
    if (!selectedEffect) return;
    setSoundEffects((current) => current.map((effect) => (
      effect.id === selectedEffect.id ? { ...effect, ...update } : effect
    )));
  };

  const duplicateSelectedText = () => {
    if (!selectedText) return;
    const copy = {
      ...selectedText,
        id: createTimelineId('text'),
      timelineStart: Math.min(
        Math.max(0, timelineDuration - selectedText.duration),
        Math.round((selectedText.timelineStart + 0.3) * 10) / 10,
      ),
    };
    setTextOverlays((current) => [...current, copy]);
    setSelectedTextId(copy.id);
  };

  const duplicateSelectedEffect = () => {
    if (!selectedEffect) return;
    const copy = {
      ...selectedEffect,
        id: createTimelineId('effect'),
      timelineStart: Math.min(
        Math.max(0, timelineDuration - selectedEffect.duration),
        Math.round((selectedEffect.timelineStart + 0.3) * 10) / 10,
      ),
    };
    setSoundEffects((current) => [...current, copy]);
    setEffectWaveforms((current) => ({
      ...current,
      [copy.id]: current[selectedEffect.id] || [],
    }));
    setSelectedEffectId(copy.id);
  };

  const deleteSelection = () => {
    if (selectedTrack === 'visual') {
      deleteSelectedClip();
      return;
    }
    if (selectedTrack === 'text' && selectedText) {
      setTextOverlays((current) => current.filter((overlay) => overlay.id !== selectedText.id));
      setSelectedTextId(null);
      setSelectedTrack('visual');
      return;
    }
    if (selectedTrack === 'effect' && selectedEffect) {
      setSoundEffects((current) => current.filter((effect) => effect.id !== selectedEffect.id));
      setSelectedEffectId(null);
      setSelectedTrack('visual');
      return;
    }
    if (selectedTrack === 'music' && musicTrack) {
      setMusicTrack(null);
      setMusicWaveform([]);
      setSelectedTrack('visual');
      return;
    }
    if (selectedTrack === 'music' && musicTracks.length > 0) {
      setMusicTracks([]);
      setMusicWaveforms({});
      setSelectedTrack('visual');
      return;
    }
    if (selectedTrack === 'audio' && audioTrack) {
      setAudioTrack(null);
      setAudioWaveform([]);
      setSelectedTrack('visual');
    }
  };

  const duplicateSelection = () => {
    if (selectedTrack === 'visual') duplicateSelectedClip();
    if (selectedTrack === 'text') duplicateSelectedText();
    if (selectedTrack === 'effect') duplicateSelectedEffect();
  };

  const toggleTrackLock = (track: keyof typeof lockedTracks) => {
    setLockedTracks((current) => ({ ...current, [track]: !current[track] }));
  };

  const startDurationDrag = (event: ReactPointerEvent<HTMLSpanElement>, clipId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const original = clips.find((clip) => clip.clipId === clipId);
    if (!original) return;
    const startX = event.clientX;
    const initialDuration = original.duration;
    const move = (moveEvent: PointerEvent) => {
      const duration = Math.max(0.5, Math.round((initialDuration + (
        moveEvent.clientX - startX
      ) / pixelsPerSecond) * 10) / 10);
      setClips((current) => current.map((clip) => (
        clip.clipId === clipId ? { ...clip, duration } : clip
      )));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const reorderClip = (targetClipId: string) => {
    if (!draggingClipId || draggingClipId === targetClipId) return;
    setClips((current) => {
      const fromIndex = current.findIndex((clip) => clip.clipId === draggingClipId);
      const toIndex = current.findIndex((clip) => clip.clipId === targetClipId);
      if (fromIndex < 0 || toIndex < 0) return current;
      const reordered = [...current];
      const [moving] = reordered.splice(fromIndex, 1);
      reordered.splice(toIndex, 0, moving);
      return reordered;
    });
    setDraggingClipId(null);
  };

  const addKeyframe = () => {
    const range = clipRanges[selectedIndex];
    if (!range) return;
    const time = Math.min(selectedClip.duration, Math.max(0, playheadTime - range.start));
    const transform = getTransformAtTime(selectedClip, time);
    const keyframe: TransformKeyframe = {
      id: createTimelineId('keyframe'),
      time,
      scale: transform.scale,
      positionX: transform.positionX,
      positionY: transform.positionY,
      rotation: transform.rotation,
    };
    updateClip({ keyframes: [...selectedClip.keyframes, keyframe].sort((a, b) => a.time - b.time) });
    setSelectedKeyframeId(keyframe.id);
    setMessage(`Keyframe added at ${time.toFixed(1)} seconds in this clip.`);
  };

  const addOrSelectKeyframeAtPlayhead = () => {
    if (keyframeAtPlayhead) {
      setSelectedKeyframeId(keyframeAtPlayhead.id);
      return;
    }
    addKeyframe();
  };

  const deleteSelectedKeyframe = () => {
    if (!selectedKeyframe) return;
    updateClip({ keyframes: selectedClip.keyframes.filter((keyframe) => keyframe.id !== selectedKeyframe.id) });
    setSelectedKeyframeId(null);
  };

  const trimAtPlayhead = () => {
    if (selectedTrack === 'text' && selectedText) {
      const localPosition = playheadTime - selectedText.timelineStart;
      if (localPosition > 0.1 && localPosition < selectedText.duration) {
        updateSelectedText({ duration: Math.round(localPosition * 10) / 10 });
        setMessage('Text trimmed at playhead.');
      }
      return;
    }
    if (selectedTrack === 'effect' && selectedEffect) {
      const localPosition = playheadTime - selectedEffect.timelineStart;
      if (localPosition > 0.1 && localPosition < selectedEffect.duration) {
        updateSelectedEffect({ duration: Math.round(localPosition * 10) / 10 });
        setMessage('Sound effect trimmed at playhead.');
      }
      return;
    }
    if (selectedTrack === 'audio' && audioTrack) {
      const localPosition = playheadTime - audioTrack.timelineStart;
      if (localPosition > 0.1 && localPosition < audioTrack.duration) {
        setAudioTrack({ ...audioTrack, duration: localPosition });
        setMessage('Audio trimmed at playhead.');
      }
      return;
    }
    if (selectedTrack === 'music' && musicTrack) {
      const localPosition = playheadTime - musicTrack.timelineStart;
      if (localPosition > 0.1 && localPosition < musicTrack.duration) {
        setMusicTrack({ ...musicTrack, duration: Math.round(localPosition * 10) / 10 });
        setMessage('Music trimmed at playhead.');
      }
      return;
    }

    const range = clipRanges[selectedIndex];
    if (!range) return;
    const cutPoint = Math.round((playheadTime - range.start) * 10) / 10;
    if (cutPoint <= 0.1 || cutPoint >= range.clip.duration - 0.1) return;
    const secondClip: EditorClip = {
      ...range.clip,
      clipId: createTimelineId(`${range.clip.clipId}-cut`),
      duration: Math.round((range.clip.duration - cutPoint) * 10) / 10,
      sourceStart: range.clip.asset.type === 'video'
        ? range.clip.sourceStart + cutPoint
        : range.clip.sourceStart,
      transition: 'none',
      keyframes: range.clip.keyframes
        .filter((keyframe) => keyframe.time > cutPoint)
        .map((keyframe) => ({
          ...keyframe,
          time: Math.round((keyframe.time - cutPoint) * 10) / 10,
        })),
    };
    setClips((current) => [
      ...current.slice(0, selectedIndex),
      {
        ...range.clip,
        duration: cutPoint,
        keyframes: range.clip.keyframes.filter((keyframe) => keyframe.time <= cutPoint),
      },
      secondClip,
      ...current.slice(selectedIndex + 1),
    ]);
    setSelectedClipId(secondClip.clipId);
    setSelectedKeyframeId(null);
    setMessage('Clip split at playhead. Adjust either section duration as needed.');
  };

  const retainSideAtPlayhead = (side: 'left' | 'right') => {
    if (selectedTrack === 'text' && selectedText) {
      const localPosition = playheadTime - selectedText.timelineStart;
      if (localPosition <= 0.1 || localPosition >= selectedText.duration - 0.1) return;
      if (side === 'left') updateSelectedText({ duration: Math.round(localPosition * 10) / 10 });
      else updateSelectedText({
        timelineStart: playheadTime,
        duration: Math.round((selectedText.duration - localPosition) * 10) / 10,
      });
      return;
    }
    if (selectedTrack === 'effect' && selectedEffect) {
      const localPosition = playheadTime - selectedEffect.timelineStart;
      if (localPosition <= 0.1 || localPosition >= selectedEffect.duration - 0.1) return;
      if (side === 'left') updateSelectedEffect({ duration: Math.round(localPosition * 10) / 10 });
      else updateSelectedEffect({
        timelineStart: playheadTime,
        sourceStart: selectedEffect.sourceStart + localPosition,
        duration: Math.round((selectedEffect.duration - localPosition) * 10) / 10,
      });
      return;
    }
    if (selectedTrack === 'audio' && audioTrack) {
      const localPosition = playheadTime - audioTrack.timelineStart;
      if (localPosition <= 0.1 || localPosition >= audioTrack.duration - 0.1) return;
      if (side === 'left') setAudioTrack({ ...audioTrack, duration: Math.round(localPosition * 10) / 10 });
      else setAudioTrack({
        ...audioTrack,
        timelineStart: playheadTime,
        sourceStart: audioTrack.sourceStart + localPosition,
        duration: Math.round((audioTrack.duration - localPosition) * 10) / 10,
      });
      return;
    }
    if (selectedTrack === 'music' && musicTrack) {
      const localPosition = playheadTime - musicTrack.timelineStart;
      if (localPosition <= 0.1 || localPosition >= musicTrack.duration - 0.1) return;
      if (side === 'left') setMusicTrack({ ...musicTrack, duration: Math.round(localPosition * 10) / 10 });
      else setMusicTrack({
        ...musicTrack,
        timelineStart: playheadTime,
        sourceStart: musicTrack.sourceStart + localPosition,
        duration: Math.round((musicTrack.duration - localPosition) * 10) / 10,
      });
      return;
    }
    const range = clipRanges[selectedIndex];
    if (!range) return;
    const localPosition = playheadTime - range.start;
    if (localPosition <= 0.1 || localPosition >= range.clip.duration - 0.1) return;
    if (side === 'left') {
      updateClip({
        duration: Math.round(localPosition * 10) / 10,
        keyframes: range.clip.keyframes.filter((keyframe) => keyframe.time <= localPosition),
      });
    } else {
      updateClip({
        duration: Math.round((range.clip.duration - localPosition) * 10) / 10,
        sourceStart: range.clip.asset.type === 'video' ? range.clip.sourceStart + localPosition : range.clip.sourceStart,
        keyframes: range.clip.keyframes
          .filter((keyframe) => keyframe.time >= localPosition)
          .map((keyframe) => ({ ...keyframe, time: keyframe.time - localPosition })),
      });
      seekTimeline(range.start);
    }
    setMessage(`Kept ${side} side of the selected element.`);
  };

  const toggleBookmark = () => {
    const time = Math.round(playheadTime * 10) / 10;
    setBookmarks((current) => (
      current.some((bookmark) => Math.abs(bookmark - time) < 0.05)
        ? current.filter((bookmark) => Math.abs(bookmark - time) >= 0.05)
        : [...current, time].sort((left, right) => left - right)
    ));
  };

  const selectCanvasPreset = (preset: typeof CANVAS_PRESETS[number]) => {
    setCanvasRatio(preset.ratio);
    setCanvasWidth(preset.width);
    setCanvasHeight(preset.height);
  };

  const setCustomCanvasDimension = (dimension: 'width' | 'height', value: number) => {
    const valid = Math.min(3840, Math.max(240, Math.round(value / 2) * 2 || 240));
    setCanvasRatio('custom');
    if (dimension === 'width') setCanvasWidth(valid);
    else setCanvasHeight(valid);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.isContentEditable
        || target?.tagName === 'INPUT'
        || target?.tagName === 'TEXTAREA'
        || target?.tagName === 'SELECT'
      ) return;
      const withModifier = event.ctrlKey || event.metaKey;
      if (withModifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoProject();
        else undoProject();
        return;
      }
      if (withModifier && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redoProject();
        return;
      }
      if (withModifier && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelection();
        return;
      }
      if (withModifier && event.key.toLowerCase() === 'c' && selectedTrack === 'visual') {
        event.preventDefault();
        copySelectedClip();
        return;
      }
      if (withModifier && event.key.toLowerCase() === 'v' && selectedTrack === 'visual') {
        event.preventDefault();
        pasteCopiedClip();
        return;
      }
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
        return;
      }
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        trimAtPlayhead();
        return;
      }
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setSnapping((enabled) => !enabled);
        return;
      }
      if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        toggleBookmark();
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (event.key === 'ArrowLeft') seekTimeline(playheadTime - (event.shiftKey ? 5 : 0.1));
      if (event.key === 'ArrowRight') seekTimeline(playheadTime + (event.shiftKey ? 5 : 0.1));
      if (event.key === 'Home') seekTimeline(0);
      if (event.key === 'End') seekTimeline(timelineDuration);
      if (event.key === 'Escape') setClipContextMenu(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  useEffect(() => {
    const viewport = timelineViewportRef.current;
    if (!viewport) return;

    const updateTimelineWidth = () => {
      const label = viewport.querySelector<HTMLElement>('.track-label');
      setTimelineViewportWidth(Math.max(0, viewport.clientWidth - (label?.offsetWidth ?? 156)));
    };

    updateTimelineWidth();
    const observer = new ResizeObserver(updateTimelineWidth);
    observer.observe(viewport);
    const label = viewport.querySelector<HTMLElement>('.track-label');
    if (label) observer.observe(label);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const closeContextMenu = () => setClipContextMenu(null);
    window.addEventListener('pointerdown', closeContextMenu);
    window.addEventListener('resize', closeContextMenu);
    return () => {
      window.removeEventListener('pointerdown', closeContextMenu);
      window.removeEventListener('resize', closeContextMenu);
    };
  }, []);

  useEffect(() => {
    if (!isExporting) return undefined;
    const interval = window.setInterval(() => {
      setExportProgress((current) => {
        if (current < 55) return current + 3;
        if (current < 82) return current + 1;
        if (current < 94) return current + 0.35;
        if (current < 98.5) return current + 0.08;
        return current;
      });
    }, 800);
    return () => window.clearInterval(interval);
  }, [isExporting]);

  const exportProject = async () => {
    setIsExporting(true);
    setExportProgress(3);
    setExportedVideo((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    setMessage('Rendering video with the faster Remotion exporter. The browser download starts when rendering finishes.');
    try {
      const formData = new FormData();
      const rawExportLimit = audioTrack
        ? audioTrack.timelineStart + audioTrack.duration
        : alignedVoiceOverDuration || storyboardDuration || visualDuration;
      const exportDuration = Math.max(0.5, rawExportLimit || visualDuration || contentDuration);
      let clipCursor = 0;
      const visibleExportClips = remotionProject.clips
        .filter((clip) => {
          const sourceClip = clips.find((entry) => entry.clipId === clip.id);
          return !visualHidden && !sourceClip?.hidden;
        })
        .flatMap((clip) => {
          if (clipCursor >= exportDuration) return [];
          const remaining = exportDuration - clipCursor;
          const duration = Math.min(clip.duration, remaining);
          clipCursor += duration;
          return duration >= 0.1 ? [{ ...clip, duration }] : [];
        });
      if (visibleExportClips.length > 0 && clipCursor < exportDuration) {
        const lastClip = visibleExportClips[visibleExportClips.length - 1];
        visibleExportClips[visibleExportClips.length - 1] = {
          ...lastClip,
          duration: Math.round((lastClip.duration + exportDuration - clipCursor) * 10) / 10,
        };
      }
      const clampTimelineItem = <T extends { start: number; duration: number }>(item: T): T | null => {
        if (item.start >= exportDuration) return null;
        const duration = Math.min(item.duration, exportDuration - item.start);
        return duration > 0.05 ? { ...item, duration } : null;
      };
      const exportSoundEffects = soundEffects
        .map((effect) => {
          const clampedEffect = clampTimelineItem({
            src: '',
            start: effect.timelineStart,
            duration: effect.duration,
            sourceStart: effect.sourceStart,
            volume: effectsMuted ? 0 : effect.volume / 100,
          });
          return clampedEffect ? { effect: clampedEffect, file: effect.file } : null;
        })
        .filter((effect): effect is {
          effect: NonNullable<AutomatedVideoProps['soundEffects']>[number];
          file: File;
        } => Boolean(effect));
      const exportMusicTracks = musicTracks.reduce<NonNullable<AutomatedVideoProps['musicTracks']>>((tracks, track) => {
        const clampedTrack = clampTimelineItem({
          src: '',
          start: track.timelineStart,
          duration: track.duration,
          sourceStart: track.sourceStart,
          volume: musicMuted ? 0 : track.volume / 100,
          loop: track.loop,
          sourceDuration: track.sourceDuration || track.duration,
        });
        if (clampedTrack) tracks.push(clampedTrack);
        return tracks;
      }, []);
      const exportProjectData: AutomatedVideoProps = {
        ...remotionProject,
        clips: visibleExportClips,
        textOverlays: remotionProject.textOverlays
          .map(clampTimelineItem)
          .filter((overlay): overlay is AutomatedVideoProps['textOverlays'][number] => Boolean(overlay)),
        durationInFrames: Math.max(1, Math.ceil(exportDuration * remotionProject.fps)),
        audioTrack: audioTrack ? {
          src: '',
          start: audioTrack.timelineStart,
          duration: Math.min(audioTrack.duration, Math.max(0.1, exportDuration - audioTrack.timelineStart)),
          sourceStart: audioTrack.sourceStart,
          volume: audioMuted ? 0 : audioTrack.volume / 100,
        } : null,
        musicTrack: musicTrack ? {
          src: '',
          start: musicTrack.timelineStart,
          duration: Math.min(musicTrack.duration, Math.max(0.1, exportDuration - musicTrack.timelineStart)),
          sourceStart: musicTrack.sourceStart,
          volume: musicMuted ? 0 : musicTrack.volume / 100,
          loop: musicTrack.loop,
          sourceDuration: musicTrack.sourceDuration || musicTrack.duration,
        } : null,
        musicTracks: exportMusicTracks,
        soundEffects: exportSoundEffects.map(({ effect }) => effect),
      };
      formData.append('project', JSON.stringify(exportProjectData));
      clips.filter((clip) => visibleExportClips.some((entry) => entry.id === clip.clipId)).forEach((clip) => {
        const file = localMediaFiles[clip.asset.id];
        if (file) formData.append(`clipAsset_${clip.clipId}`, file);
      });
      if (audioTrack) formData.append('backgroundAudio', audioTrack.file);
      if (musicTrack) formData.append('backgroundMusic', musicTrack.file);
      musicTracks.forEach((track, index) => {
        formData.append(`backgroundMusicTrack_${index}`, track.file);
      });
      exportSoundEffects.forEach(({ file }, index) => {
        formData.append(`timelineEffect_${index}`, file);
      });

      const response = await fetch('/api/render-remotion', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Video export failed.' }));
        throw new Error(errorData.error || 'Video export failed.');
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('video/mp4')) {
        const disposition = response.headers.get('content-disposition') || '';
        const filename = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] || 'Video_Lab_Project.mp4';
        const blobUrl = URL.createObjectURL(await response.blob());
        setExportProgress(100);
        setExportedVideo({ url: blobUrl, filename });
        setMessage(`${filename} is ready. Click Download MP4 to save it to your device.`);
        return;
      }

      throw new Error('Export finished, but the server did not return a downloadable MP4.');
    } catch (exportError) {
      setExportProgress(0);
      setMessage(exportError instanceof Error ? exportError.message : 'Video export failed.');
    } finally {
      window.setTimeout(() => {
        setIsExporting(false);
        setExportProgress(0);
      }, 650);
    }
  };

  if (!activeClip) return null;

  return (
    <section className="video-lab" aria-label="Video Lab editor">
      <header className="video-lab-header">
        <div className="video-lab-project">
          <button type="button" className="lab-back-button" onClick={onClose} title="Return to storyboard">
            &#8249;
          </button>
          <div>
            <h2>Video Lab</h2>
            <span>Storyboard Project 01 | {clips.length} clips | {formatTime(visualDuration)}</span>
            <small className="edit-plan-status">{editPlanStatus}</small>
          </div>
        </div>
        <div className="video-lab-actions">
          <button type="button" className="secondary-btn" onClick={previewFromStart}>
            Preview from start
          </button>
          <button type="button" className="primary export-progress-button" disabled={isExporting} onClick={exportProject}>
            {isExporting && (
              <span
                className="export-progress-ring"
                style={{ '--export-progress': `${Math.round(exportProgress)}%` } as CSSProperties}
                aria-hidden="true"
              />
            )}
            <span>{isExporting ? `Exporting ${Math.round(exportProgress)}%` : 'Export full video'}</span>
          </button>
          {exportedVideo && (
            <a className="primary export-download-link" href={exportedVideo.url} download={exportedVideo.filename}>
              Download MP4
            </a>
          )}
        </div>
      </header>

      <div className="video-lab-workspace">
        <aside className="asset-library" aria-label="Editor assets">
          <nav className="asset-tool-rail" aria-label="Editing tools">
            {([
              ['media', 'Media', '\u25A3'],
              ['audio', 'Audio', '\u266A'],
              ['text', 'Text', 'T'],
              ['effects', 'Effects', '\u2726'],
              ['transitions', 'Transitions', '\u21C4'],
              ['canvas', 'Canvas', '\u25A1'],
            ] as Array<[AssetPanel, string, string]>).map(([panel, label, icon]) => (
              <button
                type="button"
                key={panel}
                className={activePanel === panel ? 'active' : ''}
                aria-label={label}
                onClick={() => setActivePanel(panel)}
                title={label}
              >
                <strong>{icon}</strong>
                <span>{label}</span>
              </button>
            ))}
          </nav>
          <div className="asset-drawer">
            {activePanel === 'media' && (
              <>
                <header>
                  <h3>Media</h3>
                  <span>Scene {selectedIndex + 1}</span>
                </header>
                <div className="asset-import-bar">
                  <strong>Local media</strong>
                  <small>Import from your storage, then replace or insert on the timeline.</small>
                  <div className="asset-import-actions">
                    <label>
                      Import
                      <input type="file" accept="image/*,video/*" multiple onChange={(event) => importLocalMedia(event, 'library')} />
                    </label>
                    <label>
                      Replace
                      <input type="file" accept="image/*,video/*" onChange={(event) => importLocalMedia(event, 'replace')} />
                    </label>
                    <label>
                      Insert
                      <input type="file" accept="image/*,video/*" multiple onChange={(event) => importLocalMedia(event, 'insert')} />
                    </label>
                  </div>
                </div>
                {localMediaAssets.length > 0 && (
                  <>
                    <div className="asset-import-bar compact">
                      <strong>Your imports</strong>
                      <small>Click one to replace the selected clip.</small>
                    </div>
                    <div className="asset-bin">
                      {localMediaAssets.map(({ asset }) => (
                        <button
                          type="button"
                          key={asset.id}
                          className={selectedClip.asset.id === asset.id ? 'selected' : ''}
                          onClick={() => {
                            addAlternativeToSelectedClip(asset);
                            updateClip({ asset, sourceStart: 0 });
                          }}
                          title={asset.title}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={asset.thumbnail} alt="" />
                          <span>{asset.type}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <div className="asset-import-bar compact">
                  <strong>AI selections</strong>
                </div>
                <div className="asset-bin">
                  {selectedClip.alternatives.map((asset) => (
                    <button
                      type="button"
                      key={asset.id}
                      className={selectedClip.asset.id === asset.id ? 'selected' : ''}
                      onClick={() => updateClip({ asset, sourceStart: 0 })}
                      title={asset.title}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={asset.thumbnail} alt="" />
                      <span>{asset.type}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {activePanel === 'audio' && (
              <>
                <header><h3>Audio</h3></header>
                <label className="asset-action">
                  Replace voiceover audio
                  <input type="file" accept="audio/*" onChange={handleBackgroundAudio} />
                </label>
                <label className="asset-action">
                  Import background music
                  <input type="file" accept="audio/*" onChange={handleBackgroundMusic} />
                </label>
                <button
                  type="button"
                  className="asset-action"
                  onClick={() => {
                    void applyAutoBackgroundMusicPlaylist(
                      getAutoBackgroundMusicLibrary(niche),
                      musicTrack || musicTracks.length > 0
                        ? 'Background music regenerated automatically.'
                        : 'Background music added automatically.',
                    ).catch((reason) => {
                      setMessage(reason instanceof Error ? reason.message : 'Could not add auto background music.');
                    });
                  }}
                >
                  {musicTrack || musicTracks.length > 0 ? 'Regenerate auto music' : 'Add auto music'}
                </button>
                {historyVintageMode && (
                  <section className="sound-effect-library" aria-label="History vintage music library">
                    <header>
                      <strong>History music</strong>
                      <span>{HISTORY_VINTAGE_BACKGROUND_MUSIC.length} ready</span>
                    </header>
                    {HISTORY_VINTAGE_BACKGROUND_MUSIC.map((music) => (
                      <button
                        type="button"
                        key={music.id}
                        onClick={() => {
                          loadBackgroundMusic(music)
                            .catch((error) => setMessage(error instanceof Error ? error.message : 'Could not add background music.'));
                        }}
                      >
                        <strong>{music.label}</strong>
                        <span>{music.description}</span>
                      </button>
                    ))}
                  </section>
                )}
                {trueCrimeMode && (
                  <section className="sound-effect-library" aria-label="True crime music library">
                    <header>
                      <strong>True-crime music</strong>
                      <span>{TRUE_CRIME_BACKGROUND_MUSIC.length} ready</span>
                    </header>
                    {TRUE_CRIME_BACKGROUND_MUSIC.map((music) => (
                      <button
                        type="button"
                        key={music.id}
                        onClick={() => {
                          loadBackgroundMusic(music)
                            .catch((error) => setMessage(error instanceof Error ? error.message : 'Could not add background music.'));
                        }}
                      >
                        <strong>{music.label}</strong>
                        <span>{music.description}</span>
                      </button>
                    ))}
                  </section>
                )}
                <label className="asset-action">
                  Add sound effect at playhead
                  <input type="file" accept="audio/*" onChange={handleTimelineSoundEffect} />
                </label>
                <section className="sound-effect-library" aria-label="Sound effects library">
                  <header>
                    <strong>Sound effects</strong>
                    <span>{SOUND_EFFECT_LIBRARY.length} ready</span>
                  </header>
                  {SOUND_EFFECT_LIBRARY.map((effect) => (
                    <button
                      type="button"
                      key={effect.id}
                      onClick={() => {
                        addLibrarySoundEffect(effect.id)
                          .then(() => setMessage(`${effect.label} added at the playhead.`))
                          .catch((error) => setMessage(error instanceof Error ? error.message : 'Could not add sound effect.'));
                      }}
                    >
                      <strong>{effect.label}</strong>
                      <span>{effect.description}</span>
                    </button>
                  ))}
                </section>
                {historyVintageMode && (
                  <section className="sound-effect-library" aria-label="History vintage sound effects library">
                    <header>
                      <strong>History SFX</strong>
                      <span>{HISTORY_VINTAGE_SOUND_EFFECT_LIBRARY.length} ready</span>
                    </header>
                    {HISTORY_VINTAGE_SOUND_EFFECT_LIBRARY.map((effect) => (
                      <button
                        type="button"
                        key={effect.id}
                        onClick={() => {
                          addLibrarySoundEffect(effect.id, { volume: effect.id === 'history-typewriter' ? 88 : 74 })
                            .then(() => setMessage(`${effect.label} added at the playhead.`))
                            .catch((error) => setMessage(error instanceof Error ? error.message : 'Could not add history sound effect.'));
                        }}
                      >
                        <strong>{effect.label}</strong>
                        <span>{effect.description}</span>
                      </button>
                    ))}
                  </section>
                )}
                {trueCrimeMode && (
                  <section className="sound-effect-library" aria-label="True crime sound effects library">
                    <header>
                      <strong>True-crime SFX</strong>
                      <span>{TRUE_CRIME_SOUND_EFFECT_LIBRARY.length} ready</span>
                    </header>
                    {TRUE_CRIME_SOUND_EFFECT_LIBRARY.map((effect) => (
                      <button
                        type="button"
                        key={effect.id}
                        onClick={() => {
                          addLibrarySoundEffect(effect.id, { volume: 72 })
                            .then(() => setMessage(`${effect.label} added at the playhead.`))
                            .catch((error) => setMessage(error instanceof Error ? error.message : 'Could not add true-crime sound effect.'));
                        }}
                      >
                        <strong>{effect.label}</strong>
                        <span>{effect.description}</span>
                      </button>
                    ))}
                  </section>
                )}
              </>
            )}
            {activePanel === 'text' && (
              <>
                <header><h3>Text</h3></header>
                <button type="button" className="text-template title" onClick={() => addTextAtPlayhead({ text: 'Title', fontSize: 64, positionY: 24 })}>
                  Title
                </button>
                <button type="button" className="text-template" onClick={() => addTextAtPlayhead({ text: 'Lower third', fontSize: 34, positionX: 26, positionY: 84 })}>
                  Lower third
                </button>
                <button type="button" className="text-template caption" onClick={() => addTextAtPlayhead({ text: 'On-screen text', fontSize: 42 })}>
                  On-screen text
                </button>
              </>
            )}
            {activePanel === 'effects' && (
              <>
                <header><h3>Effects</h3></header>
                <div className="effect-presets">
                  <button type="button" onClick={() => updateClip({ sepia: 65, saturation: 72, contrast: 108, brightness: 96, blur: 0 })}>Vintage Film</button>
                  <button type="button" onClick={() => updateClip({ sepia: 18, saturation: 0, contrast: 132, brightness: 98, blur: 0 })}>Monochrome</button>
                  <button type="button" onClick={() => updateClip({ sepia: 8, saturation: 86, contrast: 95, brightness: 118, blur: 2 })}>Soft Focus</button>
                  <button type="button" onClick={() => updateClip({ opacity: 100, brightness: 100, contrast: 100, saturation: 100, sepia: 0, blur: 0 })}>None</button>
                </div>
              </>
            )}
            {activePanel === 'transitions' && (
              <>
                <header><h3>Transitions</h3></header>
                <div className="transition-presets">
                  {([
                    ['none', 'Cut'],
                    ['fade', 'Fade'],
                    ['slideleft', 'Slide left'],
                    ['slidedown', 'Drop down'],
                    ...(historyVintageMode ? [
                      ['screenburn', 'Screen burn'],
                      ['glitch', 'Glitch'],
                    ] as Array<[Transition, string]> : []),
                  ] as Array<[Transition, string]>).map(([transition, name]) => (
                    <button
                      type="button"
                      key={transition}
                      className={selectedClip.transition === transition ? 'selected' : ''}
                      onClick={() => updateClip({ transition })}
                    >
                      <i className={`transition-swatch ${transition}`} />
                      {name}
                    </button>
                  ))}
                </div>
              </>
            )}
            {activePanel === 'canvas' && (
              <>
                <header><h3>Canvas</h3></header>
                <label className="canvas-setting">
                  <span>Background color</span>
                  <input type="color" value={canvasColor} onChange={(event) => setCanvasColor(event.target.value)} />
                </label>
                <div className="canvas-presets">
                  {['#000000', '#111827', '#f5f5f4', '#3f3025'].map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={canvasColor === color ? 'selected' : ''}
                      style={{ backgroundColor: color }}
                      onClick={() => setCanvasColor(color)}
                      title={color}
                    />
                  ))}
                </div>
                <section className="aspect-ratio-settings" aria-label="Aspect ratio">
                  <header>
                    <strong>Aspect ratio</strong>
                    <span>{canvasWidth} x {canvasHeight}</span>
                  </header>
                  {CANVAS_PRESETS.map((preset) => (
                    <button
                      key={preset.ratio}
                      type="button"
                      className={canvasRatio === preset.ratio ? 'selected' : ''}
                      onClick={() => selectCanvasPreset(preset)}
                    >
                      <i className={`ratio-shape ratio-${preset.ratio.replace(':', '-')}`} />
                      <strong>{preset.ratio}</strong>
                      <span>{preset.width} x {preset.height}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className={canvasRatio === 'custom' ? 'selected' : ''}
                    onClick={() => setCanvasRatio('custom')}
                  >
                    <i className="ratio-shape ratio-custom" />
                    <strong>Custom</strong>
                  </button>
                  {canvasRatio === 'custom' && (
                    <div className="custom-ratio-fields">
                      <label>
                        <span>Width</span>
                        <input type="number" min="240" max="3840" step="2" value={canvasWidth} onChange={(event) => setCustomCanvasDimension('width', Number(event.target.value))} />
                      </label>
                      <label>
                        <span>Height</span>
                        <input type="number" min="240" max="3840" step="2" value={canvasHeight} onChange={(event) => setCustomCanvasDimension('height', Number(event.target.value))} />
                      </label>
                    </div>
                  )}
                </section>
                <div className="canvas-adjustments">
                  <div className="inspector-subsection-heading">
                    <strong>Adjustments</strong>
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={() => updateClip({
                        opacity: 100,
                        brightness: 100,
                        contrast: 100,
                        saturation: 100,
                        sepia: 0,
                        blur: 0,
                      })}
                    >
                      Reset
                    </button>
                  </div>
                  <label>
                    <span>Opacity</span>
                    <div className="scale-control">
                      <input type="range" min="0" max="100" value={selectedClip.opacity ?? 100} onInput={(event) => updateClip({ opacity: Number(event.currentTarget.value) })} />
                      <strong>{selectedClip.opacity ?? 100}%</strong>
                    </div>
                  </label>
                  <label>
                    <span>Brightness</span>
                    <div className="scale-control">
                      <input type="range" min="20" max="180" value={selectedClip.brightness ?? 100} onInput={(event) => updateClip({ brightness: Number(event.currentTarget.value) })} />
                      <strong>{selectedClip.brightness ?? 100}%</strong>
                    </div>
                  </label>
                  <label>
                    <span>Contrast</span>
                    <div className="scale-control">
                      <input type="range" min="20" max="180" value={selectedClip.contrast ?? 100} onInput={(event) => updateClip({ contrast: Number(event.currentTarget.value) })} />
                      <strong>{selectedClip.contrast ?? 100}%</strong>
                    </div>
                  </label>
                  <label>
                    <span>Saturation</span>
                    <div className="scale-control">
                      <input type="range" min="0" max="200" value={selectedClip.saturation ?? 100} onInput={(event) => updateClip({ saturation: Number(event.currentTarget.value) })} />
                      <strong>{selectedClip.saturation ?? 100}%</strong>
                    </div>
                  </label>
                  <label>
                    <span>Sepia</span>
                    <div className="scale-control">
                      <input type="range" min="0" max="100" value={selectedClip.sepia ?? 0} onInput={(event) => updateClip({ sepia: Number(event.currentTarget.value) })} />
                      <strong>{selectedClip.sepia ?? 0}%</strong>
                    </div>
                  </label>
                  <label>
                    <span>Blur</span>
                    <div className="scale-control">
                      <input type="range" min="0" max="16" step="1" value={selectedClip.blur ?? 0} onInput={(event) => updateClip({ blur: Number(event.currentTarget.value) })} />
                      <strong>{selectedClip.blur ?? 0}px</strong>
                    </div>
                  </label>
                </div>
              </>
            )}
          </div>
        </aside>
        <div className="video-lab-monitor">
          <div className="monitor-title">Player / Timeline 01</div>
          <div
            className={`monitor-stage transition-${activeClip.transition}${historyVintageMode ? ' history-vintage-stage' : ''}${trueCrimeMode ? ' true-crime-stage' : ''}`}
            style={{
              backgroundColor: canvasColor,
              aspectRatio: `${canvasWidth} / ${canvasHeight}`,
              width: canvasHeight > canvasWidth
                ? 'min(100%, 280px)'
                : canvasHeight === canvasWidth
                  ? 'min(100%, 500px)'
                  : canvasRatio === '4:3'
                    ? 'min(100%, 680px)'
                    : 'min(100%, 820px)',
            }}
          >
            <div
              className="monitor-media"
              style={{
                transform: `translate(${activeTransform.positionX}%, ${activeTransform.positionY}%) scale(${activeTransform.scale / 100}) rotate(${activeTransform.rotation}deg)`,
                filter: `brightness(${activeClip.brightness}%) contrast(${activeClip.contrast}%) saturate(${activeClip.saturation}%) sepia(${activeClip.sepia}%) blur(${activeClip.blur || 0}px)`,
                opacity: (activeClip.opacity ?? 100) / 100,
              }}
            >
              {activeClip.asset.type === 'video' ? (
                <video
                  key={activeClip.clipId}
                  src={activeClip.asset.downloadUrl || activeClip.asset.thumbnail}
                  poster={activeClip.asset.thumbnail}
                  muted
                  playsInline
                  autoPlay={isPlaying}
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={activeClip.asset.thumbnail || activeClip.asset.downloadUrl} alt="" />
              )}
            </div>
            {activeTextOverlays.map((overlay) => (
              <div
                key={overlay.id}
                className={`preview-text-overlay ${isListNumberText(overlay.text) ? 'list-number' : 'keyword-overlay'}`}
                style={{
                  left: `${overlay.positionX}%`,
                  top: `${overlay.positionY}%`,
                  fontSize: `${overlay.fontSize}px`,
                  color: overlay.color,
                  backgroundColor: `${overlay.backgroundColor}cc`,
                }}
              >
                {overlay.text}
              </div>
            ))}
            {historyVintageMode && (
              <video
                className="film-texture-overlay"
                src="/overlays/vitevid-film-grain-scratches.mp4"
                muted
                loop
                playsInline
                autoPlay
              />
            )}
          </div>
          <div className="preview-transport">
            <button
              type="button"
              className="secondary-btn"
              disabled={previewIndex === 0}
              onClick={() => seekTimeline(clipRanges[Math.max(0, previewIndex - 1)].start)}
            >
              Previous
            </button>
            <button
              type="button"
              className="primary"
              onClick={togglePlayback}
            >
              {isPlaying ? 'Pause' : 'Play from playhead'}
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={previewIndex === clips.length - 1}
              onClick={() => seekTimeline(clipRanges[Math.min(clips.length - 1, previewIndex + 1)].start)}
            >
              Next
            </button>
            <span>{formatPlayheadTime(playheadTime)} | Clip {previewIndex + 1} / {clips.length}</span>
          </div>
        </div>

        <aside className="video-lab-inspector" aria-label="Properties">
          <nav className="properties-tabs">
            <strong>Properties</strong>
            <span>{selectedTrack === 'visual' ? 'Video' : selectedTrack === 'music' ? 'Music' : selectedTrack}</span>
          </nav>
          {selectedTrack === 'visual' ? (
            <>
          <div className="inspector-title">
            <h3>Clip {selectedIndex + 1} Details</h3>
            <div className="element-actions">
              <button type="button" className="secondary-btn" onClick={duplicateSelectedClip}>Duplicate</button>
              <button type="button" className="danger-btn" onClick={deleteSelectedClip}>Delete</button>
            </div>
          </div>
          <label>
            <span>Clip / image duration</span>
            <div className="inline-value">
              <input
                type="number"
                min="0.5"
                max="30"
                step="0.5"
                value={selectedClip.duration}
                onChange={(event) => updateClip({
                  duration: Math.max(0.5, Number(event.target.value) || 0.5),
                })}
              />
              <span>seconds</span>
            </div>
          </label>
          {selectedClip.asset.type === 'video' && (
            <label>
              <span>Cut from source at</span>
              <div className="inline-value">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={selectedClip.sourceStart}
                  onChange={(event) => updateClip({
                    sourceStart: Math.max(0, Number(event.target.value) || 0),
                  })}
                />
                <span>seconds</span>
              </div>
            </label>
          )}
          <section className="transform-panel" aria-label="Transform">
            <header>
              <strong>Transform</strong>
              <button
                type="button"
                className={`keyframe-diamond ${keyframeAtPlayhead ? 'active' : ''}`}
                onClick={addOrSelectKeyframeAtPlayhead}
                title={keyframeAtPlayhead ? 'Select keyframe at playhead' : 'Add transform keyframe at playhead'}
              >
                &#9671;
              </button>
            </header>
            <small>
              {selectedKeyframe ? `Editing keyframe at ${selectedKeyframe.time.toFixed(1)}s` : 'Base transform - add a diamond to animate'}
            </small>
            <div className="transform-fields">
              <label>
                <span>Width</span>
                <div><b>W</b><input type="number" min="10" max="400" value={selectedKeyframe?.scale ?? selectedClip.scale ?? 100} onChange={(event) => updateTransform({ scale: Number(event.target.value) || 100 })} /></div>
              </label>
              <label>
                <span>Height</span>
                <div><b>H</b><input type="number" min="10" max="400" value={selectedKeyframe?.scale ?? selectedClip.scale ?? 100} onChange={(event) => updateTransform({ scale: Number(event.target.value) || 100 })} /></div>
              </label>
              <label>
                <span>X</span>
                <div><b>X</b><input type="number" min="-100" max="100" value={selectedKeyframe?.positionX ?? selectedClip.positionX} onChange={(event) => updateTransform({ positionX: Number(event.target.value) || 0 })} /></div>
              </label>
              <label>
                <span>Y</span>
                <div><b>Y</b><input type="number" min="-100" max="100" value={selectedKeyframe?.positionY ?? selectedClip.positionY} onChange={(event) => updateTransform({ positionY: Number(event.target.value) || 0 })} /></div>
              </label>
              <label className="rotation-field">
                <span>Rotation</span>
                <div><b>&#8635;</b><input type="number" min="-180" max="180" value={selectedKeyframe?.rotation ?? selectedClip.rotation} onChange={(event) => updateTransform({ rotation: Number(event.target.value) || 0 })} /></div>
              </label>
            </div>
          </section>
          <div className="keyframe-controls">
            <button type="button" className="secondary-btn" onClick={addKeyframe}>
              Add keyframe at playhead
            </button>
            {selectedKeyframe && (
              <button type="button" className="secondary-btn" onClick={deleteSelectedKeyframe}>
                Delete keyframe
              </button>
            )}
            {selectedClip.keyframes.length > 0 && (
              <div className="keyframe-list">
                <button
                  type="button"
                  className={!selectedKeyframeId ? 'active' : ''}
                  onClick={() => setSelectedKeyframeId(null)}
                >
                  Base
                </button>
                {selectedClip.keyframes.map((keyframe) => (
                  <button
                    type="button"
                    key={keyframe.id}
                    className={selectedKeyframeId === keyframe.id ? 'active' : ''}
                    onClick={() => {
                      setSelectedKeyframeId(keyframe.id);
                      seekTimeline((selectedRange?.start ?? 0) + keyframe.time);
                    }}
                  >
                    {keyframe.time.toFixed(1)}s
                  </button>
                ))}
              </div>
            )}
          </div>
          <label>
            <span>Transition in</span>
            <select
              value={selectedClip.transition}
              onChange={(event) => updateClip({ transition: event.target.value as Transition })}
            >
              <option value="none">None</option>
              <option value="fade">Fade</option>
              <option value="slideleft">Slide left</option>
              <option value="slidedown">Drop down</option>
              {historyVintageMode && <option value="screenburn">Screen burn</option>}
              {historyVintageMode && <option value="glitch">Glitch</option>}
            </select>
          </label>
            </>
          ) : selectedTrack === 'text' && selectedText ? (
            <>
              <div className="inspector-title">
                <h3>Text Details</h3>
                <div className="element-actions">
                  <button type="button" className="secondary-btn" onClick={duplicateSelectedText}>Duplicate</button>
                  <button
                    type="button"
                    className="danger-btn"
                    onClick={() => {
                      setTextOverlays((current) => current.filter((overlay) => overlay.id !== selectedText.id));
                      setSelectedTextId(null);
                      setSelectedTrack('visual');
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <label>
                <span>Text</span>
                <textarea
                  className="overlay-text-input"
                  value={selectedText.text}
                  onChange={(event) => updateSelectedText({ text: event.target.value })}
                />
              </label>
              <label>
                <span>Starts on timeline</span>
                <input
                  type="number"
                  min="0"
                  max={timelineDuration}
                  step="0.1"
                  value={selectedText.timelineStart}
                  onChange={(event) => updateSelectedText({
                    timelineStart: Math.min(timelineDuration, Math.max(0, Number(event.target.value) || 0)),
                  })}
                />
              </label>
              <label>
                <span>Text duration</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={selectedText.duration}
                  onChange={(event) => updateSelectedText({
                    duration: Math.max(0.1, Number(event.target.value) || 0.1),
                  })}
                />
              </label>
              <label>
                <span>Font size</span>
                <div className="scale-control">
                  <input type="range" min="16" max="96" value={selectedText.fontSize ?? 44} onInput={(event) => updateSelectedText({ fontSize: Number(event.currentTarget.value) })} />
                  <strong>{selectedText.fontSize ?? 44}px</strong>
                </div>
              </label>
              <div className="color-fields">
                <label>
                  <span>Text color</span>
                  <input type="color" value={selectedText.color ?? '#ffffff'} onChange={(event) => updateSelectedText({ color: event.target.value })} />
                </label>
                <label>
                  <span>Background</span>
                  <input type="color" value={selectedText.backgroundColor ?? '#000000'} onChange={(event) => updateSelectedText({ backgroundColor: event.target.value })} />
                </label>
              </div>
              <label>
                <span>Horizontal position</span>
                <div className="scale-control">
                  <input type="range" min="0" max="100" value={selectedText.positionX ?? 50} onInput={(event) => updateSelectedText({ positionX: Number(event.currentTarget.value) })} />
                  <strong>{selectedText.positionX ?? 50}%</strong>
                </div>
              </label>
              <label>
                <span>Vertical position</span>
                <div className="scale-control">
                  <input type="range" min="0" max="100" value={selectedText.positionY ?? 88} onInput={(event) => updateSelectedText({ positionY: Number(event.currentTarget.value) })} />
                  <strong>{selectedText.positionY ?? 88}%</strong>
                </div>
              </label>
            </>
          ) : selectedTrack === 'effect' && selectedEffect ? (
            <>
              <div className="inspector-title">
                <h3>Sound Effect</h3>
                <div className="element-actions">
                  <button type="button" className="secondary-btn" onClick={duplicateSelectedEffect}>Duplicate</button>
                  <button
                    type="button"
                    className="danger-btn"
                    onClick={() => {
                      setSoundEffects((current) => current.filter((effect) => effect.id !== selectedEffect.id));
                      setSelectedEffectId(null);
                      setSelectedTrack('visual');
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <strong className="selected-file-name">{selectedEffect.file.name}</strong>
              <label>
                <span>Starts on timeline</span>
                <input
                  type="number"
                  min="0"
                  max={timelineDuration}
                  step="0.1"
                  value={selectedEffect.timelineStart}
                  onChange={(event) => updateSelectedEffect({
                    timelineStart: Math.min(timelineDuration, Math.max(0, Number(event.target.value) || 0)),
                  })}
                />
              </label>
              <label>
                <span>Effect duration</span>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={selectedEffect.duration}
                  onChange={(event) => updateSelectedEffect({
                    duration: Math.max(0.1, Number(event.target.value) || 0.1),
                  })}
                />
              </label>
              <label>
                <span>Effect volume</span>
                <div className="scale-control">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={selectedEffect.volume}
                    onInput={(event) => updateSelectedEffect({ volume: Number(event.currentTarget.value) })}
                  />
                  <strong>{selectedEffect.volume}%</strong>
                </div>
              </label>
            </>
          ) : selectedTrack === 'music' && (musicTrack || musicTracks.length > 0) ? (
            <>
              <h3>Music Details</h3>
              <strong className="selected-file-name">
                {musicTracks.length > 0
                  ? `${musicTracks.length} auto music beds`
                  : musicTrack ? musicTrack.label || musicTrack.file.name : 'Background music'}
              </strong>
              {musicTrack && (
                <>
                  <label>
                    <span>Starts on timeline</span>
                    <div className="inline-value">
                      <input
                        type="number"
                        min="0"
                        max={timelineDuration}
                        step="0.1"
                        value={musicTrack.timelineStart}
                        onChange={(event) => setMusicTrack({
                          ...musicTrack,
                          timelineStart: Math.max(0, Number(event.target.value) || 0),
                        })}
                      />
                      <span>seconds</span>
                    </div>
                  </label>
                  <label>
                    <span>Music duration</span>
                    <div className="inline-value">
                      <input
                        type="number"
                        min="0.5"
                        step="0.1"
                        value={musicTrack.duration}
                        onChange={(event) => setMusicTrack({
                          ...musicTrack,
                          duration: Math.max(0.5, Number(event.target.value) || 0.5),
                        })}
                      />
                      <span>seconds</span>
                    </div>
                  </label>
                </>
              )}
              <label>
                <span>Music volume</span>
                <div className="scale-control">
                  <input
                    type="range"
                    min="0"
                    max="40"
                    value={musicTrack?.volume ?? musicTracks[0]?.volume ?? autoMusicVolumeForNiche(niche)}
                    onInput={(event) => {
                      const volume = Number(event.currentTarget.value);
                      if (musicTrack) setMusicTrack({ ...musicTrack, volume });
                      if (musicTracks.length > 0) {
                        setMusicTracks((current) => current.map((track) => ({ ...track, volume })));
                      }
                    }}
                  />
                  <strong>{musicTrack?.volume ?? musicTracks[0]?.volume ?? autoMusicVolumeForNiche(niche)}%</strong>
                </div>
              </label>
              {musicTracks.length > 0 && (
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    void applyAutoBackgroundMusicPlaylist(
                      getAutoBackgroundMusicLibrary(niche),
                      'Background music regenerated automatically.',
                    ).catch((reason) => {
                      setMessage(reason instanceof Error ? reason.message : 'Could not regenerate background music.');
                    });
                  }}
                >
                  Regenerate auto music
                </button>
              )}
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setMusicTrack(null);
                  setMusicTracks([]);
                  setMusicWaveform([]);
                  setMusicWaveforms({});
                }}
              >
                Remove music
              </button>
            </>
          ) : audioTrack ? (
            <>
              <h3>Audio Details</h3>
              <label>
                <span>Starts on timeline</span>
                <div className="inline-value">
                  <input
                    type="number"
                    min="0"
                    max={timelineDuration}
                    step="0.1"
                    value={audioTrack.timelineStart}
                    onChange={(event) => setAudioTrack({
                      ...audioTrack,
                      timelineStart: Math.max(0, Number(event.target.value) || 0),
                    })}
                  />
                  <span>seconds</span>
                </div>
              </label>
              <label>
                <span>Trim audio start</span>
                <div className="inline-value">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={audioTrack.sourceStart}
                    onChange={(event) => setAudioTrack({
                      ...audioTrack,
                      sourceStart: Math.max(0, Number(event.target.value) || 0),
                    })}
                  />
                  <span>seconds</span>
                </div>
              </label>
              <label>
                <span>Audio duration</span>
                <div className="inline-value">
                  <input
                    type="number"
                    min="0.5"
                    step="0.1"
                    value={audioTrack.duration}
                    onChange={(event) => setAudioTrack({
                      ...audioTrack,
                      duration: Math.max(0.5, Number(event.target.value) || 0.5),
                    })}
                  />
                  <span>seconds</span>
                </div>
              </label>
              <label>
                <span>Audio volume</span>
                <div className="scale-control">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={audioTrack.volume}
                    onInput={(event) => setAudioTrack({ ...audioTrack, volume: Number(event.currentTarget.value) })}
                  />
                  <strong>{audioTrack.volume}%</strong>
                </div>
              </label>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setAudioTrack(null);
                  setAudioWaveform([]);
                }}
              >
                Remove audio
              </button>
            </>
          ) : null}
        </aside>
      </div>

      <section className="editor-timeline" aria-label="Project timeline">
        <header className="editor-timeline-header">
          <div className="timeline-command-group">
            <button
              type="button"
              className="secondary-btn timeline-icon-btn"
              disabled={!canUndo}
              onClick={undoProject}
              aria-label="Undo last edit"
              title="Undo last edit"
            >
              <span aria-hidden="true">{TIMELINE_ICONS.undo}</span>
            </button>
            <button
              type="button"
              className="secondary-btn timeline-icon-btn"
              disabled={!canRedo}
              onClick={redoProject}
              aria-label="Redo last edit"
              title="Redo last edit"
            >
              <span aria-hidden="true">{TIMELINE_ICONS.redo}</span>
            </button>
            <span className="toolbar-rule" />
            <button type="button" className="secondary-btn timeline-icon-btn" onClick={trimAtPlayhead} aria-label="Split at playhead" title="Split at playhead (S)">
              <span aria-hidden="true">{TIMELINE_ICONS.split}</span>
            </button>
            <button type="button" className="secondary-btn timeline-icon-btn" onClick={() => retainSideAtPlayhead('left')} aria-label="Keep left side" title="Keep left side of selected element">
              <span aria-hidden="true">{TIMELINE_ICONS.left}</span>
            </button>
            <button type="button" className="secondary-btn timeline-icon-btn" onClick={() => retainSideAtPlayhead('right')} aria-label="Keep right side" title="Keep right side of selected element">
              <span aria-hidden="true">{TIMELINE_ICONS.right}</span>
            </button>
            <button type="button" className="secondary-btn timeline-icon-btn" onClick={duplicateSelection} aria-label="Duplicate selected" title="Duplicate selected (Ctrl+D)">
              <span aria-hidden="true">{TIMELINE_ICONS.duplicate}</span>
            </button>
            <button type="button" className="secondary-btn timeline-icon-btn" onClick={deleteSelection} aria-label="Delete selected" title="Delete selected">
              <span aria-hidden="true">{TIMELINE_ICONS.delete}</span>
            </button>
            <span className="toolbar-rule" />
            <button
              type="button"
              className={`secondary-btn timeline-icon-btn ${snapping ? 'active' : ''}`}
              onClick={() => setSnapping((enabled) => !enabled)}
              aria-label="Toggle snapping"
              title="Toggle snapping"
            >
              <span aria-hidden="true">{TIMELINE_ICONS.snap}</span>
            </button>
            <button
              type="button"
              className="secondary-btn timeline-icon-btn"
              onClick={toggleBookmark}
              aria-label="Add or remove bookmark"
              title="Add or remove bookmark at playhead"
            >
              <span aria-hidden="true">{TIMELINE_ICONS.mark}</span>
            </button>
          </div>
          <div className="timeline-timecode">
            <strong>{formatPlayheadTime(playheadTime)}</strong>
            <span>/ {formatTime(timelineDuration)}</span>
          </div>
          <label className="playhead-control">
            <input
              type="range"
              min="0"
              max={timelineDuration}
              step="0.1"
              value={Math.min(playheadTime, timelineDuration)}
              onInput={(event) => seekTimeline(Number(event.currentTarget.value))}
            />
          </label>
          <div className="timeline-zoom-control" aria-label="Timeline zoom">
            <button
              type="button"
              className="secondary-btn timeline-icon-btn"
              disabled={timelineZoom <= 0.5}
              onClick={() => setTimelineZoom((current) => Math.max(0.5, current - 0.25))}
              title="Zoom out timeline"
            >
              -
            </button>
            <span>{Math.round(timelineZoom * 100)}%</span>
            <button
              type="button"
              className="secondary-btn timeline-icon-btn"
              disabled={timelineZoom >= 3}
              onClick={() => setTimelineZoom((current) => Math.min(3, current + 0.25))}
              title="Zoom in timeline"
            >
              +
            </button>
          </div>
          <button type="button" className="secondary-btn timeline-add" onClick={() => addTextAtPlayhead()}>
            Add text
          </button>
          <label className="secondary-btn timeline-add timeline-file-add">
            Add sound
            <input type="file" accept="audio/*" onChange={handleTimelineSoundEffect} />
          </label>
        </header>
        <div ref={timelineViewportRef} className="track-scroller">
          <div className="timeline-grid">
            <div className="track-label timeline-corner" />
            <div
              className="timeline-ruler"
              style={{ width: `${timelineWidth}px` }}
              onPointerDown={seekFromPointer}
            >
              {timelineTicks.map((seconds) => (
                <span key={seconds} style={{ left: `${seconds * pixelsPerSecond}px` }}>
                  {formatTime(seconds)}
                </span>
              ))}
              {bookmarks.map((time) => (
                <button
                  type="button"
                  className="timeline-bookmark"
                  key={time}
                  style={{ left: `${time * pixelsPerSecond}px` }}
                  onClick={() => seekTimeline(time)}
                  title={`Bookmark ${formatPlayheadTime(time)}`}
                />
              ))}
              <div className="timeline-playhead" style={{ left: `${playheadTime * pixelsPerSecond}px` }} />
            </div>

            <div className="track-label">
              <div>
                <strong>Visuals</strong>
                <small>Clips + images</small>
              </div>
              <span className="track-controls">
                <button type="button" className={visualHidden ? 'active' : ''} onClick={() => setVisualHidden((hidden) => !hidden)} title="Show or hide video track">{visualHidden ? 'Off' : 'Eye'}</button>
                <button type="button" className={lockedTracks.visual ? 'active' : ''} onClick={() => toggleTrackLock('visual')} title="Lock video track">Lock</button>
              </span>
            </div>
            <div
              className={`track-lane visual-track ${visualHidden ? 'track-disabled' : ''} ${lockedTracks.visual ? 'track-locked' : ''}`}
              style={{ width: `${timelineWidth}px` }}
              role="list"
              onPointerDown={seekFromPointer}
            >
              <div className="timeline-playhead lane-playhead" style={{ left: `${playheadTime * pixelsPerSecond}px` }} />
              {clips.map((clip, index) => (
                <button
                  type="button"
                  key={clip.clipId}
                  className={`timeline-clip ${clip.hidden ? 'clip-hidden' : ''} ${selectedTrack === 'visual' && selectedClipId === clip.clipId ? 'active' : ''}`}
                  style={{ width: `${Math.max(20, clip.duration * pixelsPerSecond)}px` }}
                  draggable={!lockedTracks.visual}
                  onDragStart={() => setDraggingClipId(clip.clipId)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => reorderClip(clip.clipId)}
                  onDragEnd={() => setDraggingClipId(null)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setSelectedTrack('visual');
                    setSelectedClipId(clip.clipId);
                    setSelectedKeyframeId(null);
                    setClipContextMenu({
                      x: Math.min(event.clientX, window.innerWidth - 224),
                      y: Math.min(event.clientY, window.innerHeight - 300),
                    });
                  }}
                  onClick={() => {
                    setIsPlaying(false);
                    setSelectedTrack('visual');
                    setSelectedClipId(clip.clipId);
                    setSelectedKeyframeId(null);
                    seekTimeline(clipRanges[index].start);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={clip.asset.thumbnail} alt="" />
                  <strong>{String(index + 1).padStart(2, '0')}</strong>
                  <span>{clip.duration.toFixed(1)}s</span>
                  {clip.hidden && <small>Hidden</small>}
                  {clip.keyframes.map((keyframe) => (
                    <i
                      className="keyframe-marker"
                      key={keyframe.id}
                      style={{ left: `${Math.min(100, Math.max(0, (keyframe.time / clip.duration) * 100))}%` }}
                    />
                  ))}
                  <span
                    className="duration-handle"
                    onDragStart={(event) => event.preventDefault()}
                    onPointerDown={(event) => {
                      if (!lockedTracks.visual) startDurationDrag(event, clip.clipId);
                    }}
                    title="Drag to adjust duration"
                  />
                </button>
              ))}
            </div>

            <div className="track-label">
              <div>
                <strong>Text</strong>
                <small>Titles</small>
              </div>
              <span className="track-controls">
                <button type="button" className={textHidden ? 'active' : ''} onClick={() => setTextHidden((hidden) => !hidden)} title="Show or hide text track">{textHidden ? 'Off' : 'Eye'}</button>
                <button type="button" className={lockedTracks.text ? 'active' : ''} onClick={() => toggleTrackLock('text')} title="Lock text track">Lock</button>
              </span>
            </div>
            <div
              className={`track-lane overlay-track ${textHidden ? 'track-disabled' : ''} ${lockedTracks.text ? 'track-locked' : ''}`}
              style={{ width: `${timelineWidth}px` }}
              onPointerDown={seekFromPointer}
            >
              <div className="timeline-playhead lane-playhead" style={{ left: `${playheadTime * pixelsPerSecond}px` }} />
              {textOverlays.map((overlay) => (
                <button
                  type="button"
                  key={overlay.id}
                  className={`text-clip ${selectedTrack === 'text' && selectedTextId === overlay.id ? 'selected' : ''}`}
                  style={{
                    left: `${overlay.timelineStart * pixelsPerSecond}px`,
                    width: `${Math.max(72, overlay.duration * pixelsPerSecond)}px`,
                  }}
                  onPointerDown={(event) => {
                    if (!lockedTracks.text) {
                      startTimelineMove(
                        event,
                        overlay.timelineStart,
                        overlay.duration,
                        (timelineStart) => setTextOverlays((current) => current.map((entry) => (
                          entry.id === overlay.id ? { ...entry, timelineStart } : entry
                        ))),
                      );
                    }
                  }}
                  onClick={() => {
                    setSelectedTrack('text');
                    setSelectedTextId(overlay.id);
                  }}
                >
                  {overlay.text || 'Text'}
                </button>
              ))}
            </div>

            <div className="track-label">
              <div>
                <strong>SFX</strong>
                <small>Effects</small>
              </div>
              <span className="track-controls">
                <button type="button" className={effectsMuted ? 'active' : ''} onClick={() => setEffectsMuted((muted) => !muted)} title="Mute sound effects">{effectsMuted ? 'Mute' : 'Vol'}</button>
                <button type="button" className={lockedTracks.effect ? 'active' : ''} onClick={() => toggleTrackLock('effect')} title="Lock sound effects">Lock</button>
              </span>
            </div>
            <div
              className={`track-lane effects-track ${effectsMuted ? 'track-disabled' : ''} ${lockedTracks.effect ? 'track-locked' : ''}`}
              style={{ width: `${timelineWidth}px` }}
              onPointerDown={seekFromPointer}
            >
              <div className="timeline-playhead lane-playhead" style={{ left: `${playheadTime * pixelsPerSecond}px` }} />
              {soundEffects.map((effect) => (
                <button
                  type="button"
                  key={effect.id}
                  className={`effect-clip ${selectedTrack === 'effect' && selectedEffectId === effect.id ? 'selected' : ''}`}
                  style={{
                    left: `${effect.timelineStart * pixelsPerSecond}px`,
                    width: `${Math.max(72, effect.duration * pixelsPerSecond)}px`,
                  }}
                  onPointerDown={(event) => {
                    if (!lockedTracks.effect) {
                      startTimelineMove(
                        event,
                        effect.timelineStart,
                        effect.duration,
                        (timelineStart) => setSoundEffects((current) => current.map((entry) => (
                          entry.id === effect.id ? { ...entry, timelineStart } : entry
                        ))),
                      );
                    }
                  }}
                  onClick={() => {
                    setSelectedTrack('effect');
                    setSelectedEffectId(effect.id);
                  }}
                >
                  <strong>{effect.file.name}</strong>
                  {effectWaveforms[effect.id]?.length > 0 && (
                    <span className="waveform-bars compact">
                      {effectWaveforms[effect.id].map((height, index) => (
                        <i key={index} style={{ height: `${height * 100}%` }} />
                      ))}
                    </span>
                  )}
                </button>
              ))}
              {soundEffectUrls.map((effect) => (
                <audio
                  key={effect.id}
                  ref={(element) => { effectRefs.current[effect.id] = element; }}
                  src={effect.url}
                />
              ))}
            </div>

            <div className="track-label">
              <div>
                <strong>Audio</strong>
                <small>Voiceover</small>
              </div>
              <span className="track-controls">
                <button type="button" className={audioMuted ? 'active' : ''} onClick={() => setAudioMuted((muted) => !muted)} title="Mute background audio">{audioMuted ? 'Mute' : 'Vol'}</button>
                <button type="button" className={lockedTracks.audio ? 'active' : ''} onClick={() => toggleTrackLock('audio')} title="Lock audio track">Lock</button>
              </span>
            </div>
            <div
              className={`track-lane audio-track ${audioMuted ? 'track-disabled' : ''} ${lockedTracks.audio ? 'track-locked' : ''}`}
              style={{ width: `${timelineWidth}px` }}
              onPointerDown={seekFromPointer}
            >
              <div className="timeline-playhead lane-playhead" style={{ left: `${playheadTime * pixelsPerSecond}px` }} />
              {audioTrack ? (
                <button
                  type="button"
                  className={`audio-clip ${selectedTrack === 'audio' ? 'selected' : ''}`}
                  style={{
                    left: `${audioTrack.timelineStart * pixelsPerSecond}px`,
                    width: `${Math.max(90, audioTrack.duration * pixelsPerSecond)}px`,
                  }}
                  onPointerDown={(event) => {
                    if (!lockedTracks.audio) {
                      startTimelineMove(
                        event,
                        audioTrack.timelineStart,
                        audioTrack.duration,
                        (timelineStart) => setAudioTrack({ ...audioTrack, timelineStart }),
                      );
                    }
                  }}
                  onClick={() => setSelectedTrack('audio')}
                >
                  <div className="audio-clip-copy">
                    <strong>{audioTrack.file.name}</strong>
                    <span>Voiceover audio</span>
                  </div>
                  {audioWaveform.length > 0 && (
                    <span className="waveform-bars">
                      {audioWaveform.map((height, index) => (
                        <i key={index} style={{ height: `${height * 100}%` }} />
                      ))}
                    </span>
                  )}
                </button>
              ) : (
                <label className="empty-audio-track">
                  <input type="file" accept="audio/*" onChange={handleBackgroundAudio} />
                  <strong>Add audio</strong>
                </label>
              )}
              {backgroundAudioUrl && <audio ref={audioRef} src={backgroundAudioUrl} />}
            </div>

            <div className="track-label">
              <div>
                <strong>Music</strong>
                <small>Background bed</small>
              </div>
              <span className="track-controls">
                <button type="button" className={musicMuted ? 'active' : ''} onClick={() => setMusicMuted((muted) => !muted)} title="Mute background music">{musicMuted ? 'Mute' : 'Vol'}</button>
                <button type="button" className={lockedTracks.music ? 'active' : ''} onClick={() => toggleTrackLock('music')} title="Lock music track">Lock</button>
              </span>
            </div>
            <div
              className={`track-lane audio-track ${musicMuted ? 'track-disabled' : ''} ${lockedTracks.music ? 'track-locked' : ''}`}
              style={{ width: `${timelineWidth}px` }}
              onPointerDown={seekFromPointer}
            >
              <div className="timeline-playhead lane-playhead" style={{ left: `${playheadTime * pixelsPerSecond}px` }} />
              {musicTracks.length > 0 ? (
                musicTracks.map((track, index) => {
                  const key = track.id || `music-${index}`;
                  return (
                    <button
                      type="button"
                      key={key}
                      className={`audio-clip ${selectedTrack === 'music' ? 'selected' : ''}`}
                      style={{
                        left: `${track.timelineStart * pixelsPerSecond}px`,
                        width: `${Math.max(90, track.duration * pixelsPerSecond)}px`,
                      }}
                      onPointerDown={(event) => {
                        if (!lockedTracks.music) {
                          startTimelineMove(
                            event,
                            track.timelineStart,
                            track.duration,
                            (timelineStart) => setMusicTracks((current) => current.map((entry) => (
                              (entry.id || entry.file.name) === (track.id || track.file.name)
                                ? { ...entry, timelineStart }
                                : entry
                            ))),
                          );
                        }
                      }}
                      onClick={() => setSelectedTrack('music')}
                    >
                      <div className="audio-clip-copy">
                        <strong>{track.label || track.file.name}</strong>
                        <span>Auto background bed {index + 1}</span>
                      </div>
                      {(musicWaveforms[key] || []).length > 0 && (
                        <span className="waveform-bars">
                          {(musicWaveforms[key] || []).map((height, barIndex) => (
                            <i key={barIndex} style={{ height: `${height * 100}%` }} />
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })
              ) : musicTrack ? (
                <button
                  type="button"
                  className={`audio-clip ${selectedTrack === 'music' ? 'selected' : ''}`}
                  style={{
                    left: `${musicTrack.timelineStart * pixelsPerSecond}px`,
                    width: `${Math.max(90, musicTrack.duration * pixelsPerSecond)}px`,
                  }}
                  onPointerDown={(event) => {
                    if (!lockedTracks.music) {
                      startTimelineMove(
                        event,
                        musicTrack.timelineStart,
                        musicTrack.duration,
                        (timelineStart) => setMusicTrack({ ...musicTrack, timelineStart }),
                      );
                    }
                  }}
                  onClick={() => setSelectedTrack('music')}
                >
                  <div className="audio-clip-copy">
                    <strong>{musicTrack.label || musicTrack.file.name}</strong>
                    <span>Looping background music</span>
                  </div>
                  {musicWaveform.length > 0 && (
                    <span className="waveform-bars">
                      {musicWaveform.map((height, index) => (
                        <i key={index} style={{ height: `${height * 100}%` }} />
                      ))}
                    </span>
                  )}
                </button>
              ) : (
                <div className="empty-audio-track">
                  <label>
                    <input type="file" accept="audio/*" onChange={handleBackgroundMusic} />
                    <strong>Add music</strong>
                  </label>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => {
                      void applyAutoBackgroundMusicPlaylist(
                        getAutoBackgroundMusicLibrary(niche),
                        'Background music added automatically.',
                      ).catch((reason) => {
                        setMessage(reason instanceof Error ? reason.message : 'Could not add auto background music.');
                      });
                    }}
                  >
                    Add auto music
                  </button>
                </div>
              )}
              {backgroundMusicUrl && <audio ref={musicRef} src={backgroundMusicUrl} loop />}
              {backgroundMusicUrls.map((track) => (
                <audio
                  key={track.id}
                  ref={(element) => {
                    musicRefs.current[track.id] = element;
                  }}
                  src={track.url}
                />
              ))}
            </div>
          </div>
        </div>
      </section>
      {clipContextMenu && (
        <menu
          className="clip-context-menu"
          style={{ left: `${clipContextMenu.x}px`, top: `${clipContextMenu.y}px` }}
          onPointerDown={(event) => event.stopPropagation()}
          aria-label="Clip actions"
          role="menu"
        >
          <button type="button" role="menuitem" onClick={() => { trimAtPlayhead(); setClipContextMenu(null); }}>
            <span>Split</span><kbd>S</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => { copySelectedClip(); setClipContextMenu(null); }}>
            <span>Copy</span><kbd>CTRL C</kbd>
          </button>
          {hasCopiedClip && (
            <button type="button" role="menuitem" onClick={() => { pasteCopiedClip(); setClipContextMenu(null); }}>
              <span>Paste after clip</span><kbd>CTRL V</kbd>
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => { duplicateSelectedClip(); setClipContextMenu(null); }}>
            <span>Duplicate</span><kbd>CTRL D</kbd>
          </button>
          <button type="button" role="menuitem" onClick={() => { updateClip({ hidden: !selectedClip.hidden }); setClipContextMenu(null); }}>
            <span>{selectedClip.hidden ? 'Show' : 'Hide'}</span>
          </button>
          <button type="button" role="menuitem" onClick={() => { revealSelectedMedia(); setClipContextMenu(null); }}>
            <span>Reveal media</span>
          </button>
          <button type="button" role="menuitem" onClick={() => { revealSelectedMedia(true); setClipContextMenu(null); }}>
            <span>Replace media</span>
          </button>
          <hr />
          <button type="button" role="menuitem" className="delete-action" onClick={() => { deleteSelectedClip(); setClipContextMenu(null); }}>
            <span>Delete clip</span><kbd>BACKSPACE</kbd>
          </button>
        </menu>
      )}
      {message && <p className="video-lab-message">{message}</p>}
    </section>
  );
}
