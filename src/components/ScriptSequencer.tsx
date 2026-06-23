'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResultItem } from '@/types';
import VideoLab, { VideoLabSourceScene } from '@/components/VideoLab';
import { mediaRightsScore, withMediaRights } from '@/lib/mediaRights';
import {
  MAX_STORYBOARD_ASSET_REUSE,
  assetUsageCount,
  assetUsageRecord,
  freshAssetCandidates,
  primaryAssetKey,
  registerAssetUsage,
} from '@/lib/mediaIdentity';
import { isVisuallyUnsafeForScene, mediaSafetyPenalty } from '@/lib/mediaSafety';

type MediaPreference = 'all' | 'image' | 'video' | 'image-unfiltered';
type TrueCrimeCaseTime = 'unspecified' | 'day' | 'night';

function isUnfilteredMediaPreference(preference: MediaPreference) {
  return preference === 'image-unfiltered';
}

function storyboardSearchType(preference: MediaPreference): 'all' | 'image' {
  return preference === 'all' || preference === 'video' ? 'all' : 'image';
}

function storyboardPlanningPreference(preference: MediaPreference): 'all' | 'image' | 'video' {
  return preference === 'image-unfiltered' ? 'image' : preference;
}

const YOUTUBE_NICHES = [
  'history (vintage)',
  'true crime',
  'motivational',
  'self improvement',
  'personal finance and investing',
];
const LICENSE_FILTERED_WEB_SOURCES = ['DuckDuckGo', 'Bing', 'Yahoo'];

function normalizeSelectedNiche(value: string) {
  const key = value.toLowerCase();
  if (key.includes('true crime') || key.includes('scary') || key.includes('horror')) return 'true crime';
  if (key.includes('motivat')) return 'motivational';
  if (key.includes('self')) return 'self improvement';
  if (key.includes('finance') || key.includes('invest')) return 'personal finance and investing';
  return 'history (vintage)';
}

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

interface StoryboardDraft {
  scenes: Scene[];
  youtubeNiche: string;
  trueCrimeCaseTitle: string;
  trueCrimeCaseTime?: TrueCrimeCaseTime;
  trueCrimeResearch?: TrueCrimeResearch | null;
  editingInstructions: string;
  mediaPreference: MediaPreference;
  script: string;
  savedAt: number;
  version: 3;
}

interface ScriptSequencerProps {
  onDownloadScene: (item: ResultItem, start: number, end: number, customName?: string) => Promise<void>;
  onDownloadAsset: (item: ResultItem, customName?: string) => Promise<void>;
  isDownloading: (id: string) => boolean;
}

export interface StoryboardVoiceOver {
  file: File;
  duration: number;
  words?: WordTiming[];
  transcript?: string;
}

interface PlannedScene {
  scene_number: number;
  scene_text: string;
  duration_seconds: number;
  visual_description: string;
  search_terms: string[];
}

interface WordTiming {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

interface VoiceoverTranscription {
  mode?: string;
  provider?: string;
  transcript?: string;
  words: WordTiming[];
  durationSeconds: number;
  warning?: string;
}

interface TrueCrimeResearchSource {
  title: string;
  subreddit: string;
  url: string;
}

interface TrueCrimeResearch {
  caseTitle: string;
  postsFound: number;
  keyTerms: string[];
  sourceLinks: TrueCrimeResearchSource[];
  researchContext: string;
  warning?: string;
}

const SCENES_PER_PLANNING_BATCH = 8;
const STORYBOARD_DRAFT_KEY = 'vitevid-storyboard-draft-v1';
const STORYBOARD_DRAFT_META_KEY = 'vitevid-storyboard-draft-meta-v2';
const STORYBOARD_DRAFT_DB_NAME = 'vitevid-storyboard-drafts';
const STORYBOARD_DRAFT_STORE = 'drafts';
const STORYBOARD_DRAFT_ID = 'active-storyboard';
const MIN_TRANSCRIPT_SCENE_SECONDS = 0.45;
const SOFT_MAX_TRANSCRIPT_SCENE_SECONDS = 8;
const SOFT_MAX_TRANSCRIPT_SCENE_WORDS = 14;
const HISTORY_HARD_MAX_SCENE_SECONDS = 4.85;
const HISTORY_TARGET_TRANSCRIPT_SCENE_SECONDS = HISTORY_HARD_MAX_SCENE_SECONDS;
const HISTORY_SOFT_MAX_TRANSCRIPT_SCENE_SECONDS = HISTORY_HARD_MAX_SCENE_SECONDS;
const HISTORY_SOFT_MAX_TRANSCRIPT_SCENE_WORDS = SOFT_MAX_TRANSCRIPT_SCENE_WORDS;
const HISTORY_CONTEXTUAL_DEFAULT_SCENE_SECONDS = 4.2;
const HISTORY_CONTEXTUAL_FAST_SCENE_SECONDS = 2.6;
const HISTORY_CONTEXTUAL_HOLD_SCENE_SECONDS = 4.6;
const HISTORY_CONTEXTUAL_DEFAULT_MAX_SECONDS = HISTORY_HARD_MAX_SCENE_SECONDS;
const HISTORY_CONTEXTUAL_HOLD_MAX_SECONDS = HISTORY_HARD_MAX_SCENE_SECONDS;
const HISTORY_CONTEXTUAL_DEFAULT_MAX_WORDS = 30;
const HISTORY_CONTEXTUAL_HOLD_MAX_WORDS = 42;
const TRUE_CRIME_SOFT_MAX_TRANSCRIPT_SCENE_SECONDS = 15;
const TRUE_CRIME_TARGET_TRANSCRIPT_SCENE_SECONDS = 10;
const TRUE_CRIME_SOFT_MAX_TRANSCRIPT_SCENE_WORDS = 36;
const VISIBLE_SCENE_BATCH = 80;
const GUARANTEED_NICHE_VIDEOS: Record<string, Array<{
  id: string;
  title: string;
  year: string;
  tags: string[];
}>> = {
  history: [
    { id: 'TripDown1905', title: 'Trip Down Market Street Before the Fire', year: '1905', tags: ['vintage', 'historic street', 'old film'] },
    { id: 'FromtheG1954', title: 'From the Ground Up', year: '1954', tags: ['vintage', 'american life', 'old film'] },
    { id: 'DayofTha1951', title: 'Day of Thanksgiving', year: '1951', tags: ['vintage family', 'american home', 'old film'] },
    { id: 'EatforHe1954', title: 'Eat for Health', year: '1954', tags: ['vintage people', 'home life', 'old film'] },
  ],
  'true crime': [
    { id: 'Terrible1951', title: 'The Terrible Truth', year: '1951', tags: ['investigation', 'crime warning', 'vintage'] },
    { id: '0424_Child_Molester_The_01_00_05_00', title: 'The Child Molester', year: '1964', tags: ['police', 'investigation', 'public safety'] },
    { id: 'boys_beware', title: 'Boys Beware', year: '1961', tags: ['public safety', 'police', 'vintage'] },
  ],
  motivational: [
    { id: 'MakeMine1948', title: 'Make Mine Freedom', year: '1948', tags: ['success', 'work', 'freedom'] },
    { id: 'HealthYo1953', title: 'Health: Your Posture', year: '1953', tags: ['discipline', 'self improvement', 'training'] },
    { id: 'Exercise1949', title: 'Exercise and Health', year: '1949', tags: ['exercise', 'training', 'health'] },
  ],
  'self improvement': [
    { id: 'HealthYo1953', title: 'Health: Your Posture', year: '1953', tags: ['habits', 'posture', 'health'] },
    { id: 'Exercise1949', title: 'Exercise and Health', year: '1949', tags: ['routine', 'exercise', 'health'] },
    { id: 'ForHealt1941', title: 'For Health and Happiness', year: '1941', tags: ['health', 'routine', 'happiness'] },
  ],
  finance: [
    { id: 'Usingthe1947', title: 'Using the Bank', year: '1947', tags: ['bank', 'money', 'finance'] },
    { id: 'Financin1935', title: 'Financing the American Family', year: '1935', tags: ['family finance', 'budget', 'money'] },
    { id: 'Internat1941', title: 'International Moves the Browns to Sterling Street', year: '1941', tags: ['household', 'family budget', 'home'] },
  ],
};
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
    audio.src = url;
  });
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

function nicheKey(niche: string) {
  return niche.toLowerCase();
}

function isTrueCrimeNicheValue(niche: string) {
  return nicheKey(niche).includes('true crime');
}

