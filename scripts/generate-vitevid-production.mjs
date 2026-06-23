import { createWriteStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { Agent } from 'undici';

const require = createRequire(import.meta.url);

const BASE_URL = process.env.VITEVID_BASE_URL || 'http://localhost:3000';
const AUDIO_PATH = process.argv[2] || 'C:\\Users\\Hp\\Downloads\\tts-audio (19).wav';
const OUTPUT_PATH = process.argv[3] || path.join(os.homedir(), 'Downloads', 'ViteVid_tts-audio-19_final.mp4');
const RUN_STATE_PATH = process.argv[4] || path.join(os.homedir(), 'Downloads', 'ViteVid_tts-audio-19_run-state.json');
const NICHE = 'history (vintage)';
const MEDIA_PREFERENCE = 'video';
const FPS = 24;
const WIDTH = 1280;
const HEIGHT = 720;
const SCENES_PER_PLANNING_BATCH = 12;
const SEARCH_WORKERS = 8;
const PLAN_REQUEST_TIMEOUT_MS = 22000;
const SEARCH_QUERIES_PER_SCENE = 3;
const MIN_TRANSCRIPT_SCENE_SECONDS = 0.45;
const SOFT_MAX_TRANSCRIPT_SCENE_SECONDS = 8;
const SOFT_MAX_TRANSCRIPT_SCENE_WORDS = 14;
const FORCE_DURATION_SECONDS = Number(process.env.VITEVID_FORCE_DURATION || 0);

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'almost', 'along', 'also', 'among', 'another',
  'because', 'before', 'being', 'between', 'could', 'every', 'first', 'from', 'have',
  'into', 'itself', 'just', 'like', 'more', 'most', 'only', 'other', 'over', 'people',
  'same', 'should', 'some', 'such', 'than', 'that', 'their', 'there', 'these', 'they',
  'this', 'those', 'through', 'under', 'until', 'very', 'voice', 'what', 'when', 'where',
  'which', 'while', 'with', 'would', 'your',
]);

const GUARANTEED_NICHE_VIDEOS = {
  history: [
    { id: 'TripDown1905', title: 'Trip Down Market Street Before the Fire', year: '1905', tags: ['vintage', 'historic street', 'old film'] },
    { id: 'FromtheG1954', title: 'From the Ground Up', year: '1954', tags: ['vintage', 'american life', 'old film'] },
    { id: 'DayofTha1951', title: 'Day of Thanksgiving', year: '1951', tags: ['vintage family', 'american home', 'old film'] },
    { id: 'EatforHe1954', title: 'Eat for Health', year: '1954', tags: ['vintage people', 'home life', 'old film'] },
    { id: 'Usingthe1947', title: 'Using the Bank', year: '1947', tags: ['bank', 'money', 'finance'] },
    { id: 'Financin1935', title: 'Financing the American Family', year: '1935', tags: ['family finance', 'budget', 'money'] },
  ],
};

const SOUND_EFFECTS = {
  'clock-ticking': {
    publicPath: '/sound-effects/clock-ticking.mp3',
    localPath: path.resolve('public', 'sound-effects', 'clock-ticking.mp3'),
    duration: 2.2,
    volume: 0.45,
  },
  'keyboard-typing': {
    publicPath: '/sound-effects/keyboard-typing.mp3',
    localPath: path.resolve('public', 'sound-effects', 'keyboard-typing.mp3'),
    duration: 2.8,
    volume: 0.7,
  },
  whoosh: {
    publicPath: '/sound-effects/whoosh.mp3',
    localPath: path.resolve('public', 'sound-effects', 'whoosh.mp3'),
    duration: 0.9,
    volume: 0.7,
  },
  'pop-up': {
    publicPath: '/sound-effects/pop-up.mp3',
    localPath: path.resolve('public', 'sound-effects', 'pop-up.mp3'),
    duration: 1.1,
    volume: 0.7,
  },
};

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function cleanTimingToken(value = '') {
  return String(value).toLowerCase().replace(/^[^a-z0-9$%.]+|[^a-z0-9$%.]+$/g, '').replace(/,/g, '');
}

function normalizeSpokenToken(value = '') {
  return cleanTimingToken(value).replace(/[$%]/g, '');
}

function normalizeTranscriptWord(word) {
  return String(word).replace(/\s+/g, ' ').trim();
}

function isStrongPhraseBreak(word) {
  return /[.!?;:]["')\]]?$/.test(String(word).trim());
}

function isSoftPhraseBreak(word) {
  return /[,]["')\]]?$/.test(String(word).trim());
}

function isListConjunction(word) {
  return /^(and|or)$/i.test(String(word).trim().replace(/[^a-z]/gi, ''));
}

function startsArticleOrPreposition(word) {
  return /^(a|an|the|in|on|at|by|for|from|with|without|into|onto|over|under|through|during|before|after|of)$/i
    .test(String(word).trim().replace(/[^a-z]/gi, ''));
}

function looksLikeVerb(word) {
  const normalized = String(word).trim().replace(/[^a-z]/gi, '').toLowerCase();
  return /^(is|are|was|were|be|being|been|am|has|have|had|do|does|did|can|could|will|would|should|may|might|must|discovered|found|saw|made|paid|spent|saved|lost|kept|became|went|got|started|ended)$/.test(normalized)
    || /(?:ed|ing)$/.test(normalized);
}

function isListMarker(word) {
  return /^(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|one|two|three|four|five|six|seven|eight|nine|ten|\d+)[\).,:]?$/i
    .test(String(word).trim());
}

function startsNewClause(word) {
  return /^(and|but|because|while|when|then|so|if|after|before|meanwhile|however|therefore|instead|also)$/i
    .test(String(word).trim().replace(/[^a-z]/gi, ''));
}

function isCommaListBreak(timedWords, index, chunkStart) {
  if (!isSoftPhraseBreak(timedWords[index].word)) return false;
  const nextWord = timedWords[index + 1]?.word || '';
  const wordsSinceSceneStart = index - chunkStart + 1;
  if (wordsSinceSceneStart <= 3 && startsArticleOrPreposition(nextWord)) return false;

  for (let lookahead = index + 1; lookahead < Math.min(timedWords.length, index + 5); lookahead += 1) {
    const word = timedWords[lookahead].word;
    if (isStrongPhraseBreak(word)) return false;
    if (looksLikeVerb(word)) return false;
    if (isSoftPhraseBreak(word) || isListConjunction(word)) return true;
  }
  return false;
}

function extractKeywords(text) {
  const uniqueWords = Array.from(new Set(
    (String(text).toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [])
      .filter((word) => !STOP_WORDS.has(word)),
  ));
  return uniqueWords.slice(0, 4).join(' ') || 'historical life';
}

function buildScenesFromWordTimings(words) {
  const timedWords = words
    .filter((word) => (
      typeof word.word === 'string'
      && word.word.trim()
      && Number.isFinite(word.start)
      && Number.isFinite(word.end)
      && word.end >= word.start
    ))
    .map((word) => ({ ...word, word: normalizeTranscriptWord(word.word) }));
  if (timedWords.length === 0) return [];

  const scenes = [];
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
    const hasEnoughScene = chunkDuration >= MIN_TRANSCRIPT_SCENE_SECONDS || chunkWordCount >= 3;
    const phraseBreak = hasEnoughScene && (
      isStrongPhraseBreak(currentWord.word)
      || isCommaListBreak(timedWords, index, chunkStart)
      || nextPause >= 0.32
      || (chunkWordCount >= 5 && nextStartsClause)
      || nextStartsListItem
    );
    const safetyBreak = chunkDuration >= SOFT_MAX_TRANSCRIPT_SCENE_SECONDS
      || chunkWordCount >= SOFT_MAX_TRANSCRIPT_SCENE_WORDS;
    if (nextWord && !phraseBreak && !safetyBreak) continue;

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
      results: [],
      selectedAsset: null,
      narrationStart,
      narrationEnd,
      clipStart: 0,
    });
    chunkStart = index + 1;
  }
  return scenes;
}

function audioDurationSeconds(filePath) {
  if (FORCE_DURATION_SECONDS > 0) return FORCE_DURATION_SECONDS;
  const ffmpegPath = require('ffmpeg-static');
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-i', filePath], { encoding: 'utf8' });
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const match = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`Could not read audio duration from ${filePath}`);
  return round(Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]), 2);
}

async function fetchJson(pathname, options = {}) {
  const response = await fetch(`${BASE_URL}${pathname}`, options);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!response.ok) {
    throw new Error(data?.error || data?.details || `Request failed: ${pathname} (${response.status})`);
  }
  return data;
}

async function ensureServer() {
  const response = await fetch(BASE_URL);
  if (!response.ok) throw new Error(`ViteVid server did not respond with OK: ${response.status}`);
}

async function transcribeVoiceover(audioPath, duration) {
  log(`Transcribing voiceover through ViteVid (${round(duration, 2)}s expected)...`);
  const buffer = await fs.readFile(audioPath);
  const file = new File([buffer], path.basename(audioPath), { type: 'audio/wav' });
  const formData = new FormData();
  formData.append('audio', file);
  formData.append('duration', String(duration || 0));
  formData.append('timingSource', 'audio');
  const response = await fetch(`${BASE_URL}/api/align-voiceover`, { method: 'POST', body: formData });
  const data = await response.json();
  if (!response.ok || !Array.isArray(data.words) || data.words.length === 0) {
    throw new Error(data.error || 'Voiceover transcription failed.');
  }
  log(`Transcribed ${data.words.length} words with ${data.provider || 'provider'}; timing duration ${round(data.durationSeconds || duration, 2)}s.`);
  return {
    ...data,
    durationSeconds: Number.isFinite(data.durationSeconds) && data.durationSeconds > 0 ? data.durationSeconds : duration,
  };
}

function fallbackTermsForSlot(text) {
  const words = Array.from(new Set(
    (String(text).toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [])
      .filter((word) => !STOP_WORDS.has(word)),
  ));
  const subject = words.slice(0, 3).join(' ') || 'vintage american people';
  return [`${subject} vintage footage`, `${subject} old film`, 'vintage american footage'];
}