function normalizeCaseTitle(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeTrueCrimeCaseTime(value: unknown): TrueCrimeCaseTime {
  if (typeof value !== 'string') return 'unspecified';
  const key = value.toLowerCase();
  if (key.includes('night')) return 'night';
  if (key.includes('day')) return 'day';
  return 'unspecified';
}

function withTrueCrimeCaseContext(query: string, niche: string, caseTitle: string) {
  const cleanQuery = query.replace(/\s+/g, ' ').trim();
  const cleanCase = normalizeCaseTitle(caseTitle);
  if (!cleanQuery || !cleanCase || !isTrueCrimeNicheValue(niche)) return cleanQuery;
  if (cleanQuery.toLowerCase().includes(cleanCase.toLowerCase())) return cleanQuery;
  return `${cleanCase} ${cleanQuery}`;
}

function withTrueCrimeCaseTimeContext(query: string, niche: string, caseTime: TrueCrimeCaseTime) {
  const cleanQuery = query.replace(/\s+/g, ' ').trim();
  if (!cleanQuery || !isTrueCrimeNicheValue(niche) || caseTime === 'unspecified') return cleanQuery;
  const lower = cleanQuery.toLowerCase();
  if (caseTime === 'night') {
    if (/\b(night|nighttime|midnight|evening|after dark|dark)\b/i.test(lower)) return cleanQuery;
    if (/\b(court|courtroom|trial|mugshot|records?|documents?|newspaper|poster|report|file|map|timeline)\b/i.test(lower)) {
      return cleanQuery;
    }
    return `${cleanQuery} night`;
  }
  if (/\b(daytime|daylight|morning|afternoon|sunny|day scene)\b/i.test(lower)) return cleanQuery;
  if (/\b(court|courtroom|trial|mugshot|records?|documents?|newspaper|poster|report|file|map|timeline)\b/i.test(lower)) {
    return cleanQuery;
  }
  return `${cleanQuery} daylight`;
}

function applyTrueCrimeCaseContext(
  queries: string[],
  niche: string,
  caseTitle: string,
  caseTime: TrueCrimeCaseTime = 'unspecified',
) {
  return Array.from(new Set(
    queries
      .map((query) => withTrueCrimeCaseContext(query, niche, caseTitle))
      .map((query) => withTrueCrimeCaseTimeContext(query, niche, caseTime))
      .filter((query) => query.trim()),
  ));
}

function fallbackGroupForNiche(niche: string) {
  const key = nicheKey(niche);
  if (key.includes('true crime')) return 'true crime';
  if (key.includes('motivational')) return 'motivational';
  if (key.includes('self improvement')) return 'self improvement';
  if (key.includes('finance')) return 'finance';
  return 'history';
}

function createGuaranteedFallbackAsset(scene: Scene, niche: string, offset = 0): ResultItem {
  const group = fallbackGroupForNiche(niche);
  const pool = GUARANTEED_NICHE_VIDEOS[group] || GUARANTEED_NICHE_VIDEOS.history;
  const selected = pool[(Math.abs(scene.id) + offset) % pool.length];
  return {
    id: `guaranteed-${selected.id}`,
    source: 'Internet Archive',
    title: selected.title,
    type: 'video',
    thumbnail: `https://archive.org/services/img/${selected.id}`,
    url: `https://archive.org/details/${selected.id}`,
    year: selected.year,
    description: `Guaranteed real public-domain fallback video for ${niche}. Used only when exact scene search returns no safe clip.`,
    downloads: 0,
    tags: selected.tags,
    downloadUrl: `https://archive.org/download/${selected.id}/${selected.id}.mp4`,
    rightsStatus: 'verified-safe',
    rightsLabel: 'Verified open',
    rightsNote: 'Public-domain archival fallback selected by ViteVid to avoid empty scenes. Check the Internet Archive details page before final publishing.',
    license: 'Public domain / no known copyright restrictions',
    licenseUrl: 'https://creativecommons.org/publicdomain/mark/1.0/',
    attribution: `${selected.title} - Internet Archive`,
    sourcePageUrl: `https://archive.org/details/${selected.id}`,
    isCopyrightSafe: true,
    needsRightsReview: false,
  };
}

function createFreshFallbackAsset(scene: Scene, niche: string, usage: Map<string, number>) {
  const group = fallbackGroupForNiche(niche);
  const pool = GUARANTEED_NICHE_VIDEOS[group] || GUARANTEED_NICHE_VIDEOS.history;
  return Array.from({ length: pool.length }, (_, offset) => createGuaranteedFallbackAsset(scene, niche, offset))
    .sort((left, right) => assetUsageCount(usage, left) - assetUsageCount(usage, right))[0];
}

function getNicheQueryVariants(query: string, niche: string) {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];
  const key = nicheKey(niche);
  if (key.includes('history')) {
    return [
      `${cleanQuery} vintage photo`,
      `${cleanQuery} archival photograph`,
      `${cleanQuery} archival film still`,
      `${cleanQuery} old news footage still`,
      `${cleanQuery} vintage documentary photo`,
      `${cleanQuery} black and white historic photo`,
      cleanQuery,
    ];
  }
  if (key.includes('true crime')) {
    return [
      `${cleanQuery} real case photo`,
      `${cleanQuery} true crime case photo`,
      `${cleanQuery} crime scene photo`,
      `${cleanQuery} investigation evidence photo`,
      `${cleanQuery} police documentary photo`,
      `${cleanQuery} courtroom documents photo`,
      cleanQuery,
    ];
  }
  if (key.includes('motivational')) {
    return [
      `${cleanQuery} cinematic real photo`,
      `${cleanQuery} people action photo`,
      `${cleanQuery} success documentary photo`,
      cleanQuery,
    ];
  }
  if (key.includes('self improvement')) {
    return [
      `${cleanQuery} habits real photo`,
      `${cleanQuery} focused work photo`,
      `${cleanQuery} personal growth real photo`,
      cleanQuery,
    ];
  }
  if (key.includes('finance')) {
    return [
      `${cleanQuery} money finance photo`,
      `${cleanQuery} bank documents real photo`,
      `${cleanQuery} cash savings photo`,
      cleanQuery,
    ];
  }
  return [cleanQuery];
}

function expandQueriesForNiche(queries: string[], niche: string) {
  return Array.from(new Set(queries.flatMap((query) => getNicheQueryVariants(query, niche))));
}

function getNicheFallbackQueries(niche: string) {
  const key = nicheKey(niche);
  if (key.includes('history')) {
    return [
      'vintage american photo',
      'archival american family photo',
      'old american news footage still',
      'vintage documentary film still',
      'vintage american product advertisement',
      'old government document photograph',
      'historic newspaper headline photo',
      'vintage chart graphic',
      'old map archival image',
      'vintage food close up',
      'historic street archival photo',
      'black and white documentary photograph',
      'old newspaper archive photo',
      'vintage city street photograph',
      'historic building archival photo',
    ];
  }
  if (key.includes('true crime')) {
    return [
      'true crime case photo',
      'real crime scene photo',
      'police evidence photo',
      'court records photo',
      'mugshot photo',
      'missing person poster photo',
      'police investigation photo',
      'crime scene tape photo',
      'detective evidence photo',
      'forensic lab photo',
      'police car night photo',
      'courtroom documents photo',
      'evidence documents photo',
      'interrogation room photo',
    ];
  }
  if (key.includes('motivational')) {
    return [
      'person walking forward photo',
      'runner training photo',
      'sunrise city real photo',
      'business success photo',
      'person working hard photo',
      'athlete training photo',
      'team celebration photo',
      'mountain climb photo',
    ];
  }
  if (key.includes('self improvement')) {
    return [
      'morning routine photo',
      'person journaling photo',
      'healthy habits photo',
      'person reading photo',
      'focused work desk photo',
      'meditation photo',
      'workout routine photo',
      'planning notebook photo',
    ];
  }
  if (key.includes('finance')) {
    return [
      'counting money real photo',
      'stock market chart photo',
      'budget planning photo',
      'cash savings photo',
      'bank documents photo',
      'investment chart photo',
      'coins close up photo',
      'paying bills photo',
    ];
  }
  return [];
}

function createFallbackQueries(scene: Scene, niche: string, caseTitle = '', caseTime: TrueCrimeCaseTime = 'unspecified') {
  const visibleSubject = extractKeywords(scene.visualConcept || scene.text)
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
  const sceneSubject = extractKeywords(scene.text)
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
  return applyTrueCrimeCaseContext(expandQueriesForNiche([
    `${visibleSubject}`,
    `${sceneSubject} retro`,
    `${sceneSubject} american`,
    ...getNicheFallbackQueries(niche).slice(0, 4),
  ].filter((query) => query.trim()), niche), niche, caseTitle, caseTime);
}

function createBroadFallbackQueries(scene: Scene, niche: string, caseTitle = '', caseTime: TrueCrimeCaseTime = 'unspecified') {
  const sourceText = `${scene.text} ${scene.visualConcept} ${scene.searchTerms.join(' ')}`.toLowerCase();
  const subject = extractKeywords(sourceText)
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
  const queries = [
    subject,
    'people indoors',
    'hands writing',
    'paper documents',
    'family at table',
    'american family',
    'american crowd',
    'city street',
    'old city street',
    'people walking',
    'old house',
    'newspaper',
    'newspaper archive',
    'old news footage still',
    'vintage documentary film still',
    'archival film frame',
    'black and white newsreel',
    'government building',
    'men in suits',
    'public speech',
  ];

  if (/\b(budget|cash|money|dollar|coin|coins|envelope|rent|utilities|grocery|groceries|bank|banks|credit|debt|bills?|spending|paying|savings?)\b/.test(sourceText)) {
    queries.push(
      'cash envelope budgeting',
      'counting cash',
      'counting coins',
      'household budget',
      'family budget',
      'paying bills',
      'bills on table',
      'paper envelopes',
      'wallet cash',
      'ledger book',
      'paper ledger book',
      'old financial chart',
      'bank teller',
      'piggy bank',
    );
  }

  if (/\b(depression|bread|bakery|bakeries|ration|rations|unemployed|closed|collapsed|scarcity|poor|poverty|queue|line)\b/.test(sourceText)) {
    queries.push(
      'great depression family',
      'bread bakery',
      'old bakery bread',
      'family eating bread',
      'closed bank',
      'unemployed men line',
      '1930s family',
      'vintage grocery store',
    );
  }

  if (/\b(flood|disaster|devastating|destroyed|washed|water|storm|emergency|dayton|ohio)\b/.test(sourceText)) {
    queries.push(
      'historic flood',
      'flooded street',
      'old town flood',
      'disaster aftermath',
      'people watching disaster',
      'american town flood',
    );
  }

  if (/\b(congress|senate|president|politician|financial advisor|country|america|american|law|government|crisis)\b/.test(sourceText)) {
    queries.push(
      'politician speech',
      'congress hearing',
      'government building',
      'american flag crowd',
      'old government document',
      'historic newspaper headline',
      'vintage office meeting',
      'men in suits talking',
    );
  }

  if (/\b(year|decade|century|map|route|city|state|county|america|american|migration|spread|across|where)\b/.test(sourceText)) {
    queries.push(
      'old map archival image',
      'historic american map',
      'vintage map documentary',
      'old city map',
    );
  }

  if (/\b(percent|percentage|statistics?|cost|price|prices|chart|graph|surge|increase|decrease|profit|loss|inflation)\b/.test(sourceText)) {
    queries.push(
      'vintage chart graphic',
      'old statistical chart',
      'documentary bar chart',
      'historic financial chart',
    );
  }

  if (/\b(food|bacon|grease|jar|soap|bread|coffee|salt|pepper|egg|eggs|meat|cooking|kitchen|pan|pot|recipe|garden|vegetables?)\b/.test(sourceText)) {
    queries.push(
      'vintage food close up',
      'old kitchen cooking photo',
      'vintage household product',
      'vintage pantry shelves',
      'food preparation close up',
    );
  }

  if (/\b(app|apps|spreadsheet|technology|online|modern|screen|computer)\b/.test(sourceText)) {
    queries.push(
      'person using laptop',
      'spreadsheet on laptop',
      'office computer',
      'hands typing',
    );
  }

  queries.push(...getNicheFallbackQueries(niche));

  return applyTrueCrimeCaseContext(
    expandQueriesForNiche(Array.from(new Set(queries.filter((query) => query.trim()))), niche),
    niche,
    caseTitle,
    caseTime,
  ).slice(0, 32);
}

function createLastChanceQueries(scene: Scene, niche: string, caseTitle = '', caseTime: TrueCrimeCaseTime = 'unspecified') {
  const sourceText = `${scene.text} ${scene.visualConcept} ${scene.searchTerms.join(' ')}`.toLowerCase();
  const queries = [
    'vintage american people',
    'american family',
    'old city street',
    'hands writing',
    'paper documents',
    'newspaper archive',
    'men in suits',
    'public speech',
  ];

  if (/\b(money|cash|dollar|coins?|budget|bank|credit|debt|bills?|rent|grocery|paying|savings?)\b/.test(sourceText)) {
    queries.unshift('counting cash', 'household budget', 'paying bills', 'old financial chart', 'paper ledger book');
  }

  if (/\b(depression|bread|bakery|unemployed|poverty|closed|scarcity|1930s)\b/.test(sourceText)) {
    queries.unshift('great depression family', 'bread line', 'old bakery bread');
  }

  if (/\b(flood|storm|disaster|water|destroyed|emergency)\b/.test(sourceText)) {
    queries.unshift('historic flood', 'flooded street', 'disaster aftermath');
  }

  if (/\b(percent|percentage|statistics?|cost|price|chart|graph|increase|decrease)\b/.test(sourceText)) {
    queries.unshift('vintage chart graphic', 'old statistical chart');
  }

  queries.unshift(...getNicheFallbackQueries(niche));

  return applyTrueCrimeCaseContext(Array.from(new Set(queries)), niche, caseTitle, caseTime).slice(0, 16);
}