function fallbackPlan(slot, index, startSceneNumber) {
  const searchTerms = fallbackTermsForSlot(slot.text).slice(0, 3);
  return {
    scene_number: startSceneNumber + index,
    scene_text: slot.text,
    duration_seconds: Math.max(0.1, round(slot.narrationEnd - slot.narrationStart, 2)),
    visual_description: slot.text || searchTerms[0],
    search_terms: searchTerms,
  };
}

async function planStoryboard(scenes) {
  log(`Planning ${scenes.length} voice-timed scenes with niche-aware video keywords...`);
  const planned = [];
  let aiPlanningDisabled = false;
  for (let index = 0; index < scenes.length; index += SCENES_PER_PLANNING_BATCH) {
    const batch = scenes.slice(index, index + SCENES_PER_PLANNING_BATCH);
    const payload = {
      scenes: batch.map((scene) => ({
        text: scene.text,
        contextBefore: scenes[scene.id - 1]?.text || '',
        contextAfter: scenes[scene.id + 1]?.text || '',
        narrationStart: scene.narrationStart,
        narrationEnd: scene.narrationEnd,
      })),
      mediaPreference: MEDIA_PREFERENCE,
      niche: NICHE,
      startSceneNumber: batch[0].id + 1,
    };
    if (!aiPlanningDisabled) try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PLAN_REQUEST_TIMEOUT_MS);
      const data = await fetchJson('/api/plan-storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const plans = Array.isArray(data) ? data : [];
      batch.forEach((scene, batchIndex) => {
        const plan = plans.find((entry) => entry.scene_number === scene.id + 1)
          || fallbackPlan(scene, batchIndex, batch[0].id + 1);
        scene.searchTerms = Array.from(new Set([...(plan.search_terms || []), extractKeywords(scene.text)].filter(Boolean))).slice(0, 4);
        scene.visualConcept = plan.visual_description || scene.text;
        scene.keywords = scene.searchTerms[0] || scene.keywords;
        planned.push(scene);
      });
    } catch (error) {
      aiPlanningDisabled = true;
      log(`Planning batch ${Math.floor(index / SCENES_PER_PLANNING_BATCH) + 1} failed, switching remaining scenes to deterministic keyword planning: ${error.message}`);
    }
    if (aiPlanningDisabled) {
      batch.forEach((scene, batchIndex) => {
        const plan = fallbackPlan(scene, batchIndex, batch[0].id + 1);
        scene.searchTerms = Array.from(new Set([...(plan.search_terms || []), extractKeywords(scene.text)].filter(Boolean))).slice(0, 4);
        scene.visualConcept = plan.visual_description || scene.text;
        scene.keywords = scene.searchTerms[0] || scene.keywords;
        planned.push(scene);
      });
    }
    log(`Planned ${Math.min(index + batch.length, scenes.length)}/${scenes.length} scenes.`);
  }
  return planned;
}

function nicheQueryVariants(query) {
  const clean = String(query).trim();
  if (!clean) return [];
  return [`${clean} vintage footage`, `${clean} old film`, clean];
}

function searchQueriesForScene(scene) {
  const source = `${scene.text} ${scene.visualConcept} ${scene.searchTerms.join(' ')}`.toLowerCase();
  const priorityQueries = [];
  if (/\b(bank|money|cash|dollar|coin|budget|debt|bill|rent|saving|savings|credit|finance|deed|mortgage|ledger)\b/.test(source)) {
    priorityQueries.push('counting money', 'bank teller', 'household budget', 'financial documents');
  }
  if (/\b(depression|bread|poverty|unemployed|closed|scarcity|collapse|1930|1920)\b/.test(source)) {
    priorityQueries.push('great depression family', 'bread line', 'old city street', 'closed bank');
  }
  if (/\b(flood|storm|disaster|water|destroyed|dayton|ohio)\b/.test(source)) {
    priorityQueries.push('historic flood', 'flooded street', 'disaster aftermath');
  }
  const queries = [
    ...priorityQueries,
    ...scene.searchTerms,
    extractKeywords(scene.visualConcept || scene.text),
    extractKeywords(scene.text),
  ];
  queries.push('vintage american people', 'old city street', 'hands writing documents');
  return Array.from(new Set(queries.flatMap(nicheQueryVariants))).slice(0, 9);
}

function scoreCandidate(candidate, scene, query) {
  const haystack = [
    candidate.title || '',
    candidate.description || '',
    candidate.year || '',
    ...(candidate.tags || []),
  ].join(' ').toLowerCase();
  const queryTerms = String(query).toLowerCase().match(/[a-z0-9]{3,}/g) || [];
  let score = 0;
  if (candidate.type === 'video') score += 30;
  if (candidate.source === 'Internet Archive') score += 18;
  if (candidate.source === 'Pexels' || candidate.source === 'Pixabay') score += 10;
  if (/\b(vintage|historic|history|old|archive|archival|retro|1920|1930|1940|1950|black and white|bank|money|family|street)\b/.test(haystack)) score += 12;
  score += queryTerms.filter((term) => haystack.includes(term)).length * 4;
  if (!candidate.downloadUrl && !candidate.thumbnail) score -= 100;
  if (candidate.type !== 'video') score -= 20;
  return score;
}