function buildPrimarySearchQueries(scene: Scene, niche: string, caseTitle = '', caseTime: TrueCrimeCaseTime = 'unspecified') {
  const plannedTerms = scene.searchTerms.filter(Boolean);
  const visualTerms = extractKeywords(scene.visualConcept || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');
  const spokenTerms = extractKeywords(scene.text)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');
  const compactScene = scene.text
    .replace(/[^a-z0-9\s$]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((word) => !STOP_WORDS.has(word.toLowerCase()))
    .slice(0, 5)
    .join(' ');

  return applyTrueCrimeCaseContext(expandQueriesForNiche([
    spokenTerms,
    compactScene,
    visualTerms,
    ...plannedTerms,
    scene.keywords,
  ].filter((query) => query.trim()), niche), niche, caseTitle, caseTime);
}

function normalizeTranscriptWord(word: string) {
  return word.replace(/\s+/g, ' ').trim();
}

function isStrongPhraseBreak(word: string) {
  return /[.!?;:]["')\]]?$/.test(word.trim());
}

function isSoftPhraseBreak(word: string) {
  return /[,]["')\]]?$/.test(word.trim());
}

function isListConjunction(word: string) {
  return /^(and|or)$/i.test(word.trim().replace(/[^a-z]/gi, ''));
}

function startsArticleOrPreposition(word: string) {
  return /^(a|an|the|in|on|at|by|for|from|with|without|into|onto|over|under|through|during|before|after|of)$/i
    .test(word.trim().replace(/[^a-z]/gi, ''));
}

function looksLikeVerb(word: string) {
  const normalized = word.trim().replace(/[^a-z]/gi, '').toLowerCase();
  return /^(is|are|was|were|be|being|been|am|has|have|had|do|does|did|can|could|will|would|should|may|might|must|discovered|found|saw|made|paid|spent|saved|lost|kept|became|went|got|started|ended)$/.test(normalized)
    || /(?:ed|ing)$/.test(normalized);
}

function isListMarker(word: string) {
  return /^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|one|two|three|four|five|six|seven|eight|nine|ten|\d+)[\).,:]?$/i
    .test(word.trim());
}

function startsNewClause(word: string) {
  return /^(and|but|because|while|when|then|so|if|after|before|meanwhile|however|therefore|instead|also)$/i
    .test(word.trim().replace(/[^a-z]/gi, ''));
}

function cleanSceneToken(word: string) {
  return word.trim().replace(/[^a-z0-9$%]/gi, '').toLowerCase();
}

function startsActionBeat(word: string) {
  return /^(got|gets|get|bought|buy|buys|found|finds|find|saw|sees|see|watched|watches|watch|opened|opens|open|picked|picks|pick|paid|pays|pay|spent|spends|spend|saved|saves|save|lost|loses|lose|kept|keeps|keep|made|makes|make|built|builds|build|carried|carries|carry|held|holds|hold|walked|walks|walk|ran|runs|run|drove|drives|drive|entered|enters|enter|left|leaves|leave|started|starts|start|ended|ends|end|discovered|discovers|discover|showed|shows|show|stored|stores|store|collected|collects|collect|cooked|cooks|cook|used|uses|use|wrote|writes|write|counted|counts|count)$/i
    .test(cleanSceneToken(word));
}

function startsLocationBeat(word: string) {
  return /^(in|from|at|near|inside|outside|around|across|through|toward|towards|into|onto|behind|beside|under|over)$/i
    .test(cleanSceneToken(word));
}

function startsObjectDetailBeat(word: string) {
  return /^(with|without|holding|using|carrying|wearing|beside|inside|outside)$/i
    .test(cleanSceneToken(word));
}

function timedWordsText(words: WordTiming[], startIndex: number, endIndex: number) {
  return words
    .slice(startIndex, endIndex + 1)
    .map((word) => word.word)
    .join(' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function isHistoryVisualBeatBreak(timedWords: WordTiming[], index: number, chunkStart = 0) {
  const currentWord = timedWords[index]?.word || '';
  const nextWord = timedWords[index + 1]?.word || '';
  if (!nextWord) return false;

  const wordsSinceSceneStart = index - chunkStart + 1;
  const chunkText = timedWordsText(timedWords, chunkStart, index);
  const nextClean = cleanSceneToken(nextWord);
  const chunkHasCallout = hasCalloutCue(chunkText);

  if (wordsSinceSceneStart < 2 && !chunkHasCallout) return false;
  if (chunkHasCallout && (isSoftPhraseBreak(currentWord) || wordsSinceSceneStart >= 3)) return true;

  if (isSoftPhraseBreak(currentWord) && wordsSinceSceneStart >= 2) {
    if (!startsArticleOrPreposition(nextWord)) return true;
    if (/\b(?:in|from|at|near)\s+[a-z][a-z'-]+(?:,\s*[a-z][a-z'-]+)?[,)]?$/i.test(chunkText)) return true;
  }

  if (wordsSinceSceneStart >= 2 && startsActionBeat(nextClean)) return true;
  if (wordsSinceSceneStart >= 3 && startsLocationBeat(nextClean)) return true;
  if (wordsSinceSceneStart >= 4 && startsObjectDetailBeat(nextClean)) return true;

  return false;
}

function isCommaListBreak(timedWords: WordTiming[], index: number, chunkStart = 0) {
  if (!isSoftPhraseBreak(timedWords[index].word)) return false;
  const nextWord = timedWords[index + 1]?.word || '';
  const wordsSinceSceneStart = index - chunkStart + 1;

  if (wordsSinceSceneStart <= 3 && startsArticleOrPreposition(nextWord)) {
    return false;
  }

  for (let lookahead = index + 1; lookahead < Math.min(timedWords.length, index + 5); lookahead += 1) {
    const word = timedWords[lookahead].word;
    if (isStrongPhraseBreak(word)) return false;
    if (looksLikeVerb(word)) return false;
    if (isSoftPhraseBreak(word) || isListConjunction(word)) return true;
  }

  return false;
}

function sceneDuration(scene: Pick<Scene, 'narrationStart' | 'narrationEnd'>) {
  return Math.max(0, scene.narrationEnd - scene.narrationStart);
}

function sceneWordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function startsNumberedScene(text: string) {
  return /^\s*(?:#?\d+|number\s+\w+|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/i.test(text);
}

function sceneEndsStrongly(text: string) {
  return /[.!?;:]["')\]]?$/.test(text.trim());
}

function hasCalloutCue(text: string) {
  return /(?:\$|£|€)\s?\d|\b\d+(?:\.\d+)?\s?%|\b(?:percent|percentage|statistics?|statistically|ratio|rate|rates|one in \d+|two in \d+|three in \d+|million|billion|thousand|hundred|dollars?|cents?|profit|loss|inflation|price|cost|worth|saved|spent|paid|debt|savings?)\b|\b(?:1[6-9]\d{2}|20\d{2})\b/i
    .test(text);
}

function hasRapidListCue(text: string) {
  return startsNumberedScene(text)
    || /\b(?:number|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|item|items|ways|methods|steps|rules|habits|tips|secrets|reasons|examples|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(text)
    || /,\s*(?:and|or)?\s*\w+,\s*/i.test(text);
}

function hasCinematicHoldCue(text: string) {
  return /\b(?:watched|vanish|vanished|overnight|devastating|collapse|collapsed|backfired|hostile|dangerous|secret|hidden|forgotten|survived|struggled|desperate|haunting|quietly|ordinary|family|mother|father|children|home|street|town|city|bank|congress|court|document|deed|newspaper|headline|letter|map|photograph|records?|evidence|before|after|years later|decades)\b/i
    .test(text);
}

function hasBridgeOnlyCue(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length > 5) return false;
  return /^(and|but|so|then|because|when|while|before|after|with|without|in|on|at|by|from|to|of|for)\b/i.test(text.trim());
}

function contextualHistoryTargetSeconds(scene: Scene) {
  const words = sceneWordCount(scene.text);
  if (startsNumberedScene(scene.text)) return 2.4;
  if (hasBridgeOnlyCue(scene.text)) return HISTORY_CONTEXTUAL_DEFAULT_SCENE_SECONDS;
  if (hasRapidListCue(scene.text) && words <= 12) return HISTORY_CONTEXTUAL_FAST_SCENE_SECONDS;
  if (hasCalloutCue(scene.text) && words <= 10) return 3.1;
  if (hasCinematicHoldCue(scene.text) && words >= 8) return HISTORY_CONTEXTUAL_HOLD_SCENE_SECONDS;
  if (sceneEndsStrongly(scene.text) && words >= 14) return 5.0;
  return HISTORY_CONTEXTUAL_DEFAULT_SCENE_SECONDS;
}

function contextualHistoryMaxSeconds(scene: Scene) {
  if (hasCinematicHoldCue(scene.text) && sceneWordCount(scene.text) >= 8) return HISTORY_CONTEXTUAL_HOLD_MAX_SECONDS;
  if (startsNumberedScene(scene.text) || hasRapidListCue(scene.text)) return 5.8;
  return HISTORY_CONTEXTUAL_DEFAULT_MAX_SECONDS;
}

function contextualHistoryMaxWords(scene: Scene) {
  return hasCinematicHoldCue(scene.text) ? HISTORY_CONTEXTUAL_HOLD_MAX_WORDS : HISTORY_CONTEXTUAL_DEFAULT_MAX_WORDS;
}

function startsWithActionBeat(text: string) {
  return startsActionBeat(text.trim().split(/\s+/)[0] || '');
}

function startsWithLocationBeat(text: string) {
  return startsLocationBeat(text.trim().split(/\s+/)[0] || '');
}

function startsWithObjectDetailBeat(text: string) {
  return startsObjectDetailBeat(text.trim().split(/\s+/)[0] || '');
}

function shouldPreserveHistoryVisualBeatBoundary(left: Scene, right: Scene) {
  const leftDuration = sceneDuration(left);
  if (leftDuration < 0.65) return false;
  if (startsNumberedScene(left.text) || startsNumberedScene(right.text)) return true;
  if (hasCalloutCue(left.text) || hasCalloutCue(right.text)) return true;
  if (startsWithActionBeat(right.text) || startsWithLocationBeat(right.text) || startsWithObjectDetailBeat(right.text)) {
    return sceneWordCount(left.text) <= 8;
  }
  if (isSoftPhraseBreak(left.text.trim().split(/\s+/).at(-1) || '') && sceneWordCount(left.text) <= 7) return true;
  return false;
}

function mergeScenePair(left: Scene, right: Scene): Scene {
  const text = `${left.text} ${right.text}`.replace(/\s+([,.!?;:])/g, '$1').replace(/\s+/g, ' ').trim();
  return {
    ...left,
    text,
    keywords: extractKeywords(text),
    searchTerms: [],
    visualConcept: '',
    selectionReason: '',
    aiPlanned: false,
    results: [],
    selectedAsset: null,
    status: 'queued',
    narrationEnd: right.narrationEnd,
  };
}

function reindexScenes(storyboard: Scene[]) {
  return storyboard.map((scene, index) => ({ ...scene, id: index }));
}

function splitSceneForHardCap(scene: Scene, maxSeconds: number) {
  const duration = sceneDuration(scene);
  if (duration <= maxSeconds) return [scene];

  const partCount = Math.max(2, Math.ceil(duration / maxSeconds));
  const words = scene.text.trim().split(/\s+/).filter(Boolean);
  const pieces: Scene[] = [];
  let wordCursor = 0;

  for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
    const partStart = scene.narrationStart + (duration * partIndex) / partCount;
    const partEnd = partIndex === partCount - 1
      ? scene.narrationEnd
      : scene.narrationStart + (duration * (partIndex + 1)) / partCount;
    const remainingParts = partCount - partIndex;
    const remainingWords = words.length - wordCursor;
    const takeWords = partIndex === partCount - 1
      ? remainingWords
      : Math.max(1, Math.round(remainingWords / remainingParts));
    const text = words.slice(wordCursor, wordCursor + takeWords).join(' ');
    wordCursor += takeWords;

    pieces.push({
      ...scene,
      text: text || scene.text,
      keywords: extractKeywords(text || scene.text),
      searchTerms: [],
      visualConcept: '',
      selectionReason: '',
      aiPlanned: false,
      results: [],
      selectedAsset: null,
      status: 'queued',
      narrationStart: Math.max(scene.narrationStart, partStart),
      narrationEnd: Math.max(partStart + 0.1, partEnd),
    });
  }

  return pieces;
}

function enforceHistorySceneHardCap(storyboard: Scene[]) {
  return reindexScenes(storyboard.flatMap((scene) => splitSceneForHardCap(scene, HISTORY_HARD_MAX_SCENE_SECONDS)));
}

function mergeHistoryScenesForPacing(storyboard: Scene[]) {
  if (storyboard.length <= 1) return enforceHistorySceneHardCap(storyboard);
  const merged: Scene[] = [];
  let buffer: Scene | null = null;

  const flush = () => {
    if (!buffer) return;
    merged.push(buffer);
    buffer = null;
  };

  storyboard.forEach((scene) => {
    if (!buffer) {
      buffer = scene;
      return;
    }

    const bufferDuration = sceneDuration(buffer);
    const combinedDuration = scene.narrationEnd - buffer.narrationStart;
    const combinedWords = sceneWordCount(`${buffer.text} ${scene.text}`);
    const targetDuration = contextualHistoryTargetSeconds(buffer);
    const maxDuration = Math.max(contextualHistoryMaxSeconds(buffer), contextualHistoryMaxSeconds(scene));
    const maxWords = Math.max(contextualHistoryMaxWords(buffer), contextualHistoryMaxWords(scene));
    const nextStartsNumberedScene = startsNumberedScene(scene.text);
    const shouldKeepBoundary = (
      shouldPreserveHistoryVisualBeatBoundary(buffer, scene)
      || (nextStartsNumberedScene && bufferDuration >= 1.35)
      || combinedDuration > maxDuration
      || combinedWords > maxWords
      || (
        bufferDuration >= targetDuration
        && (sceneEndsStrongly(buffer.text) || startsNewClause(scene.text.split(/\s+/)[0] || ''))
      )
    );

    if (shouldKeepBoundary) {
      flush();
      buffer = scene;
      return;
    }

    buffer = mergeScenePair(buffer, scene);
  });

  flush();
  return enforceHistorySceneHardCap(merged);
}

function sceneTimingProfile(niche: string) {
  const key = nicheKey(niche);
  const trueCrime = key.includes('true crime');
  const history = key.includes('history');
  return {
    trueCrime,
    history,
    minSceneSeconds: trueCrime ? 1.8 : MIN_TRANSCRIPT_SCENE_SECONDS,
    softMaxSeconds: trueCrime
      ? TRUE_CRIME_SOFT_MAX_TRANSCRIPT_SCENE_SECONDS
      : history ? HISTORY_SOFT_MAX_TRANSCRIPT_SCENE_SECONDS : SOFT_MAX_TRANSCRIPT_SCENE_SECONDS,
    targetSeconds: trueCrime
      ? TRUE_CRIME_TARGET_TRANSCRIPT_SCENE_SECONDS
      : history ? HISTORY_TARGET_TRANSCRIPT_SCENE_SECONDS : SOFT_MAX_TRANSCRIPT_SCENE_SECONDS,
    softMaxWords: trueCrime
      ? TRUE_CRIME_SOFT_MAX_TRANSCRIPT_SCENE_WORDS
      : history ? HISTORY_SOFT_MAX_TRANSCRIPT_SCENE_WORDS : SOFT_MAX_TRANSCRIPT_SCENE_WORDS,
    pauseBreakSeconds: trueCrime ? 0.72 : 0.32,
  };
}

function buildScenesFromWordTimings(words: WordTiming[], niche = '') {
  const profile = sceneTimingProfile(niche);
  const timedWords = words
    .filter((word) => (
      typeof word.word === 'string'
      && word.word.trim()
      && Number.isFinite(word.start)
      && Number.isFinite(word.end)
      && word.end >= word.start
    ))
    .map((word) => ({
      ...word,
      word: normalizeTranscriptWord(word.word),
    }));
  if (timedWords.length === 0) return [];

  const scenes: Scene[] = [];
  let chunkStart = 0;

  for (let index = 0; index < timedWords.length; index += 1) {
    const firstWord = timedWords[chunkStart];
    const currentWord = timedWords[index];
    const nextWord = timedWords[index + 1];
    const chunkDuration = currentWord.end - firstWord.start;
    const chunkWordCount = index - chunkStart + 1;
    const nextPause = nextWord ? nextWord.start - currentWord.end : 0;
    const nextStartsClause = nextWord ? startsNewClause(nextWord.word) : false;
    const nextStartsListItem = nextWord ? isListMarker(nextWord.word) : false;
    const hasEnoughScene = chunkDuration >= profile.minSceneSeconds || chunkWordCount >= (profile.trueCrime ? 7 : 3);
    const commaListBreak = !profile.trueCrime && isCommaListBreak(timedWords, index, chunkStart);
    const historyVisualBeatBreak = profile.history
      && hasEnoughScene
      && isHistoryVisualBeatBreak(timedWords, index, chunkStart);
    const trueCrimeSentenceBreak = profile.trueCrime && hasEnoughScene && (
      isStrongPhraseBreak(currentWord.word)
      || nextPause >= profile.pauseBreakSeconds
      || (chunkDuration >= profile.targetSeconds && nextStartsClause)
      || nextStartsListItem
    );
    const defaultPhraseBreak = !profile.trueCrime && hasEnoughScene && (
      isStrongPhraseBreak(currentWord.word)
      || historyVisualBeatBreak
      || commaListBreak
      || nextPause >= profile.pauseBreakSeconds
      || (chunkWordCount >= 5 && nextStartsClause)
      || nextStartsListItem
    );
    const safetyBreak = chunkDuration >= profile.softMaxSeconds
      || chunkWordCount >= profile.softMaxWords;
    const phraseBreak = trueCrimeSentenceBreak || defaultPhraseBreak;
    const shouldBreak = !nextWord || phraseBreak || safetyBreak;

    if (!shouldBreak) continue;

    const chunkWords = timedWords.slice(chunkStart, index + 1);
    const sceneText = chunkWords.map((word) => word.word).join(' ').replace(/\s+([,.!?;:])/g, '$1');
    const narrationStart = Math.max(0, firstWord.start);
    const narrationEnd = Math.max(narrationStart + 0.1, currentWord.end);

    scenes.push({
      id: scenes.length,
      text: sceneText,
      keywords: extractKeywords(sceneText),
      searchTerms: [],
      visualConcept: '',
      selectionReason: '',
      aiPlanned: false,
      results: [],
      selectedAsset: null,
      status: 'queued',
      narrationStart,
      narrationEnd,
      clipStart: 0,
    });

    chunkStart = index + 1;
  }

  return profile.history ? mergeHistoryScenesForPacing(scenes) : scenes;
}

function compactResultItem(item: ResultItem | null): ResultItem | null {
  if (!item) return null;
  return {
    id: item.id,
    source: item.source,
    title: item.title,
    type: item.type,
    thumbnail: item.thumbnail,
    url: item.url,
    year: item.year,
    description: item.description?.slice(0, 220),
    downloadUrl: item.downloadUrl,
    downloads: item.downloads,
    tags: item.tags?.slice(0, 8),
    rightsStatus: item.rightsStatus,
    rightsLabel: item.rightsLabel,
    rightsNote: item.rightsNote,
    license: item.license,
    licenseUrl: item.licenseUrl,
    attribution: item.attribution,
    sourcePageUrl: item.sourcePageUrl,
    isCopyrightSafe: item.isCopyrightSafe,
    needsRightsReview: item.needsRightsReview,
  };
}

function serializeScenes(scenes: Scene[]) {
  return scenes.map((scene) => ({
    ...scene,
    selectedAsset: compactResultItem(scene.selectedAsset),
    results: scene.results.slice(0, 4).map((result) => compactResultItem(result)).filter(Boolean) as ResultItem[],
  }));
}

function safeSetLocalStorage(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (reason) {
    console.warn(`Could not save ${key}:`, reason);
  }
}

function openStoryboardDraftDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not available.'));
      return;
    }
    const request = window.indexedDB.open(STORYBOARD_DRAFT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORYBOARD_DRAFT_STORE)) {
        database.createObjectStore(STORYBOARD_DRAFT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open storyboard draft database.'));
  });
}

async function readStoryboardDraftFromDb() {
  const database = await openStoryboardDraftDb();
  return new Promise<StoryboardDraft | null>((resolve, reject) => {
    const transaction = database.transaction(STORYBOARD_DRAFT_STORE, 'readonly');
    const request = transaction.objectStore(STORYBOARD_DRAFT_STORE).get(STORYBOARD_DRAFT_ID);
    request.onsuccess = () => resolve((request.result as StoryboardDraft | undefined) || null);
    request.onerror = () => reject(request.error || new Error('Could not read storyboard draft.'));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Could not read storyboard draft.'));
    };
  });
}

async function writeStoryboardDraftToDb(draft: StoryboardDraft) {
  const database = await openStoryboardDraftDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORYBOARD_DRAFT_STORE, 'readwrite');
    transaction.objectStore(STORYBOARD_DRAFT_STORE).put(draft, STORYBOARD_DRAFT_ID);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Could not save storyboard draft.'));
    };
  });
}

async function deleteStoryboardDraftFromDb() {
  const database = await openStoryboardDraftDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORYBOARD_DRAFT_STORE, 'readwrite');
    transaction.objectStore(STORYBOARD_DRAFT_STORE).delete(STORYBOARD_DRAFT_ID);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error('Could not clear storyboard draft.'));
    };
  });
}