async function resolveInternetArchiveVideoUrl(identifier) {
  try {
    const response = await fetch(`https://archive.org/metadata/${identifier}`);
    if (!response.ok) throw new Error(`archive metadata ${response.status}`);
    const metadata = await response.json();
    const files = metadata.files || [];
    const mp4 = files.find((file) => (
      typeof file.name === 'string'
      && /\.mp4$/i.test(file.name)
      && /h\.264|512Kb MPEG4|MPEG4/i.test(file.format || '')
    )) || files.find((file) => typeof file.name === 'string' && /\.mp4$/i.test(file.name));
    return mp4?.name
      ? `https://archive.org/download/${identifier}/${encodeURIComponent(mp4.name)}`
      : `https://archive.org/download/${identifier}/${identifier}.mp4`;
  } catch {
    return `https://archive.org/download/${identifier}/${identifier}.mp4`;
  }
}

const fallbackUrlCache = new Map();

async function createGuaranteedFallbackAsset(scene) {
  const pool = GUARANTEED_NICHE_VIDEOS.history;
  const selected = pool[Math.abs(scene.id) % pool.length];
  if (!fallbackUrlCache.has(selected.id)) {
    fallbackUrlCache.set(selected.id, await resolveInternetArchiveVideoUrl(selected.id));
  }
  return {
    id: `guaranteed-${selected.id}`,
    source: 'Internet Archive',
    title: selected.title,
    type: 'video',
    thumbnail: `https://archive.org/services/img/${selected.id}`,
    url: `https://archive.org/details/${selected.id}`,
    year: selected.year,
    description: `Guaranteed real public-domain fallback video for ${NICHE}.`,
    downloads: 0,
    tags: selected.tags,
    downloadUrl: fallbackUrlCache.get(selected.id),
  };
}

const queryCache = new Map();

async function searchQuery(query) {
  const cacheKey = query.toLowerCase();
  if (queryCache.has(cacheKey)) return queryCache.get(cacheKey);
  const params = new URLSearchParams({ q: query, type: 'video', providers: 'all' });
  const data = await fetchJson(`/api/search?${params.toString()}`);
  const results = Array.isArray(data.results) ? data.results.filter((item) => item.downloadUrl || item.thumbnail) : [];
  queryCache.set(cacheKey, results);
  return results;
}

async function matchSceneMedia(scene) {
  const queries = searchQueriesForScene(scene);
  let best = null;
  let bestScore = -Infinity;
  let bestQuery = queries[0] || scene.keywords;

  for (const query of queries.slice(0, SEARCH_QUERIES_PER_SCENE)) {
    try {
      const results = await searchQuery(query);
      for (const candidate of results) {
        const score = scoreCandidate(candidate, scene, query);
        if (score > bestScore) {
          best = candidate;
          bestScore = score;
          bestQuery = query;
        }
      }
      if (best && best.type === 'video' && bestScore >= 52) break;
    } catch (error) {
      log(`Search failed for scene ${scene.id + 1} query "${query}": ${error.message}`);
    }
  }

  if (!best || best.type !== 'video') {
    best = await createGuaranteedFallbackAsset(scene);
    scene.selectionReason = 'No safe video result was available, so a real public-domain vintage fallback video was assigned.';
  } else {
    scene.selectionReason = `Selected video using query "${bestQuery}".`;
  }
  scene.selectedAsset = best;
  scene.results = [best];
  scene.keywords = bestQuery || scene.keywords;
  return scene;
}

async function matchAllMedia(scenes) {
  log(`Matching video assets for ${scenes.length} scenes with ${SEARCH_WORKERS} workers...`);
  let cursor = 0;
  let done = 0;
  async function worker() {
    while (cursor < scenes.length) {
      const index = cursor;
      cursor += 1;
      await matchSceneMedia(scenes[index]);
      done += 1;
      if (done % 20 === 0 || done === scenes.length) {
        log(`Matched ${done}/${scenes.length} scenes.`);
        await saveState({ scenes, progress: `matched ${done}/${scenes.length}` });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(SEARCH_WORKERS, scenes.length) }, () => worker()));
  return scenes;
}

function splitNumberTokens(value) {
  return String(value).toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);
}

function normalizeCaptionNumber(word) {
  const clean = cleanTimingToken(word);
  const parts = clean.split(/[-\s]+/).filter(Boolean);
  const numbers = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  };
  const ordinals = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
    ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14,
    fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
    twentieth: 20, thirtieth: 30, fortieth: 40, fiftieth: 50, sixtieth: 60,
    seventieth: 70, eightieth: 80, ninetieth: 90,
  };
  if (/^\d+$/.test(clean)) return Number(clean);
  if (parts.length === 1) return numbers[parts[0]] ?? ordinals[parts[0]];
  if (parts.length === 2) {
    const tens = numbers[parts[0]];
    const ones = numbers[parts[1]] ?? ordinals[parts[1]];
    if (tens >= 20 && ones > 0 && ones < 10) return tens + ones;
  }
  return numbers[clean] ?? ordinals[clean];
}