async function persistStoryboardDraft(draft: StoryboardDraft) {
  await writeStoryboardDraftToDb(draft);
  window.localStorage.removeItem(STORYBOARD_DRAFT_KEY);
  safeSetLocalStorage(STORYBOARD_DRAFT_META_KEY, {
    version: draft.version,
    savedAt: draft.savedAt,
    sceneCount: draft.scenes.length,
    matchedCount: draft.scenes.filter((scene) => scene.selectedAsset).length,
    youtubeNiche: draft.youtubeNiche,
    trueCrimeCaseTitle: draft.trueCrimeCaseTitle,
    trueCrimeCaseTime: draft.trueCrimeCaseTime || 'unspecified',
    editingInstructions: draft.editingInstructions,
    mediaPreference: draft.mediaPreference,
    script: draft.script,
  });
}

const STORYBOARD_RANK_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'real', 'case',
  'photo', 'image', 'evidence', 'true', 'crime', 'documentary', 'photos',
  'picture', 'pictures', 'scene',
]);

function storyboardRankTerms(value: string) {
  return Array.from(new Set(
    (value.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) || [])
      .filter((term) => !STORYBOARD_RANK_STOP_WORDS.has(term)),
  ));
}

function storyboardCandidateText(item: ResultItem) {
  return [
    item.title,
    item.description || '',
    item.year || '',
    item.url || '',
    item.sourcePageUrl || '',
    item.downloadUrl || '',
  ].join(' ').toLowerCase();
}

function isTrueCrimeLocationSceneText(value: string) {
  return /\b(road|street|forest|woods?|trail|mountain|snow|cabin|house|home|vehicle|car|scene|location|area|highway|bridge|river|lake|field|parking|driveway|store|motel|hotel|apartment)\b/i.test(value)
    && !/\b(court|courtroom|trial|mugshot|records?|documents?|newspaper|poster|report|file|map|timeline|article)\b/i.test(value);
}

function hasStoryboardNightSignal(value: string) {
  return /\b(night|nighttime|midnight|evening|after dark|dark road|dark street|dark forest|dark woods|dark highway|dark mountain|dark cabin|eerie midnight|headlights?)\b/i.test(value);
}

function hasStoryboardDaySignal(value: string) {
  return /\b(daylight|daytime|sunny|morning|afternoon|blue sky|day road|day forest|daytime forest)\b/i.test(value);
}

function rankResults(
  results: ResultItem[],
  keywords: string,
  preference: MediaPreference,
  niche: string,
  sceneText = '',
  visualConcept = '',
) {
  const terms = storyboardRankTerms(keywords);
  const key = nicheKey(niche);
  const normalizedPreference = storyboardSearchType(preference);
  const timeSensitiveLocation = key.includes('true crime') && isTrueCrimeLocationSceneText(`${keywords} ${sceneText} ${visualConcept}`);
  const wantsNight = timeSensitiveLocation && /\b(night|nighttime|midnight|evening|after dark|dark)\b/i.test(keywords);
  const wantsDay = timeSensitiveLocation && /\b(daylight|daytime|morning|afternoon|sunny)\b/i.test(keywords);

  const visibleResults = results
    .filter((result) => normalizedPreference === 'all' || result.type === normalizedPreference)
    .filter((result) => !isVisuallyUnsafeForScene(result, {
      sceneText,
      query: keywords,
      visualConcept,
      niche,
    }));
  const timeMatchedResults = wantsNight
    ? visibleResults.filter((result) => hasStoryboardNightSignal(storyboardCandidateText(result)))
    : wantsDay
      ? visibleResults.filter((result) => hasStoryboardDaySignal(storyboardCandidateText(result)))
      : [];

  return (timeMatchedResults.length > 0 ? timeMatchedResults : visibleResults)
    .sort((left, right) => {
    const score = (item: ResultItem) => {
      const title = storyboardCandidateText(item);
      let value = LICENSE_FILTERED_WEB_SOURCES.includes(item.source) ? 8 : 0;
      value += mediaSafetyPenalty(item, { sceneText, query: keywords, visualConcept, niche });
      value += mediaRightsScore(item);
      value += terms.filter((term) => title.includes(term)).length * 5;
      if (normalizedPreference !== 'all' && item.type === normalizedPreference) value += 4;
      if (item.type === 'video') value += key.includes('true crime') ? 2 : 8;
      if (item.type === 'image') value += key.includes('true crime') ? 7 : 2;
      if (key.includes('history') && /\b(vintage|historic|history|old|archive|archival|retro|1920|1930|1940|1950|black and white)\b/.test(title)) {
        value += 6;
      }
      if (key.includes('true crime') && /\b(police|crime|detective|evidence|court|forensic|investigation)\b/.test(title)) {
        value += 5;
      }
      if (key.includes('true crime') && /\b(case|victim|suspect|mugshot|trial|courtroom|crime scene|missing person|document|records?|newspaper|location)\b/.test(title)) {
        value += 7;
      }
      if (key.includes('true crime') && /\b(police line|police tape|crime scene tape)\b/.test(title) && !/\b(police line|police tape|crime scene tape)\b/.test(keywords.toLowerCase())) {
        value -= 16;
      }
      if (key.includes('true crime') && wantsNight) {
        if (hasStoryboardNightSignal(title)) value += 45;
        if (hasStoryboardDaySignal(title)) value -= 35;
        if (!hasStoryboardNightSignal(title)) value -= 25;
      }
      if (key.includes('true crime') && wantsDay) {
        if (hasStoryboardDaySignal(title)) value += 35;
        if (hasStoryboardNightSignal(title)) value -= 30;
      }
      if (key.includes('finance') && /\b(money|cash|bank|finance|stock|investment|budget|coin|debt|bill)\b/.test(title)) {
        value += 5;
      }
      return value;
    };

      return score(right) - score(left);
    });
}

function rankResultsForFreshness(
  results: ResultItem[],
  keywords: string,
  preference: MediaPreference,
  niche: string,
  usage: Map<string, number>,
  sceneText = '',
  visualConcept = '',
) {
  return rankResults(results, keywords, preference, niche, sceneText, visualConcept)
    .sort((left, right) => {
      const usageDelta = assetUsageCount(usage, left) - assetUsageCount(usage, right);
      if (usageDelta !== 0) return usageDelta;
      return 0;
    });
}

function pickFreshSelectedAsset(
  candidates: ResultItem[],
  preferred: ResultItem | null,
  usage: Map<string, number>,
) {
  if (preferred && assetUsageCount(usage, preferred) < MAX_STORYBOARD_ASSET_REUSE) return preferred;
  return freshAssetCandidates(candidates, usage)[0] || preferred;
}

function getNextIncompleteSceneNumber(storyboard: Scene[]) {
  if (storyboard.length === 0) return 1;
  const index = storyboard.findIndex((scene) => !scene.selectedAsset);
  return index === -1 ? storyboard.length : index + 1;
}

function normalizeTrueCrimeResearch(value: unknown): TrueCrimeResearch | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Partial<TrueCrimeResearch>;
  if (typeof payload.caseTitle !== 'string') return null;
  return {
    caseTitle: normalizeCaseTitle(payload.caseTitle),
    postsFound: typeof payload.postsFound === 'number' ? payload.postsFound : 0,
    keyTerms: Array.isArray(payload.keyTerms)
      ? payload.keyTerms.filter((term): term is string => typeof term === 'string').slice(0, 24)
      : [],
    sourceLinks: Array.isArray(payload.sourceLinks)
      ? payload.sourceLinks
        .filter((source): source is TrueCrimeResearchSource => (
          Boolean(source)
          && typeof source === 'object'
          && typeof (source as TrueCrimeResearchSource).title === 'string'
          && typeof (source as TrueCrimeResearchSource).subreddit === 'string'
          && typeof (source as TrueCrimeResearchSource).url === 'string'
        ))
        .slice(0, 6)
      : [],
    researchContext: typeof payload.researchContext === 'string' ? payload.researchContext : '',
    warning: typeof payload.warning === 'string' ? payload.warning : undefined,
  };
}