function numberTokenValue(token) {
  const clean = cleanTimingToken(token);
  if (/^\d+(?:\.\d+)?$/.test(clean)) return Number(clean);
  return normalizeCaptionNumber(clean);
}

function isNumberLikeToken(token) {
  return Number.isFinite(numberTokenValue(token));
}

const SCALE_WORDS = new Set(['hundred', 'thousand', 'million', 'billion', 'trillion']);
const STATISTIC_UNITS = new Set([
  'people', 'person', 'men', 'women', 'children', 'families', 'households', 'victims',
  'deaths', 'murders', 'cases', 'crimes', 'arrests', 'documents', 'homes', 'banks',
  'businesses', 'workers', 'jobs', 'days', 'weeks', 'months', 'hours', 'minutes',
  'seconds', 'times', 'points',
]);

function isNumberPhraseToken(token) {
  const clean = cleanTimingToken(token);
  return clean === 'and' || isNumberLikeToken(clean) || SCALE_WORDS.has(clean);
}

function parseSmallNumberTokens(tokens) {
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
  return current > 0 ? current : undefined;
}

function formatNumberPhraseFromTokens(rawTokens) {
  const tokens = rawTokens.flatMap(splitNumberTokens).filter((token) => token !== 'and');
  if (tokens.length === 0) return '';
  const digitToken = tokens.find((token) => /^\d+(?:\.\d+)?$/.test(token));
  const scaleIndex = tokens.findIndex((token) => SCALE_WORDS.has(token) && token !== 'hundred');
  if (scaleIndex >= 0) {
    const prefixTokens = tokens.slice(0, scaleIndex);
    const prefixValue = digitToken && prefixTokens.includes(digitToken) ? digitToken : parseSmallNumberTokens(prefixTokens);
    return `${prefixValue || prefixTokens.join(' ') || '1'} ${tokens[scaleIndex]}`;
  }
  if (digitToken) return digitToken;
  const value = parseSmallNumberTokens(tokens);
  return Number.isFinite(value) ? String(value) : tokens.join(' ');
}

function getNumberPhraseEndingAt(words, endIndex) {
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

function getNumberPhraseStartingAt(words, startIndex) {
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

function formatMoneyCaption(words, index) {
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
    if (phrase?.text) return currentToken.startsWith('cent') ? `(${phrase.text}c)` : `($${phrase.text})`;
  }
  return '';
}

function formatPercentageCaption(words, index) {
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

function formatYearCaption(word) {
  const digits = normalizeSpokenToken(word);
  return /^(17|18|19|20)\d{2}$/.test(digits) ? digits : '';
}

function formatYearCaptionFromWords(words, index) {
  const digitYear = formatYearCaption(words[index].word);
  if (digitYear) return digitYear;
  const current = cleanTimingToken(words[index].word);
  const previous = cleanTimingToken(words[index - 1]?.word || '');
  if (['seventeen', 'eighteen', 'nineteen', 'twenty'].includes(previous)) return '';
  const centuryMap = { seventeen: 1700, eighteen: 1800, nineteen: 1900, twenty: 2000 };
  const century = centuryMap[current];
  if (!century) return '';
  const next = cleanTimingToken(words[index + 1]?.word || '');
  const third = cleanTimingToken(words[index + 2]?.word || '');
  const nextValue = numberTokenValue(next);
  const thirdValue = numberTokenValue(third);
  if (current === 'twenty' && nextValue >= 20 && nextValue <= 99) {
    const suffix = nextValue >= 20 && thirdValue > 0 && thirdValue < 10 ? nextValue + thirdValue : nextValue;
    return suffix >= 0 && suffix <= 99 ? String(2000 + suffix) : '';
  }
  if (century < 2000 && nextValue >= 0 && nextValue <= 99) {
    const suffix = nextValue >= 20 && thirdValue > 0 && thirdValue < 10 ? nextValue + thirdValue : nextValue;
    return suffix >= 0 && suffix <= 99 ? String(century + suffix) : '';
  }
  return '';
}

function formatStatisticCaption(words, index) {
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
  if (/^(dollars?|cents?|percent|percentage)$/.test(next) || /^(dollars?|cents?|percent|percentage)$/.test(nextAfterUnit)) return '';
  if (STATISTIC_UNITS.has(next)) return `(${phrase.text} ${next})`;
  if (phrase.text.includes('thousand') || phrase.text.includes('million') || phrase.text.includes('billion') || phrase.text.includes('trillion')) return `(${phrase.text})`;
  if (/^\d{3,}$/.test(current) && !/^(17|18|19|20)\d{2}$/.test(current)) return `(${current})`;
  return '';
}

const CAPTION_NUMBER_PHRASE = String.raw`(?:\d{1,3}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth)(?:[-\s]+(?:one|two|three|four|five|six|seven|eight|nine|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth))?`;

function cleanupNumberCaptionTitle(value) {
  const trimmed = String(value).trim();
  const prefixMatch = trimmed.match(new RegExp(String.raw`^(?:number|no\.?|item|step|#)\s+(${CAPTION_NUMBER_PHRASE})(?:\b|[\).,:;\-\u2013\u2014])\s*([\s\S]*)`, 'i'));
  const directMatch = trimmed.match(new RegExp(String.raw`^(${CAPTION_NUMBER_PHRASE})\s*[\).,:;\-\u2013\u2014]\s*([\s\S]*)`, 'i'));
  const match = prefixMatch || directMatch;
  const title = match && Number.isFinite(normalizeCaptionNumber(match[1])) ? match[2] : trimmed;
  return title.replace(/\s+/g, ' ').replace(/[,;:.?!].*$/, '').trim().slice(0, 46);
}

function extractSceneNumberCaption(text, fallbackTitle = '') {
  const prefixMatch = String(text).match(new RegExp(String.raw`^\s*(?:number|no\.?|item|step|#)\s+(${CAPTION_NUMBER_PHRASE})(?:\b|[\).,:;\-\u2013\u2014])\s*([\s\S]*)`, 'i'));
  const directMatch = String(text).match(new RegExp(String.raw`^\s*(${CAPTION_NUMBER_PHRASE})\s*[\).,:;\-\u2013\u2014]\s*([\s\S]*)`, 'i'));
  const looseListMatch = String(text).match(new RegExp(String.raw`^\s*(${CAPTION_NUMBER_PHRASE})\s+(?:(?:item|items|strategy|strategies|reason|reasons|tip|tips|method|methods|way|ways|rule|rules|secret|secrets|mistake|mistakes|lesson|lessons|number)\b|(?:was|is|were|are)\b|[a-z][a-z'-]+\s+(?:on\s+this\s+list|was|is|were|are)\b)\s*([\s\S]*)`, 'i'));
  const leadingDigitTitleMatch = String(text).match(/^\s*(\d{1,3})\s+([a-z][\s\S]{8,})/i);
  const match = prefixMatch || directMatch || looseListMatch || leadingDigitTitleMatch;
  if (!match) return '';
  const number = normalizeCaptionNumber(match[1]);
  if (!Number.isFinite(number) || number <= 0) return '';
  const title = cleanupNumberCaptionTitle(match[2] || '') || cleanupNumberCaptionTitle(fallbackTitle);
  return title ? `${number}. ${title}` : `${number}.`;
}

function buildCallouts(words, scenes) {
  const callouts = [];
  const seen = new Set();
  function addCallout(text, start, effectId, kind) {
    const cleanText = String(text).replace(/\s+/g, ' ').trim().slice(0, 90);
    if (!cleanText || !Number.isFinite(start)) return;
    const roundedStart = Math.max(0, round(start - 0.18, 1));
    const key = `${effectId}:${cleanText.toLowerCase()}:${Math.round(roundedStart * 2) / 2}`;
    if (seen.has(key)) return;
    seen.add(key);
    callouts.push({ text: cleanText, start: roundedStart, effectId, kind });
  }

  words.forEach((word, index) => {
    const moneyCaption = formatMoneyCaption(words, index);
    if (moneyCaption) {
      const start = normalizeSpokenToken(word.word).match(/^(dollars?|cents?)$/)
        ? words[index - 1]?.start ?? word.start
        : word.start;
      addCallout(moneyCaption, start, 'clock-ticking', 'money');
    }
    const percentageCaption = formatPercentageCaption(words, index);
    if (percentageCaption) {
      const start = normalizeSpokenToken(word.word).match(/^(percent|percentage)$/)
        ? words[index - 1]?.start ?? word.start
        : word.start;
      addCallout(percentageCaption, start, 'whoosh', 'percentage');
    }
    const yearCaption = formatYearCaptionFromWords(words, index);
    if (yearCaption) addCallout(yearCaption, word.start, 'whoosh', 'year');
    const statisticCaption = formatStatisticCaption(words, index);
    if (statisticCaption) addCallout(statisticCaption, word.start, 'pop-up', 'statistic');
  });

  scenes.forEach((scene, index) => {
    const numberCaption = extractSceneNumberCaption(scene.text, scenes[index + 1]?.text || '');
    if (numberCaption) addCallout(numberCaption, scene.narrationStart || 0, 'keyboard-typing', 'number');
  });
  return callouts.sort((left, right) => left.start - right.start);
}

function verticalPositionForCallout(callout, allCallouts) {
  const overlaps = allCallouts.filter((entry) => Math.abs(entry.start - callout.start) <= 0.45);
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
}

function buildProject(scenes, words, durationSeconds) {
  const clips = scenes.map((scene, index) => {
    const nextStart = scenes[index + 1]?.narrationStart;
    const visualStart = index === 0 ? 0 : scene.narrationStart;
    const visualEnd = index === scenes.length - 1
      ? durationSeconds
      : Math.max(scene.narrationEnd, Number.isFinite(nextStart) ? nextStart : scene.narrationEnd);
    const clipDuration = Math.max(0.1, visualEnd - visualStart);
    const imageAsset = scene.selectedAsset?.type === 'image';
    const direction = index % 2 === 0 ? 1 : -1;
    const transition = index === 0 ? 'none' : index % 9 === 0 ? 'slidedown' : index % 5 === 0 ? 'slideleft' : 'fade';
    return {
      id: `scene-${scene.id}`,
      sceneId: scene.id,
      title: scene.selectedAsset?.title || `Scene ${index + 1}`,
      text: scene.text,
      type: scene.selectedAsset?.type || 'video',
      src: scene.selectedAsset?.downloadUrl || scene.selectedAsset?.thumbnail || '',
      poster: scene.selectedAsset?.thumbnail || scene.selectedAsset?.downloadUrl || '',
      duration: round(clipDuration, 2),
      sourceStart: 0,
      motion: index % 4 === 0 ? 'push-in' : index % 4 === 1 ? 'pan-right' : index % 4 === 2 ? 'pull-out' : 'pan-left',
      transition,
      startScale: imageAsset ? 100 : 106,
      endScale: imageAsset ? 103 : 118,
      startX: imageAsset ? direction * 1.5 : direction * 4,
      endX: imageAsset ? -direction * 1.5 : -direction * 4,
      startY: imageAsset ? (index % 3 === 0 ? -0.5 : 0.5) : (index % 3 === 0 ? -2 : 1),
      endY: imageAsset ? (index % 3 === 0 ? 0.5 : -0.5) : (index % 3 === 0 ? 2 : -1),
      rotation: imageAsset ? 0 : -direction * 0.35,
      brightness: 96,
      contrast: imageAsset ? 112 : 120,
      saturation: imageAsset ? 80 : 92,
      sepia: imageAsset ? 20 : 10,
    };
  });

  const clipTotal = clips.reduce((total, clip) => total + clip.duration, 0);
  if (Math.abs(clipTotal - durationSeconds) > 0.05 && clips.length > 0) {
    clips[clips.length - 1].duration = round(Math.max(0.1, clips[clips.length - 1].duration + (durationSeconds - clipTotal)), 2);
  }

  const callouts = buildCallouts(words, scenes);
  const textOverlays = callouts.map((callout, index) => ({
    id: `text-rule-${index}`,
    text: callout.text,
    start: callout.start,
    duration: callout.effectId === 'keyboard-typing' ? 2.8 : 2,
    x: 50,
    y: verticalPositionForCallout(callout, callouts),
    size: callout.effectId === 'keyboard-typing' ? 46 : 62,
    color: '#f8efe1',
    background: '#1d1510',
  }));

  const soundEffects = callouts.map((callout) => {
    const effect = SOUND_EFFECTS[callout.effectId] || SOUND_EFFECTS['pop-up'];
    return {
      src: effect.publicPath,
      start: callout.start,
      duration: effect.duration,
      sourceStart: 0,
      volume: effect.volume,
      effectId: callout.effectId,
    };
  });

  let lastTransitionStart = -999;
  scenes.forEach((scene, index) => {
    const start = scene.narrationStart || 0;
    if (index === 0 || start - lastTransitionStart < 18) return;
    lastTransitionStart = start;
    soundEffects.push({
      src: SOUND_EFFECTS.whoosh.publicPath,
      start: Math.max(0, round(start - 0.12, 1)),
      duration: SOUND_EFFECTS.whoosh.duration,
      sourceStart: 0,
      volume: 0.34,
      effectId: 'whoosh',
    });
  });

  return {
    project: {
      clips,
      textOverlays,
      audioTrack: {
        src: '',
        start: 0,
        duration: durationSeconds,
        sourceStart: 0,
        volume: 1,
      },
      soundEffects: soundEffects.map(({ effectId, ...effect }) => effect),
      canvasColor: '#050b07',
      width: WIDTH,
      height: HEIGHT,
      fps: FPS,
      durationInFrames: Math.max(1, Math.ceil(durationSeconds * FPS)),
    },
    callouts,
    soundEffects,
  };
}

async function saveState(state) {
  const serializable = {
    generatedAt: new Date().toISOString(),
    audioPath: AUDIO_PATH,
    outputPath: OUTPUT_PATH,
    niche: NICHE,
    ...state,
  };
  await fs.writeFile(RUN_STATE_PATH, JSON.stringify(serializable, null, 2));
}

async function loadMatchedScenes(expectedDuration) {
  try {
    const raw = await fs.readFile(RUN_STATE_PATH, 'utf8');
    const state = JSON.parse(raw);
    if (!Array.isArray(state.scenes) || state.scenes.length === 0) return null;
    if (Math.abs(Number(state.durationSeconds || 0) - expectedDuration) > 1.5) return null;
    const scenes = state.scenes.filter((scene) => scene?.selectedAsset?.downloadUrl || scene?.selectedAsset?.thumbnail);
    if (scenes.length !== state.scenes.length) return null;
    return state.scenes;
  } catch {
    return null;
  }
}

async function renderProject(project, soundEffects) {
  log(`Rendering ${round(project.durationInFrames / project.fps, 2)}s MP4 with ${project.clips.length} clips, ${project.textOverlays.length} captions, ${project.soundEffects.length} sound effects...`);
  const audioBuffer = await fs.readFile(AUDIO_PATH);
  const formData = new FormData();
  formData.append('project', JSON.stringify(project));
  formData.append('backgroundAudio', new File([audioBuffer], path.basename(AUDIO_PATH), { type: 'audio/wav' }));
  for (let index = 0; index < soundEffects.length; index += 1) {
    const effect = SOUND_EFFECTS[soundEffects[index].effectId] || SOUND_EFFECTS['pop-up'];
    if (!existsSync(effect.localPath)) continue;
    const buffer = await fs.readFile(effect.localPath);
    formData.append(`timelineEffect_${index}`, new File([buffer], path.basename(effect.localPath), { type: 'audio/mpeg' }));
  }

  const response = await fetch(`${BASE_URL}/api/render-remotion`, {
    method: 'POST',
    body: formData,
    dispatcher: new Agent({
      headersTimeout: 2 * 60 * 60 * 1000,
      bodyTimeout: 2 * 60 * 60 * 1000,
    }),
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `Render failed with status ${response.status}`);
  }
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await new Promise((resolve, reject) => {
    const writeStream = createWriteStream(OUTPUT_PATH);
    Readable.fromWeb(response.body).pipe(writeStream);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });
  const stat = await fs.stat(OUTPUT_PATH);
  log(`Saved render to ${OUTPUT_PATH} (${Math.round(stat.size / 1024 / 1024)} MB).`);
}

async function verifyDuration(filePath, expectedSeconds) {
  const ffmpegPath = require('ffmpeg-static');
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-i', filePath], { encoding: 'utf8' });
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const match = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`Could not verify output duration for ${filePath}`);
  const actual = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  const delta = Math.abs(actual - expectedSeconds);
  log(`Verified output duration: ${round(actual, 2)}s; expected ${round(expectedSeconds, 2)}s; delta ${round(delta, 2)}s.`);
  if (delta > 1.5) throw new Error(`Output duration mismatch: expected ${expectedSeconds}s, got ${actual}s.`);
  return actual;
}

async function main() {
  if (!existsSync(AUDIO_PATH)) throw new Error(`Audio file does not exist: ${AUDIO_PATH}`);
  await ensureServer();
  const metadataDuration = audioDurationSeconds(AUDIO_PATH);
  const transcription = await transcribeVoiceover(AUDIO_PATH, metadataDuration);
  const durationSeconds = round(Math.max(metadataDuration, transcription.durationSeconds || 0), 2);
  const scenes = buildScenesFromWordTimings(transcription.words);
  if (scenes.length === 0) throw new Error('No usable voice-timed scenes were generated.');
  log(`Built ${scenes.length} scenes from word timings. Target duration ${durationSeconds}s.`);
  const resumedScenes = await loadMatchedScenes(durationSeconds);
  if (!resumedScenes) {
    await saveState({ durationSeconds, transcriptionSummary: { provider: transcription.provider, words: transcription.words.length }, scenes });
  }

  const matched = resumedScenes
    ? resumedScenes
    : await matchAllMedia(await planStoryboard(scenes));
  if (resumedScenes) {
    log(`Reusing ${resumedScenes.length} previously matched scenes from ${RUN_STATE_PATH}.`);
  } else {
    await saveState({ durationSeconds, transcriptionSummary: { provider: transcription.provider, words: transcription.words.length }, scenes: matched, progress: 'matched' });
  }
  const emptyScenes = matched.filter((scene) => !scene.selectedAsset);
  if (emptyScenes.length > 0) throw new Error(`${emptyScenes.length} scenes still have no media.`);
  const videoScenes = matched.filter((scene) => scene.selectedAsset?.type === 'video').length;
  log(`Media coverage complete: ${videoScenes}/${matched.length} scenes are video assets.`);

  const { project, callouts, soundEffects } = buildProject(matched, transcription.words, durationSeconds);
  await saveState({
    durationSeconds,
    transcriptionSummary: { provider: transcription.provider, words: transcription.words.length },
    scenes: matched,
    projectSummary: {
      clips: project.clips.length,
      captions: project.textOverlays.length,
      soundEffects: project.soundEffects.length,
      durationInFrames: project.durationInFrames,
    },
    callouts,
    progress: 'rendering',
  });

  await renderProject(project, soundEffects);
  const actualDuration = await verifyDuration(OUTPUT_PATH, durationSeconds);
  await saveState({
    durationSeconds,
    actualDuration,
    transcriptionSummary: { provider: transcription.provider, words: transcription.words.length },
    scenes: matched,
    projectSummary: {
      clips: project.clips.length,
      captions: project.textOverlays.length,
      soundEffects: project.soundEffects.length,
      durationInFrames: project.durationInFrames,
    },
    outputPath: OUTPUT_PATH,
    progress: 'complete',
  });
  log('ViteVid production run complete.');
}

main().catch(async (error) => {
  console.error(error);
  try {
    await saveState({ progress: 'failed', error: error instanceof Error ? error.message : String(error) });
  } catch {}
  process.exitCode = 1;
});