export default function ScriptSequencer({
  onDownloadScene,
  onDownloadAsset,
  isDownloading,
}: ScriptSequencerProps) {
  const [script, setScript] = useState('');
  const [youtubeNiche, setYoutubeNiche] = useState(YOUTUBE_NICHES[0]);
  const [trueCrimeCaseTitle, setTrueCrimeCaseTitle] = useState('');
  const [trueCrimeCaseTime, setTrueCrimeCaseTime] = useState<TrueCrimeCaseTime>('unspecified');
  const [trueCrimeResearch, setTrueCrimeResearch] = useState<TrueCrimeResearch | null>(null);
  const [editingInstructions, setEditingInstructions] = useState('');
  const [voiceOver, setVoiceOver] = useState<StoryboardVoiceOver | null>(null);
  const [mediaPreference, setMediaPreference] = useState<MediaPreference>('image');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isResearchingTrueCrime, setIsResearchingTrueCrime] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [startSceneNumber, setStartSceneNumber] = useState('1');
  const [visibleSceneCount, setVisibleSceneCount] = useState(VISIBLE_SCENE_BATCH);
  const [videoLabScenes, setVideoLabScenes] = useState<VideoLabSourceScene[]>([]);
  const [error, setError] = useState('');
  const generationAbortRef = useRef<AbortController | null>(null);
  const generationRunRef = useRef(0);
  const hasLoadedDraftRef = useRef(false);
  const selectedAssetUsageRef = useRef<Map<string, number>>(new Map());
  const latestStoryboardDraftRef = useRef<StoryboardDraft | null>(null);
  const trueCrimeResearchRef = useRef<TrueCrimeResearch | null>(null);
  const draftSaveTimerRef = useRef<number | null>(null);

  const matchedCount = useMemo(
    () => scenes.filter((scene) => scene.selectedAsset).length,
    [scenes],
  );
  const nextIncompleteSceneNumber = useMemo(
    () => getNextIncompleteSceneNumber(scenes),
    [scenes],
  );
  const visibleScenes = useMemo(
    () => scenes.slice(0, visibleSceneCount),
    [scenes, visibleSceneCount],
  );
  const isBusy = isProcessing || isResearchingTrueCrime || isPlanning || isSearching;

  const updateScene = useCallback((sceneId: number, update: Partial<Scene>) => {
    setScenes((current) => current.map((scene) => (
      scene.id === sceneId ? { ...scene, ...update } : scene
    )));
  }, []);

  const seedAssetUsage = useCallback((storyboard: Scene[], beforeIndex = storyboard.length) => {
    const usage = new Map<string, number>();
    storyboard.slice(0, beforeIndex).forEach((scene) => {
      if (scene.selectedAsset) registerAssetUsage(usage, scene.selectedAsset);
    });
    selectedAssetUsageRef.current = usage;
  }, []);

  const stopStoryboardGeneration = useCallback((message = 'Storyboard generation stopped.') => {
    generationRunRef.current += 1;
    generationAbortRef.current?.abort();
    generationAbortRef.current = null;
    setIsProcessing(false);
    setIsResearchingTrueCrime(false);
    setIsPlanning(false);
    setIsSearching(false);
    setError(message);
  }, []);

  const clearTimeline = useCallback(() => {
    stopStoryboardGeneration('');
    setScenes([]);
    setVisibleSceneCount(VISIBLE_SCENE_BATCH);
    setVideoLabScenes([]);
    setError('');
    selectedAssetUsageRef.current = new Map();
    trueCrimeResearchRef.current = null;
    setTrueCrimeResearch(null);
    setTrueCrimeCaseTime('unspecified');
    latestStoryboardDraftRef.current = null;
    if (draftSaveTimerRef.current) {
      window.clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(STORYBOARD_DRAFT_KEY);
      window.localStorage.removeItem(STORYBOARD_DRAFT_META_KEY);
      deleteStoryboardDraftFromDb().catch((reason) => console.warn('Could not clear ViteVid storyboard draft:', reason));
    }
  }, [stopStoryboardGeneration]);

  useEffect(() => {
    if (hasLoadedDraftRef.current || typeof window === 'undefined') return;
    let cancelled = false;

    const applyDraft = (draft: Partial<StoryboardDraft> | null) => {
      if (!draft || cancelled) return;
      if (Array.isArray(draft.scenes) && draft.scenes.length > 0) {
        setScenes(draft.scenes);
        seedAssetUsage(draft.scenes);
        setStartSceneNumber(String(getNextIncompleteSceneNumber(draft.scenes)));
        setVisibleSceneCount(Math.min(VISIBLE_SCENE_BATCH, draft.scenes.length));
      }
      if (draft.youtubeNiche) setYoutubeNiche(normalizeSelectedNiche(draft.youtubeNiche));
      if (typeof draft.trueCrimeCaseTitle === 'string') setTrueCrimeCaseTitle(draft.trueCrimeCaseTitle);
      setTrueCrimeCaseTime(normalizeTrueCrimeCaseTime(draft.trueCrimeCaseTime));
      if (draft.trueCrimeResearch) {
        const normalizedResearch = normalizeTrueCrimeResearch(draft.trueCrimeResearch);
        trueCrimeResearchRef.current = normalizedResearch;
        setTrueCrimeResearch(normalizedResearch);
      }
      if (draft.editingInstructions) setEditingInstructions(draft.editingInstructions);
      if (draft.mediaPreference && ['all', 'image', 'video', 'image-unfiltered'].includes(draft.mediaPreference)) {
        setMediaPreference(draft.mediaPreference);
      }
      if (draft.script) setScript(draft.script);
    };

    const loadDraft = async () => {
      try {
        const indexedDraft = await readStoryboardDraftFromDb().catch(() => null);
        if (indexedDraft?.scenes?.length) {
          applyDraft(indexedDraft);
          return;
        }
        const rawDraft = window.localStorage.getItem(STORYBOARD_DRAFT_KEY);
        if (rawDraft) applyDraft(JSON.parse(rawDraft) as Partial<StoryboardDraft>);
      } catch (reason) {
        console.warn('Could not load ViteVid storyboard draft:', reason);
      } finally {
        if (!cancelled) hasLoadedDraftRef.current = true;
      }
    };

    loadDraft();
    return () => {
      cancelled = true;
    };
  }, [seedAssetUsage]);

  useEffect(() => {
    if (!hasLoadedDraftRef.current || typeof window === 'undefined') return;
    if (scenes.length === 0) return;
    const draft = {
      scenes: serializeScenes(scenes),
      youtubeNiche,
      trueCrimeCaseTitle,
      trueCrimeCaseTime,
      trueCrimeResearch,
      editingInstructions,
      mediaPreference,
      script,
      savedAt: Date.now(),
      version: 3,
    } satisfies StoryboardDraft;
    latestStoryboardDraftRef.current = draft;
    if (draftSaveTimerRef.current) return;
    draftSaveTimerRef.current = window.setTimeout(() => {
      draftSaveTimerRef.current = null;
      const latestDraft = latestStoryboardDraftRef.current;
      if (!latestDraft) return;
      persistStoryboardDraft(latestDraft).catch((reason) => {
        console.warn('Could not save ViteVid storyboard draft:', reason);
      });
    }, 900);
  }, [editingInstructions, mediaPreference, scenes, script, trueCrimeCaseTime, trueCrimeCaseTitle, trueCrimeResearch, youtubeNiche]);

  useEffect(() => () => {
    if (draftSaveTimerRef.current) {
      window.clearTimeout(draftSaveTimerRef.current);
      draftSaveTimerRef.current = null;
    }
  }, []);

  const ensureTrueCrimeResearch = useCallback(async (signal?: AbortSignal) => {
    const caseTitle = normalizeCaseTitle(trueCrimeCaseTitle);
    if (!isTrueCrimeNicheValue(youtubeNiche) || !caseTitle) return null;

    const existing = trueCrimeResearchRef.current;
    if (existing && existing.caseTitle.toLowerCase() === caseTitle.toLowerCase()) {
      return existing;
    }

    setIsResearchingTrueCrime(true);
    try {
      const response = await fetch('/api/true-crime-research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({ caseTitle }),
      });
      const data = await response.json();
      if (signal?.aborted) return null;
      if (!response.ok) {
        const warningResearch: TrueCrimeResearch = {
          caseTitle,
          postsFound: 0,
          keyTerms: [],
          sourceLinks: [],
          researchContext: '',
          warning: data.error || 'Reddit research could not run. Continuing with the case title only.',
        };
        trueCrimeResearchRef.current = warningResearch;
        setTrueCrimeResearch(warningResearch);
        return null;
      }

      const normalizedResearch = normalizeTrueCrimeResearch(data);
      trueCrimeResearchRef.current = normalizedResearch;
      setTrueCrimeResearch(normalizedResearch);
      return normalizedResearch;
    } catch (reason) {
      if (signal?.aborted) return null;
      const warningResearch: TrueCrimeResearch = {
        caseTitle,
        postsFound: 0,
        keyTerms: [],
        sourceLinks: [],
        researchContext: '',
        warning: reason instanceof Error
          ? reason.message
          : 'Reddit research could not run. Continuing with the case title only.',
      };
      trueCrimeResearchRef.current = warningResearch;
      setTrueCrimeResearch(warningResearch);
      return null;
    } finally {
      if (!signal?.aborted) setIsResearchingTrueCrime(false);
    }
  }, [trueCrimeCaseTitle, youtubeNiche]);

  const searchForScene = useCallback(async (
    scene: Scene,
    preference: MediaPreference,
    signal?: AbortSignal,
  ) => {
    if (signal?.aborted) return;
    updateScene(scene.id, { status: 'searching' });

    try {
      const caseTitle = normalizeCaseTitle(trueCrimeCaseTitle);
      const caseTime = normalizeTrueCrimeCaseTime(trueCrimeCaseTime);
      const primaryQueries = buildPrimarySearchQueries(scene, youtubeNiche, caseTitle, caseTime);
      const unfilteredWeb = isUnfilteredMediaPreference(preference);
      const preferredSearchType = storyboardSearchType(preference);
      const rightsParam = unfilteredWeb ? '&rights=unfiltered' : '';
      const caseTimeParam = isTrueCrimeNicheValue(youtubeNiche)
        ? `&caseTime=${encodeURIComponent(caseTime)}`
        : '';
      const fetchResults = async (
        queries: string[],
        providers = 'web',
        searchType: 'all' | 'image' = preferredSearchType,
      ) => {
        return Promise.all(queries.slice(0, 8).map(async (query) => {
          try {
            const response = await fetch(
              `/api/search?q=${encodeURIComponent(query)}&type=${searchType}&providers=${providers}&niche=${encodeURIComponent(youtubeNiche)}&caseTitle=${encodeURIComponent(caseTitle)}${caseTimeParam}${rightsParam}`,
              { signal },
            );
            if (!response.ok) return { results: [] };
            return response.json();
          } catch (reason) {
            if (signal?.aborted) throw reason;
            return { results: [] };
          }
        }));
      };
      let queries = primaryQueries;
      let payloads = await fetchResults(queries);
      if (payloads.every((payload) => (payload.results || []).length === 0)) {
        queries = createFallbackQueries(scene, youtubeNiche, caseTitle, caseTime);
        payloads = await fetchResults(queries);
      }
      if (payloads.every((payload) => (payload.results || []).length === 0)) {
        queries = createBroadFallbackQueries(scene, youtubeNiche, caseTitle, caseTime);
        payloads = await fetchResults(queries);
      }
      if (payloads.every((payload) => (payload.results || []).length === 0)) {
        queries = createBroadFallbackQueries(scene, youtubeNiche, caseTitle, caseTime);
        payloads = await fetchResults(queries, 'all', preferredSearchType);
      }
      if (payloads.every((payload) => (payload.results || []).length === 0)) {
        queries = createLastChanceQueries(scene, youtubeNiche, caseTitle, caseTime);
        payloads = await fetchResults(queries, 'all', 'all');
      }
      if (payloads.every((payload) => (payload.results || []).length === 0)) {
        queries = applyTrueCrimeCaseContext(getNicheFallbackQueries(youtubeNiche), youtubeNiche, caseTitle, caseTime);
        payloads = await fetchResults(queries, 'all', 'all');
      }
      const uniqueResults = new Map<string, ResultItem>();
      payloads.flatMap((payload) => payload.results || []).forEach((result: ResultItem) => {
        const rightsCheckedResult = withMediaRights(result, {
          providerFiltered: !unfilteredWeb && LICENSE_FILTERED_WEB_SOURCES.includes(result.source),
          allowUnfilteredWeb: unfilteredWeb || result.rightsStatus === 'unfiltered-web',
        });
        if (rightsCheckedResult.rightsStatus !== 'blocked' && !isVisuallyUnsafeForScene(rightsCheckedResult, {
          sceneText: scene.text,
          query: queries.join(' '),
          visualConcept: scene.visualConcept,
          niche: youtubeNiche,
        })) {
          const key = primaryAssetKey(rightsCheckedResult);
          const existing = uniqueResults.get(key);
          if (!existing || mediaRightsScore(rightsCheckedResult) > mediaRightsScore(existing)) {
            uniqueResults.set(key, rightsCheckedResult);
          }
        }
      });
      const usage = selectedAssetUsageRef.current;
      const ranked = freshAssetCandidates(rankResultsForFreshness(
        Array.from(uniqueResults.values()),
        queries.join(' '),
        storyboardSearchType(preference),
        youtubeNiche,
        usage,
        scene.text,
        scene.visualConcept,
      ), usage).slice(0, 12);
      const fallbackAsset = createFreshFallbackAsset(scene, youtubeNiche, usage);
      const finalResults = ranked.length > 0 ? ranked : [fallbackAsset];
      let selectedAsset = finalResults[0] || null;
      let selectionReason = ranked.length > 0
        ? ''
        : 'Exact search found no safe clip, so ViteVid assigned a niche-matched public-domain fallback video to avoid an empty scene.';

      if (finalResults.length > 0) {
        const selectionResponse = await fetch('/api/select-storyboard-media', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            scene: {
              text: scene.text,
              visualConcept: scene.visualConcept,
              query: scene.keywords,
              preferredType: storyboardSearchType(preference),
              niche: youtubeNiche,
              caseTitle,
              caseTime,
            },
            candidates: finalResults,
            usedAssetCounts: assetUsageRecord(selectedAssetUsageRef.current),
            maxReuse: MAX_STORYBOARD_ASSET_REUSE,
          }),
        });
        if (signal?.aborted) return;
        if (selectionResponse.ok) {
          const selection = await selectionResponse.json();
          selectedAsset = finalResults.find((result) => result.id === selection.selectedId) || selectedAsset;
          selectionReason = selection.reason || '';
        }
      }

      if (signal?.aborted) return;
      selectedAsset = pickFreshSelectedAsset(finalResults, selectedAsset, selectedAssetUsageRef.current);
      if (selectedAsset) registerAssetUsage(selectedAssetUsageRef.current, selectedAsset);
      const orderedResults = selectedAsset
        ? [
          selectedAsset,
          ...finalResults.filter((result) => result.id !== selectedAsset?.id),
        ].slice(0, 8)
        : finalResults.slice(0, 8);
      updateScene(scene.id, {
        results: orderedResults,
        selectedAsset,
        selectionReason,
        status: 'matched',
      });
    } catch (reason) {
      if (signal?.aborted) return;
      console.error(`Search failed for scene ${scene.id}:`, reason);
      const fallbackAsset = createFreshFallbackAsset(scene, youtubeNiche, selectedAssetUsageRef.current);
      registerAssetUsage(selectedAssetUsageRef.current, fallbackAsset);
      updateScene(scene.id, {
        status: 'matched',
        results: [fallbackAsset],
        selectedAsset: fallbackAsset,
        selectionReason: 'Search failed, so ViteVid assigned a niche-matched public-domain fallback video to keep the scene complete.',
      });
    }
  }, [trueCrimeCaseTime, trueCrimeCaseTitle, updateScene, youtubeNiche]);

  const searchStoryboard = async (storyboard: Scene[], preference: MediaPreference, signal?: AbortSignal) => {
    setIsSearching(true);
    let cursor = 0;

    const runSearchWorker = async () => {
      while (cursor < storyboard.length && !signal?.aborted) {
        const nextScene = storyboard[cursor];
        cursor += 1;
        await searchForScene(nextScene, preference, signal);
      }
    };

    try {
      const workerCount = Math.min(4, storyboard.length);
      await Promise.all(Array.from({ length: workerCount }, () => runSearchWorker()));
    } finally {
      if (!signal?.aborted) setIsSearching(false);
    }
  };

  const planAndSearchStoryboard = async (
    storyboard: Scene[],
    preference: MediaPreference,
    signal?: AbortSignal,
    fullStoryboard: Scene[] = storyboard,
  ) => {
    setIsPlanning(true);
    setError('');

    try {
      if (signal?.aborted) return;
      const response = await fetch('/api/plan-storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          scenes: storyboard.map((scene) => ({
            id: scene.id,
            text: scene.text,
            contextBefore: fullStoryboard.find((entry) => entry.id === scene.id - 1)?.text || '',
            contextAfter: fullStoryboard.find((entry) => entry.id === scene.id + 1)?.text || '',
            narrationStart: scene.narrationStart,
            narrationEnd: scene.narrationEnd,
          })),
          mediaPreference: storyboardPlanningPreference(preference),
          niche: youtubeNiche,
          caseTitle: normalizeCaseTitle(trueCrimeCaseTitle),
          caseTime: isTrueCrimeNicheValue(youtubeNiche) ? normalizeTrueCrimeCaseTime(trueCrimeCaseTime) : 'unspecified',
          trueCrimeResearch: isTrueCrimeNicheValue(youtubeNiche) ? trueCrimeResearchRef.current : null,
          fullTranscript: fullStoryboard.map((scene) => scene.text).join(' '),
          totalSceneCount: fullStoryboard.length,
          startSceneNumber: storyboard[0].id + 1,
        }),
      });
      const data = await response.json();
      if (signal?.aborted) return;
      if (!response.ok) throw new Error(data.error || 'AI scene planning failed.');

      const plans = new Map<number, PlannedScene>(
        (Array.isArray(data) ? data : []).map((scene: PlannedScene) => [scene.scene_number - 1, scene]),
      );
      const plannedStoryboard = storyboard.map((scene) => {
        const plan = plans.get(scene.id);
        if (!plan) return scene;
        const caseTime = normalizeTrueCrimeCaseTime(trueCrimeCaseTime);
        const searchTerms = Array.from(new Set([
          ...applyTrueCrimeCaseContext(plan.search_terms || [], youtubeNiche, trueCrimeCaseTitle, caseTime),
          extractKeywords(scene.text),
        ].filter((term) => term.trim())));
        return {
          ...scene,
          keywords: searchTerms[0] || scene.keywords,
          searchTerms,
          visualConcept: plan.visual_description || plan.scene_text || scene.visualConcept,
          aiPlanned: true,
        };
      });

      setScenes((current) => current.map((scene) => (
        plannedStoryboard.find((planned) => planned.id === scene.id) || scene
      )));
      await searchStoryboard(plannedStoryboard, preference, signal);
    } catch (reason) {
      if (signal?.aborted) return;
      const caseTitle = normalizeCaseTitle(trueCrimeCaseTitle);
      const caseTime = normalizeTrueCrimeCaseTime(trueCrimeCaseTime);
      const fallbackStoryboard = storyboard.map((scene) => {
        const searchTerms = Array.from(new Set([
          ...buildPrimarySearchQueries(scene, youtubeNiche, caseTitle, caseTime),
          ...createFallbackQueries(scene, youtubeNiche, caseTitle, caseTime),
          extractKeywords(scene.text),
        ].filter((term) => term.trim()))).slice(0, 8);
        return {
          ...scene,
          keywords: searchTerms[0] || scene.keywords,
          searchTerms,
          visualConcept: scene.visualConcept || scene.text,
          aiPlanned: false,
        };
      });
      setError(
        reason instanceof Error
          ? `Opus scene planning failed for one batch, so ViteVid continued with deterministic keywords: ${reason.message}`
          : 'Opus scene planning failed for one batch, so ViteVid continued with deterministic keywords.',
      );
      setScenes((current) => current.map((scene) => (
        fallbackStoryboard.find((fallback) => fallback.id === scene.id) || scene
      )));
      await searchStoryboard(fallbackStoryboard, preference, signal);
    } finally {
      if (!signal?.aborted) setIsPlanning(false);
    }
  };

  const parseStartSceneIndex = (storyboard: Scene[], requestedStartScene = startSceneNumber) => {
    const requestedScene = Number(requestedStartScene);
    if (!Number.isInteger(requestedScene) || requestedScene < 1 || requestedScene > storyboard.length) {
      setError(`Choose a start scene between 1 and ${storyboard.length}.`);
      return null;
    }

    return requestedScene - 1;
  };

  const planAndSearchFromScene = async (storyboard: Scene[], startIndex: number, signal?: AbortSignal) => {
    seedAssetUsage(storyboard, startIndex);
    for (let index = startIndex; index < storyboard.length; index += SCENES_PER_PLANNING_BATCH) {
      if (signal?.aborted) return;
      await planAndSearchStoryboard(
        storyboard.slice(index, index + SCENES_PER_PLANNING_BATCH),
        mediaPreference,
        signal,
        storyboard,
      );
    }
  };

  const resumeMatching = async (requestedStartScene = startSceneNumber) => {
    const startIndex = parseStartSceneIndex(scenes, requestedStartScene);
    if (startIndex === null) return;
    generationAbortRef.current?.abort();
    const controller = new AbortController();
    generationAbortRef.current = controller;
    await ensureTrueCrimeResearch(controller.signal);
    await planAndSearchFromScene(scenes, startIndex, controller.signal);
  };

  const resumeFromNextIncomplete = async () => {
    const resumeScene = String(nextIncompleteSceneNumber);
    setStartSceneNumber(resumeScene);
    await resumeMatching(resumeScene);
  };

  const transcribeVoiceover = async (file: File, fallbackScript: string, duration: number, signal?: AbortSignal) => {
    const formData = new FormData();
    formData.append('audio', file);
    formData.append('duration', String(duration || 0));
    formData.append('timingSource', 'audio');
    if (fallbackScript.trim()) formData.append('script', fallbackScript);

    const response = await fetch('/api/align-voiceover', {
      method: 'POST',
      body: formData,
      signal,
    });
    const data = await response.json() as Partial<VoiceoverTranscription> & { error?: string };
    if (!response.ok || !Array.isArray(data.words)) {
      throw new Error(data.error || 'Voiceover transcription failed.');
    }

    return {
      mode: data.mode,
      provider: data.provider,
      transcript: data.transcript || '',
      words: data.words,
      durationSeconds: typeof data.durationSeconds === 'number' ? data.durationSeconds : duration,
      warning: data.warning,
    };
  };

  const createVoiceoverStoryboard = async (options: { startScene?: string; clearExisting?: boolean } = {}) => {
    if (!voiceOver) {
      setError('Attach a voiceover before building a voice-based storyboard.');
      return;
    }

    generationAbortRef.current?.abort();
    const controller = new AbortController();
    generationAbortRef.current = controller;
    generationRunRef.current += 1;
    setError('');
    setIsProcessing(true);
    setIsPlanning(false);
    setIsSearching(false);
    setVideoLabScenes([]);
    selectedAssetUsageRef.current = new Map();
    if (options.clearExisting) {
      setScenes([]);
      setVisibleSceneCount(VISIBLE_SCENE_BATCH);
    }

    try {
      const researchPromise = ensureTrueCrimeResearch(controller.signal);
      const transcription = await transcribeVoiceover(
        voiceOver.file,
        script,
        voiceOver.duration,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      await researchPromise;
      if (controller.signal.aborted) return;
      const storyboard = buildScenesFromWordTimings(transcription.words, youtubeNiche);
      if (storyboard.length === 0) {
        throw new Error('Voiceover transcription returned no usable word timestamps.');
      }
      const startIndex = parseStartSceneIndex(storyboard, options.startScene);
      if (startIndex === null) return;
      setScript(transcription.transcript || storyboard.map((scene) => scene.text).join(' '));
      setVoiceOver((current) => (current ? {
        ...current,
        duration: transcription.durationSeconds || current.duration,
        words: transcription.words,
        transcript: transcription.transcript || '',
      } : current));
      setScenes(storyboard);
      setVisibleSceneCount(Math.min(VISIBLE_SCENE_BATCH, storyboard.length));
      setIsProcessing(false);
      await planAndSearchFromScene(storyboard, startIndex, controller.signal);
    } catch (reason) {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : 'Voiceover storyboard generation failed.');
    } finally {
      if (!controller.signal.aborted) setIsProcessing(false);
    }
  };

  const restartStoryboardGeneration = async () => {
    setStartSceneNumber('1');
    await createVoiceoverStoryboard({ startScene: '1', clearExisting: true });
  };

  const handleVoiceOverChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    if (!file) return;
    setError('');
    try {
      setVoiceOver({ file, duration: await getAudioDuration(file) });
    } catch (reason) {
      setVoiceOver({ file, duration: 0 });
      setError(reason instanceof Error ? reason.message : 'Could not read voice-over duration.');
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
        scene.clipStart + duration,
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

  const openVideoLab = () => {
    if (scenes.length === 0) {
      setError('No scenes are available yet. Generate a storyboard before opening Video Lab.');
      return;
    }

    const videoLabUsage = new Map(selectedAssetUsageRef.current);
    let fallbackCount = 0;
    const labScenes = scenes.map((scene) => {
      const directAsset = scene.selectedAsset || scene.results[0] || null;
      const asset = directAsset || createFreshFallbackAsset(scene, youtubeNiche, videoLabUsage);
      if (!directAsset) fallbackCount += 1;
      registerAssetUsage(videoLabUsage, asset);
      return {
        id: scene.id,
        text: scene.text,
        asset,
        alternatives: scene.results.length > 0 ? scene.results : [asset],
        duration: Math.max(0.1, scene.narrationEnd - scene.narrationStart),
        narrationStart: scene.narrationStart,
        narrationEnd: scene.narrationEnd,
        clipStart: scene.clipStart,
      };
    });

    if (fallbackCount > 0) {
      setError(`${fallbackCount} scenes had no matched media, so ViteVid used scene-specific public-domain fallback visuals instead of borrowing unrelated neighboring clips.`);
    } else {
      setError('');
    }
    setVideoLabScenes(labScenes);
  };

  if (videoLabScenes.length > 0) {
    return (
      <div className="video-lab-stage">
        <VideoLab
          initialScenes={videoLabScenes}
          niche={youtubeNiche}
          editingInstructions={editingInstructions}
          initialVoiceOver={voiceOver}
          onClose={() => setVideoLabScenes([])}
        />
      </div>
    );
  }

  return (
    <div className="storyboard">
      <div className="storyboard-input">
        <div className="storyboard-toolbar">
          <label className="storyboard-select">
            <span>Media</span>
            <select
              value={mediaPreference}
              onChange={(event) => setMediaPreference(event.target.value as MediaPreference)}
            >
              <option value="image">Web images</option>
              <option value="video">Video-directed images</option>
              <option value="all">Video + images</option>
              <option value="image-unfiltered">Web images without filters</option>
            </select>
          </label>
          <span className="duration-chip">voice-timed scenes</span>
        </div>

        <label className="niche-select">
          <span>YouTube niche</span>
          <select
            value={youtubeNiche}
            onChange={(event) => {
              const nextNiche = event.target.value;
              setYoutubeNiche(nextNiche);
              if (!isTrueCrimeNicheValue(nextNiche)) {
                trueCrimeResearchRef.current = null;
                setTrueCrimeResearch(null);
                setTrueCrimeCaseTime('unspecified');
              }
            }}
          >
            {YOUTUBE_NICHES.map((niche) => (
              <option key={niche} value={niche}>{niche}</option>
            ))}
          </select>
        </label>
        {isTrueCrimeNicheValue(youtubeNiche) && (
          <>
            <label className="case-title-input">
              <span>Case title</span>
              <input
                type="text"
                value={trueCrimeCaseTitle}
                onChange={(event) => {
                  setTrueCrimeCaseTitle(event.target.value);
                  trueCrimeResearchRef.current = null;
                  setTrueCrimeResearch(null);
                }}
                placeholder="Example: Yuba County Five"
              />
            </label>
            <label className="case-title-input">
              <span>Case time</span>
              <select
                value={trueCrimeCaseTime}
                onChange={(event) => setTrueCrimeCaseTime(normalizeTrueCrimeCaseTime(event.target.value))}
              >
                <option value="unspecified">Not sure</option>
                <option value="day">Day case</option>
                <option value="night">Night case</option>
              </select>
            </label>
            <div className="true-crime-research-panel">
              <button
                type="button"
                className="secondary-btn"
                disabled={isResearchingTrueCrime || normalizeCaseTitle(trueCrimeCaseTitle).length < 3}
                onClick={() => {
                  generationAbortRef.current?.abort();
                  const controller = new AbortController();
                  generationAbortRef.current = controller;
                  void ensureTrueCrimeResearch(controller.signal);
                }}
              >
                {isResearchingTrueCrime ? 'Researching...' : 'Research case'}
              </button>
              {trueCrimeResearch && (
                <span className={trueCrimeResearch.warning ? 'research-warning' : 'research-ready'}>
                  {trueCrimeResearch.warning
                    ? trueCrimeResearch.warning
                    : `${trueCrimeResearch.postsFound} Reddit posts | ${trueCrimeResearch.keyTerms.length} case terms`}
                </span>
              )}
            </div>
          </>
        )}
        <label className="editing-instructions">
          <span>Extra editing instructions for Claude</span>
          <textarea
            placeholder="Example: Add subtle whooshes on transitions, use ticking during tense parts, keep motion slow and documentary-style."
            value={editingInstructions}
            onChange={(event) => setEditingInstructions(event.target.value)}
          />
        </label>
        <label className="script-voiceover">
          <span>{voiceOver ? `Voiceover ready: ${voiceOver.file.name}` : 'Attach voiceover to build storyboard'}</span>
          <input
            type="file"
            accept=".mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm,audio/*"
            onChange={handleVoiceOverChange}
          />
          {voiceOver && (
            <button
              type="button"
              className="secondary-btn"
              onClick={(event) => {
                event.preventDefault();
                setVoiceOver(null);
              }}
            >
              Remove
            </button>
          )}
        </label>

        {error && <div className="storyboard-error" role="alert">{error}</div>}
        <div className="storyboard-actions">
          <label className="scene-start-input">
            <span>Start scene</span>
            <input
              type="number"
              min="1"
              step="1"
              value={startSceneNumber}
              onChange={(event) => setStartSceneNumber(event.target.value)}
            />
          </label>
          {scenes.length > 0 && (
            <button type="button" className="secondary-btn" onClick={clearTimeline}>
              Clear timeline
            </button>
          )}
          {isBusy && (
            <button
              type="button"
              className="secondary-btn"
              onClick={() => stopStoryboardGeneration()}
            >
              Stop AI
            </button>
          )}
          {scenes.length > 0 && (
            <button
              type="button"
              className="secondary-btn"
              onClick={restartStoryboardGeneration}
              disabled={isBusy || !voiceOver}
            >
              Regenerate storyboard
            </button>
          )}
          {scenes.length > 0 ? (
            <button
              type="button"
              className="primary"
              onClick={resumeFromNextIncomplete}
              disabled={isBusy || matchedCount === scenes.length}
            >
              {isPlanning
                ? 'AI planning...'
                : isSearching ? 'Matching scenes...'
                  : `Resume AI from scene ${nextIncompleteSceneNumber}`}
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={() => createVoiceoverStoryboard()}
              disabled={isBusy || !voiceOver}
            >
              {isProcessing
                ? 'Transcribing voiceover...'
                : isPlanning ? 'AI planning...'
                  : isSearching ? 'Matching scenes...'
                    : 'Build from voiceover'}
            </button>
          )}
        </div>
      </div>

      {scenes.length > 0 && (
        <section className="storyboard-timeline">
          <header className="timeline-header">
            <div>
              <h2>Storyboard Timeline</h2>
              <span>
                {matchedCount} of {scenes.length} scenes matched | showing {Math.min(visibleSceneCount, scenes.length)}
              </span>
            </div>
            <div className="timeline-actions">
              <button
                type="button"
                className="secondary-btn"
                disabled={isBusy}
                onClick={() => resumeMatching()}
              >
                Match from scene {startSceneNumber || '...'}
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
            {visibleScenes.map((scene) => {
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
                      {scene.results.map((result, resultIndex) => (
                        <button
                          type="button"
                          key={`${scene.id}-${result.id}-${resultIndex}`}
                          className={`scene-option ${scene.selectedAsset?.id === result.id ? 'selected' : ''}`}
                        onClick={() => updateScene(scene.id, { selectedAsset: result })}
                          title={`${result.source}: ${result.title}${result.rightsLabel ? ` | ${result.rightsLabel}` : ''}`}
                        >
                          {/* Third-party archival thumbnails need their original remote sources here. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={result.thumbnail} alt="" />
                          <span className={`media-tag ${result.type}`}>{result.type}</span>
                          {result.rightsLabel && (
                            <span className={`rights-tag ${result.needsRightsReview ? 'review' : 'safe'}`}>
                              {result.needsRightsReview ? 'review' : 'safe'}
                            </span>
                          )}
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
          {visibleSceneCount < scenes.length && (
            <div className="scene-window-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setVisibleSceneCount((count) => Math.min(scenes.length, count + VISIBLE_SCENE_BATCH))}
              >
                Show next {Math.min(VISIBLE_SCENE_BATCH, scenes.length - visibleSceneCount)} scenes
              </button>
              <span>Hidden scenes are still saved and still go to Video Lab.</span>
            </div>
          )}

          <section className="video-lab-launch">
            <div>
              <h2>Video Lab</h2>
              <span>
                {matchedCount} selected scenes ready on a voice-timed timeline
                {voiceOver ? ` | voiceover: ${voiceOver.file.name}` : ' | no voiceover attached'}
              </span>
            </div>
              <button
              type="button"
              className="primary"
              disabled={scenes.length === 0 || matchedCount === 0}
              onClick={openVideoLab}
            >
              Edit in Video Lab
            </button>
          </section>
        </section>
      )}
    </div>
  );
}
