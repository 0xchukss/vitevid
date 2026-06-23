import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, statSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

const BASE_URL = process.env.VITEVID_BASE_URL || 'http://localhost:3000';
const AUDIO_PATH = process.argv[2] || 'C:\\Users\\Hp\\Downloads\\tts-audio (19).wav';
const STATE_PATH = process.argv[3] || path.join(os.homedir(), 'Downloads', 'ViteVid_tts-audio-19_run-state.json');
const OUTPUT_PATH = process.argv[4] || path.join(os.homedir(), 'Downloads', 'ViteVid_tts-audio-19_web_final.mp4');
const WORK_DIR = process.argv[5] || path.join(os.homedir(), 'Downloads', 'vitevid_web_render_assets');
const MANIFEST_PATH = path.join(WORK_DIR, 'asset-manifest.json');
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 24;
const SEARCH_WORKERS = Number(process.env.VITEVID_WEB_WORKERS || 8);
const MAX_QUERY_ATTEMPTS = Number(process.env.VITEVID_QUERY_ATTEMPTS || 5);
const DOWNLOAD_TIMEOUT_MS = 18000;
const MIN_IMAGE_BYTES = 8 * 1024;
const MAX_IMAGE_BYTES = 14 * 1024 * 1024;
const NICHE = 'history (vintage)';
const SEGMENT_DIR = path.join(WORK_DIR, 'scene_segments');
const STILL_DIR = path.join(WORK_DIR, 'normalized_stills');
const SEGMENT_WORKERS = Number(process.env.VITEVID_SEGMENT_WORKERS || 4);

const SOUND_EFFECTS = {
  'clock-ticking': { file: path.resolve('public', 'sound-effects', 'clock-ticking.mp3'), duration: 2.2, volume: 0.45 },
  'keyboard-typing': { file: path.resolve('public', 'sound-effects', 'keyboard-typing.mp3'), duration: 2.8, volume: 0.72 },
  whoosh: { file: path.resolve('public', 'sound-effects', 'whoosh.mp3'), duration: 0.9, volume: 0.62 },
  'pop-up': { file: path.resolve('public', 'sound-effects', 'pop-up.mp3'), duration: 1.1, volume: 0.62 },
};

let decodeFallbackCount = 0;

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'against', 'almost', 'along', 'also', 'among', 'another',
  'because', 'before', 'being', 'between', 'could', 'every', 'first', 'from', 'have',
  'into', 'itself', 'just', 'like', 'more', 'most', 'only', 'other', 'over', 'people',
  'same', 'should', 'some', 'such', 'than', 'that', 'their', 'there', 'these', 'they',
  'this', 'those', 'through', 'under', 'until', 'very', 'voice', 'what', 'when', 'where',
  'which', 'while', 'with', 'would', 'your', 'youre', 'lets', 'number',
]);

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function fileExists(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).size > 4096;
  } catch {
    return false;
  }
}

function safeFilename(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, '_').slice(0, 90) || 'asset';
}

function secondsToAssTime(seconds) {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const centiseconds = Math.floor((safe - Math.floor(safe)) * 100);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function escapeAssText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

function wrapCaption(value, maxChars = 44) {
  const words = String(value).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 2).join('\\N');
}

function shellQuoteConcatPath(value) {
  return String(value).replace(/\\/g, '/').replace(/'/g, "'\\''");
}

function runFfmpeg(args, label, cwd = WORK_DIR) {
  log(`ffmpeg: ${label}`);
  const result = spawnSync(ffmpegPath, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 40 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${result.error?.message || result.stderr || result.stdout || `exit ${result.status}`}`);
  }
  return result;
}

function runFfmpegAsync(args, label, cwd = WORK_DIR) {
  log(`ffmpeg: ${label}`);
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { cwd, windowsHide: true });
    let output = '';
    const append = (chunk) => {
      output += chunk.toString();
      if (output.length > 2 * 1024 * 1024) output = output.slice(-2 * 1024 * 1024);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} failed with exit ${code}:\n${output}`));
      }
    });
  });
}

function parseFfmpegDuration(filePath) {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-i', filePath], { encoding: 'utf8' });
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const match = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`Could not read duration for ${filePath}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function extensionForContentType(contentType, url) {
  const cleanUrl = String(url || '').split('?')[0].toLowerCase();
  if (contentType.includes('png') || cleanUrl.endsWith('.png')) return '.png';
  if (contentType.includes('webp') || cleanUrl.endsWith('.webp')) return '.webp';
  if (contentType.includes('jpeg') || contentType.includes('jpg') || cleanUrl.endsWith('.jpg') || cleanUrl.endsWith('.jpeg')) return '.jpg';
  return '.jpg';
}

function extractKeywords(text, limit = 5) {
  return Array.from(new Set(
    (String(text).toLowerCase().match(/[a-z][a-z'-]{2,}|\d{3,4}/g) || [])
      .filter((word) => !STOP_WORDS.has(word)),
  )).slice(0, limit).join(' ');
}

function stripLeadingSceneNumber(text) {
  return String(text)
    .replace(/^\s*(?:number|no\.?|item|step|#)\s+/i, '')
    .replace(/^\s*(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|twenty[-\s]+one|twenty[-\s]+two|twenty[-\s]+three|twenty[-\s]+four|twenty[-\s]+five|\d{1,2})[\).,:;\-\s]+/i, '');
}

function sceneDuration(scenes, index, targetDuration) {
  const scene = scenes[index];
  const nextStart = scenes[index + 1]?.narrationStart;
  const visualStart = index === 0 ? 0 : scene.narrationStart || 0;
  const visualEnd = index === scenes.length - 1
    ? targetDuration
    : Math.max(scene.narrationEnd || visualStart + 0.5, Number.isFinite(nextStart) ? nextStart : scene.narrationEnd || visualStart + 0.5);
  return Math.max(0.12, visualEnd - visualStart);
}

const NUMBER_WORD_VALUES = new Map(Object.entries({
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
}));

const NUMBER_TOKEN = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|twenty[-\\s]+one|twenty[-\\s]+two|twenty[-\\s]+three|twenty[-\\s]+four|twenty[-\\s]+five|\\d{1,3})';

function numberTokenToInt(value) {
  const clean = String(value || '').toLowerCase().replace(/[-,.;:]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^\d+$/.test(clean)) return Number(clean);
  const parts = clean.split(' ');
  let total = 0;
  for (const part of parts) {
    if (!NUMBER_WORD_VALUES.has(part)) return null;
    total += NUMBER_WORD_VALUES.get(part);
  }
  return total || null;
}

function firstSentence(value) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  const match = clean.match(/^(.+?[.!?])(?:\s|$)/);
  return (match?.[1] || clean).trim();
}

function cleanCalloutTitle(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[,.;:\-\s]+/, '')
    .replace(/[.?!]+$/, '')
    .trim();
}

function buildListTitle(scenes, index, initialTitle) {
  let title = cleanCalloutTitle(initialTitle);
  let cursor = index + 1;
  while ((!title || !/[.!?]\s*$/.test(initialTitle || '') || /\b(as|of|for|from|with|without|before|after|instead|by|to|the|a|an)$/i.test(title)) && cursor < scenes.length && cursor <= index + 3) {
    title = cleanCalloutTitle(`${title} ${firstSentence(scenes[cursor]?.text || '')}`);
    if (/[.!?]\s*$/.test(scenes[cursor]?.text || '')) break;
    cursor += 1;
  }
  return cleanCalloutTitle(title);
}

function estimateTermStart(scene, matchIndex) {
  const start = Number(scene.narrationStart || 0);
  const end = Number(scene.narrationEnd || start + 1);
  const textLength = Math.max(1, String(scene.text || '').length);
  const ratio = Math.min(0.88, Math.max(0.05, matchIndex / textLength));
  return round(start + (end - start) * ratio, 2);
}

function addCallout(callouts, seen, callout) {
  if (!callout.text || !Number.isFinite(callout.start)) return;
  const key = `${callout.kind}:${callout.text.toLowerCase()}:${Math.round(callout.start * 2) / 2}`;
  if (seen.has(key)) return;
  seen.add(key);
  callouts.push(callout);
}

function formatMoneyCallout(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.includes('$')) return `(${text.replace(/\s+/g, '')})`;
  const cents = text.match(/^(\d+(?:\.\d+)?)\s*(?:¢|cents?|c)$/i);
  if (cents) return `(${cents[1]}¢)`;
  const dollars = text.match(/^(\d+(?:\.\d+)?)\s*dollars?$/i);
  if (dollars) return `($${dollars[1]})`;
  return `(${text})`;
}

function generateCalloutsFromScenes(scenes) {
  const callouts = [];
  const seen = new Set();
  const listPattern = new RegExp(`^\\s*number\\s+(${NUMBER_TOKEN})\\s*[,.:;\\-]?\\s*(.*)$`, 'i');
  const continuedListPattern = new RegExp(`^\\s*(${NUMBER_TOKEN})\\s*[,.:;\\-]\\s*(.+)$`, 'i');
  const previousEndsWithNumber = (index) => /\bnumber\s*$/i.test(String(scenes[index - 1]?.text || '').trim());

  scenes.forEach((scene, index) => {
    const text = String(scene.text || '');
    const listMatch = text.match(listPattern);
    const continuedMatch = !listMatch && previousEndsWithNumber(index) ? text.match(continuedListPattern) : null;
    const match = listMatch || continuedMatch;
    if (match) {
      const number = numberTokenToInt(match[1]);
      const title = buildListTitle(scenes, index, match[2] || '');
      if (number && number <= 99 && title) {
        addCallout(callouts, seen, {
          text: `${number}. ${title}`,
          start: round((continuedMatch ? scene.narrationStart : scene.narrationStart) + 0.08, 2),
          effectId: 'keyboard-typing',
          kind: 'number',
        });
      }
    }

    for (const yearMatch of text.matchAll(/\b(18|19|20)\d{2}\b/g)) {
      addCallout(callouts, seen, {
        text: yearMatch[0],
        start: estimateTermStart(scene, yearMatch.index || 0),
        effectId: 'whoosh',
        kind: 'year',
      });
    }

    const moneyPatterns = [
      /\$\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:million|billion|thousand))?/gi,
      /\b\d+(?:\.\d+)?\s*(?:¢|cents?|dollars?)\b/gi,
    ];
    for (const pattern of moneyPatterns) {
      for (const moneyMatch of text.matchAll(pattern)) {
        addCallout(callouts, seen, {
          text: formatMoneyCallout(moneyMatch[0]),
          start: estimateTermStart(scene, moneyMatch.index || 0),
          effectId: 'clock-ticking',
          kind: 'money',
        });
      }
    }

    for (const percentageMatch of text.matchAll(/\b\d+(?:\.\d+)?\s*(?:%|percent)\b/gi)) {
      const normalized = percentageMatch[0].replace(/\s*percent/i, '%').replace(/\s+/g, '');
      addCallout(callouts, seen, {
        text: `(${normalized})`,
        start: estimateTermStart(scene, percentageMatch.index || 0),
        effectId: 'whoosh',
        kind: 'percentage',
      });
    }

    const statisticPattern = new RegExp(`\\b(?:\\d[\\d,]*(?:\\.\\d+)?|${NUMBER_TOKEN})\\s+(?:million|billion|thousand|households|families|weeks|days|pounds|gallons|quarters|people|banks|stores)\\b`, 'gi');
    for (const statisticMatch of text.matchAll(statisticPattern)) {
      const raw = statisticMatch[0];
      if (/\$|¢|cents?|dollars?|percent|%/i.test(raw)) continue;
      if (/^number\b/i.test(raw)) continue;
      addCallout(callouts, seen, {
        text: `(${raw.replace(/\s+/g, ' ')})`,
        start: estimateTermStart(scene, statisticMatch.index || 0),
        effectId: 'pop-up',
        kind: 'statistic',
      });
    }
  });

  return callouts.sort((left, right) => left.start - right.start);
}

function querySetForScene(scene, index) {
  const source = `${scene.text || ''} ${scene.visualConcept || ''} ${(scene.searchTerms || []).join(' ')}`.toLowerCase();
  const title = stripLeadingSceneNumber(scene.text || '');
  const core = extractKeywords(title || scene.text, 5);
  const visual = extractKeywords(scene.visualConcept || scene.keywords || scene.text, 5);
  const year = source.match(/\b(18|19|20)\d{2}\b/)?.[0] || '';
  const queries = [];

  if (/\b(bank|money|cash|dollar|coin|budget|debt|bill|rent|saving|savings|credit|finance|deed|mortgage|ledger|income|percent|cost|price)\b/.test(source)) {
    queries.push(
      `${core} vintage bank money photograph`,
      `${visual} financial documents archival photo`,
      '1930s bank interior money archival photograph',
      'vintage household budget cash photograph',
    );
  }
  if (/\b(depression|bread|poverty|unemployed|closed|scarcity|collapse|crisis|1930|1920)\b/.test(source)) {
    queries.push(
      `${core} Great Depression archival photograph`,
      'Great Depression family archival photograph',
      '1930s American street archival photograph',
      'closed bank 1930s archival photograph',
    );
  }
  if (/\b(flood|storm|disaster|water|destroyed|dayton|ohio)\b/.test(source)) {
    queries.push(
      `${core} historic flood archival photograph`,
      'Dayton Ohio flood archival photograph',
      'American town flood vintage photograph',
    );
  }
  if (/\b(home|house|family|mother|father|kitchen|food|cellar|garden|table|meal|children|clothes)\b/.test(source)) {
    queries.push(
      `${core} vintage American family home photograph`,
      `${visual} 1930s family kitchen archival photo`,
      'vintage American home kitchen photograph',
    );
  }
  if (/\b(document|paper|newspaper|letter|record|contract|law|congress|rule|club|receipt|envelope)\b/.test(source)) {
    queries.push(
      `${core} archival document photograph`,
      `${visual} vintage papers photograph`,
      'old newspaper documents archival photo',
    );
  }

  queries.push(
    `${[year, core].filter(Boolean).join(' ')} vintage American photograph`.trim(),
    `${visual || core} archival photograph`,
    `${core || visual} black and white documentary photo`,
    `${scene.keywords || core || 'vintage American people'} vintage photo`,
    `vintage American life archival photograph ${index + 1}`,
  );

  return Array.from(new Set(
    queries
      .map((query) => query.replace(/\s+/g, ' ').trim())
      .filter((query) => query.length > 5),
  )).slice(0, MAX_QUERY_ATTEMPTS);
}

async function fetchJsonWithTimeout(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }
    if (!response.ok) throw new Error(data?.error || data?.details || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function searchAssets(query) {
  const params = new URLSearchParams({
    q: query,
    type: 'image',
    providers: 'web',
    niche: NICHE,
  });
  const data = await fetchJsonWithTimeout(`${BASE_URL}/api/search?${params.toString()}`);
  return Array.isArray(data.results) ? data.results : [];
}

function scoreCandidate(candidate, scene, query) {
  const haystack = [
    candidate.title || '',
    candidate.description || '',
    candidate.source || '',
    candidate.rightsLabel || '',
    candidate.rightsNote || '',
    candidate.sourcePageUrl || candidate.url || '',
    ...(candidate.tags || []),
  ].join(' ').toLowerCase();
  const terms = Array.from(new Set(String(query).toLowerCase().match(/[a-z0-9]{3,}/g) || []));
  let score = 0;
  if (candidate.rightsStatus === 'verified-safe') score += 42;
  if (candidate.rightsStatus === 'open-license-filtered') score += 25;
  if (!candidate.needsRightsReview) score += 14;
  if (/\b(wikimedia|wikipedia|commons|loc\.gov|archives\.gov|public domain|creative commons|cc-by|cc by)\b/.test(haystack)) score += 18;
  if (/\b(alamy|shutterstock|getty|istock|dreamstime|depositphotos|pinterest|slide|cartoon|illustration|icon|logo|ai generated)\b/.test(haystack)) score -= 80;
  if (/\b(vintage|historic|archival|archive|1930|1920|1940|black and white|depression|bank|family|street|document|newspaper)\b/.test(haystack)) score += 14;
  score += terms.filter((term) => haystack.includes(term)).length * 4;
  if (!candidate.downloadUrl && !candidate.thumbnail) score -= 100;
  return score;
}

async function downloadCandidate(candidate, scene, index, usedHashes) {
  const urls = Array.from(new Set([candidate.downloadUrl, candidate.thumbnail].filter(Boolean)));
  for (const url of urls) {
    if (!/^https?:\/\//i.test(url)) continue;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121 Safari/537.36',
          Accept: 'image/*,*/*',
          Referer: candidate.sourcePageUrl || candidate.url || new URL(url).origin,
        },
      });
      if (!response.ok) continue;
      const contentType = response.headers.get('content-type') || '';
      if (contentType && !contentType.includes('image') && !contentType.includes('octet-stream')) continue;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < MIN_IMAGE_BYTES || buffer.length > MAX_IMAGE_BYTES) continue;
      const hash = createHash('sha1').update(buffer).digest('hex');
      if (usedHashes.has(hash)) continue;
      usedHashes.add(hash);
      const extension = extensionForContentType(contentType, url);
      const destination = path.join(WORK_DIR, `scene_${String(index + 1).padStart(4, '0')}_${safeFilename(candidate.source)}${extension}`);
      await fs.writeFile(destination, buffer);
      return {
        path: destination,
        url,
        hash,
        candidate,
        title: candidate.title || scene.text || `Scene ${index + 1}`,
      };
    } catch {
      // Try the next candidate URL.
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

async function createTextFallbackImage(scene, index) {
  const outPath = path.join(WORK_DIR, `scene_${String(index + 1).padStart(4, '0')}_fallback.jpg`);
  const caption = wrapCaption(scene.text || `Scene ${index + 1}`, 34).replace(/\\N/g, '\n').replace(/:/g, '\\:');
  runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=0x071008:s=${WIDTH}x${HEIGHT}:d=1`,
    '-vf', `noise=alls=10:allf=t+u,drawbox=x=70:y=70:w=${WIDTH - 140}:h=${HEIGHT - 140}:color=0x152016@0.55:t=fill,drawtext=font=Arial:text='${caption.replace(/'/g, "\\'")}':fontcolor=0xe8f7dd:fontsize=42:x=(w-text_w)/2:y=(h-text_h)/2:borderw=3:bordercolor=0x000000`,
    '-frames:v', '1',
    outPath,
  ], `create no-duplicate text fallback scene ${index + 1}`);
  return {
    path: outPath,
    url: `local-text-fallback-${index + 1}`,
    hash: `local-text-fallback-${index + 1}`,
    candidate: {
      id: `local-text-fallback-${index + 1}`,
      source: 'ViteVid local title card',
      title: `Scene ${index + 1}`,
      rightsLabel: 'Original local card',
      rightsStatus: 'verified-safe',
      needsRightsReview: false,
    },
  };
}

async function prepareSceneMedia(scenes) {
  await fs.mkdir(WORK_DIR, { recursive: true });
  try {
    const existingManifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
    if (Array.isArray(existingManifest) && existingManifest.length === scenes.length) {
      const reusable = await Promise.all(existingManifest.map(async (entry) => (
        entry?.localPath && await fs.access(entry.localPath).then(() => true).catch(() => false)
      )));
      if (reusable.every(Boolean)) {
        existingManifest.forEach((entry, index) => {
          scenes[index].imagePath = entry.localPath;
          scenes[index].selectedRenderAsset = {
            source: entry.source,
            title: entry.title,
            rightsLabel: entry.rightsLabel,
            rightsStatus: entry.rightsStatus,
            needsRightsReview: entry.needsRightsReview,
            sourcePageUrl: entry.sourcePageUrl,
          };
        });
        const fallbackCount = existingManifest.filter((entry) => String(entry.source || '').includes('local title card')).length;
        log(`Reusing ${existingManifest.length} prepared unique visuals from manifest (${fallbackCount} local title cards).`);
        return { scenes, fallbackCount };
      }
    }
  } catch {
    // No reusable manifest yet.
  }

  const usedUrls = new Set();
  const usedHashes = new Set();
  const manifest = [];
  let cursor = 0;
  let completed = 0;
  let fallbackCount = 0;

  async function worker(workerId) {
    while (cursor < scenes.length) {
      const index = cursor;
      cursor += 1;
      const scene = scenes[index];
      let selected = null;
      const queries = querySetForScene(scene, index);
      for (const query of queries) {
        let results = [];
        try {
          results = await searchAssets(query);
        } catch (error) {
          log(`Search failed for scene ${index + 1} query "${query}": ${error.message}`);
          continue;
        }
        const ranked = results
          .filter((candidate) => !usedUrls.has(candidate.downloadUrl) && !usedUrls.has(candidate.thumbnail))
          .sort((left, right) => scoreCandidate(right, scene, query) - scoreCandidate(left, scene, query))
          .slice(0, 10);
        for (const candidate of ranked) {
          selected = await downloadCandidate(candidate, scene, index, usedHashes);
          if (!selected) continue;
          usedUrls.add(candidate.downloadUrl);
          usedUrls.add(candidate.thumbnail);
          selected.query = query;
          break;
        }
        if (selected) break;
      }
      if (!selected) {
        fallbackCount += 1;
        selected = await createTextFallbackImage(scene, index);
      }
      scene.imagePath = selected.path;
      scene.selectedRenderAsset = selected.candidate;
      manifest[index] = {
        scene: index + 1,
        text: scene.text,
        query: selected.query || '',
        source: selected.candidate.source,
        title: selected.candidate.title,
        rightsLabel: selected.candidate.rightsLabel,
        rightsStatus: selected.candidate.rightsStatus,
        needsRightsReview: selected.candidate.needsRightsReview,
        sourcePageUrl: selected.candidate.sourcePageUrl || selected.candidate.url || '',
        downloadUrl: selected.url,
        localPath: selected.path,
      };
      completed += 1;
      if (completed % 20 === 0 || completed === scenes.length) {
        log(`Prepared ${completed}/${scenes.length} unique visuals (${fallbackCount} local title cards).`);
        await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest.filter(Boolean), null, 2));
      }
    }
    log(`Media worker ${workerId} finished.`);
  }

  await Promise.all(Array.from({ length: Math.min(SEARCH_WORKERS, scenes.length) }, (_, index) => worker(index + 1)));
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest.filter(Boolean), null, 2));
  return { scenes, fallbackCount };
}

async function writeConcatFile(scenes, targetDuration) {
  const lines = ['ffconcat version 1.0'];
  scenes.forEach((scene, index) => {
    lines.push(`file '${shellQuoteConcatPath(path.relative(WORK_DIR, scene.imagePath))}'`);
    lines.push(`duration ${sceneDuration(scenes, index, targetDuration).toFixed(3)}`);
  });
  lines.push(`file '${shellQuoteConcatPath(path.relative(WORK_DIR, scenes[scenes.length - 1].imagePath))}'`);
  const concatPath = path.join(WORK_DIR, 'scenes.ffconcat');
  await fs.writeFile(concatPath, `${lines.join('\n')}\n`);
  return concatPath;
}

function calloutY(callout, allCallouts) {
  const overlaps = allCallouts.filter((entry) => Math.abs(entry.start - callout.start) <= 0.45);
  const hasYear = overlaps.some((entry) => entry.kind === 'year');
  const hasMoney = overlaps.some((entry) => entry.kind === 'money');
  if (hasYear && hasMoney) {
    if (callout.kind === 'year') return 18;
    if (callout.kind === 'money') return 82;
  }
  if (callout.kind === 'year') return 20;
  if (callout.kind === 'money') return 80;
  if (callout.kind === 'percentage') return 72;
  if (callout.kind === 'statistic') return 66;
  if (callout.kind === 'number') return 58;
  return 74;
}

async function writeAssSubtitles(scenes, callouts, targetDuration) {
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${WIDTH}`,
    `PlayResY: ${HEIGHT}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Spoken,Arial,36,&H00F3F7EC,&H00FFFFFF,&H00101010,&H99000000,1,0,0,0,100,100,0,0,1,4,1,2,72,72,58,1',
    'Style: Callout,Arial,58,&H001CFF8A,&H00FFFFFF,&H00000000,&HAA000000,1,0,0,0,100,100,0,0,1,5,2,5,40,40,40,1',
    'Style: Money,Arial,64,&H0000E5FF,&H00FFFFFF,&H00000000,&HAA000000,1,0,0,0,100,100,0,0,1,5,2,5,40,40,40,1',
    'Style: Year,Arial,62,&H00F5F1D7,&H00FFFFFF,&H00000000,&HAA000000,1,0,0,0,100,100,0,0,1,5,2,5,40,40,40,1',
    'Style: Number,Arial,46,&H001CFF8A,&H00FFFFFF,&H00000000,&HAA000000,1,0,0,0,100,100,0,0,1,4,2,5,40,40,40,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = [];

  scenes.forEach((scene, index) => {
    const start = Math.max(0, index === 0 ? 0 : scene.narrationStart || 0);
    const end = Math.min(targetDuration, index === scenes.length - 1 ? targetDuration : scenes[index + 1]?.narrationStart || scene.narrationEnd || start + 1);
    if (end <= start + 0.1) return;
    const text = `{\\fad(80,120)}${escapeAssText(wrapCaption(scene.text || '', 46))}`;
    events.push(`Dialogue: 0,${secondsToAssTime(start)},${secondsToAssTime(end)},Spoken,,0,0,0,,${text}`);
  });

  callouts.forEach((callout) => {
    const style = callout.kind === 'money' ? 'Money' : callout.kind === 'year' ? 'Year' : callout.kind === 'number' ? 'Number' : 'Callout';
    const y = Math.round(calloutY(callout, callouts) * HEIGHT / 100);
    const duration = callout.effectId === 'keyboard-typing' ? 2.8 : 2;
    const text = `{\\pos(${Math.round(WIDTH / 2)},${y})\\fad(90,170)\\t(0,220,\\fscx112\\fscy112)\\t(220,520,\\fscx100\\fscy100)}${escapeAssText(callout.text)}`;
    events.push(`Dialogue: 2,${secondsToAssTime(callout.start)},${secondsToAssTime(Math.min(targetDuration, callout.start + duration))},${style},,0,0,0,,${text}`);
  });

  const assPath = path.join(WORK_DIR, 'vitevid_captions.ass');
  await fs.writeFile(assPath, `${header.concat(events).join('\n')}\n`);
  return assPath;
}

function buildSoundEffects(callouts, scenes) {
  const effects = callouts.map((callout) => ({
    effectId: callout.effectId,
    start: callout.start,
    duration: SOUND_EFFECTS[callout.effectId]?.duration || 1,
    volume: SOUND_EFFECTS[callout.effectId]?.volume || 0.7,
  }));
  let lastTransitionStart = -999;
  scenes.forEach((scene, index) => {
    const start = scene.narrationStart || 0;
    if (index === 0 || start - lastTransitionStart < 10) return;
    lastTransitionStart = start;
    effects.push({
      effectId: index % 3 === 0 ? 'pop-up' : 'whoosh',
      start: Math.max(0, start - 0.08),
      duration: index % 3 === 0 ? SOUND_EFFECTS['pop-up'].duration : SOUND_EFFECTS.whoosh.duration,
      volume: 0.25,
    });
  });
  return effects.sort((left, right) => left.start - right.start);
}

function mixEffectsToFile(effects, targetDuration, outPath, label) {
  if (effects.length === 0) {
    runFfmpeg(['-y', '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${targetDuration}`, '-c:a', 'pcm_s16le', outPath], label);
    return outPath;
  }
  const args = ['-y', '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${targetDuration}`];
  effects.forEach((effect) => {
    args.push('-i', SOUND_EFFECTS[effect.effectId]?.file || SOUND_EFFECTS['pop-up'].file);
  });
  const filters = [`[0:a]atrim=duration=${targetDuration},asetpts=PTS-STARTPTS[base]`];
  effects.forEach((effect, index) => {
    const inputIndex = index + 1;
    const delay = Math.max(0, Math.round(effect.start * 1000));
    filters.push(`[${inputIndex}:a]atrim=duration=${effect.duration},asetpts=PTS-STARTPTS,volume=${effect.volume || 0.7},adelay=${delay}|${delay}[s${index}]`);
  });
  const inputs = ['[base]', ...effects.map((_, index) => `[s${index}]`)].join('');
  filters.push(`${inputs}amix=inputs=${effects.length + 1}:duration=first:dropout_transition=0[sfx]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[sfx]', '-c:a', 'pcm_s16le', outPath);
  runFfmpeg(args, label);
  return outPath;
}

function createSfxTrack(effects, targetDuration) {
  const outPath = path.join(WORK_DIR, 'sfx_mix.wav');
  const chunkSize = 34;
  if (effects.length <= chunkSize) {
    return mixEffectsToFile(effects, targetDuration, outPath, `mix ${effects.length} sound effects`);
  }

  const chunkPaths = [];
  for (let start = 0; start < effects.length; start += chunkSize) {
    const chunk = effects.slice(start, start + chunkSize);
    const chunkPath = path.join(WORK_DIR, `sfx_chunk_${String(chunkPaths.length + 1).padStart(2, '0')}.wav`);
    mixEffectsToFile(chunk, targetDuration, chunkPath, `mix sound-effect chunk ${chunkPaths.length + 1} (${chunk.length})`);
    chunkPaths.push(chunkPath);
  }

  const args = ['-y', '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${targetDuration}`];
  chunkPaths.forEach((chunkPath) => args.push('-i', chunkPath));
  const inputs = ['[0:a]', ...chunkPaths.map((_, index) => `[${index + 1}:a]`)].join('');
  args.push(
    '-filter_complex',
    `${inputs}amix=inputs=${chunkPaths.length + 1}:duration=first:dropout_transition=0[sfx]`,
    '-map',
    '[sfx]',
    '-c:a',
    'pcm_s16le',
    outPath,
  );
  runFfmpeg(args, `mix ${effects.length} sound effects from ${chunkPaths.length} chunks`);
  return outPath;
}

function sceneSegmentPath(index) {
  return path.join(SEGMENT_DIR, `segment_${String(index + 1).padStart(4, '0')}.mp4`);
}

function normalizedStillPath(index) {
  return path.join(STILL_DIR, `still_${String(index + 1).padStart(4, '0')}.png`);
}

function ensureNormalizedStill(scene, index) {
  const outPath = normalizedStillPath(index);
  if (fileExists(outPath)) return outPath;
  runFfmpeg([
    '-y',
    '-hide_banner',
    '-i', scene.imagePath,
    '-frames:v', '1',
    '-vf', `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1,format=rgba`,
    outPath,
  ], `normalize still frame ${index + 1}`);
  return outPath;
}

async function ensureNormalizedStillAsync(scene, index) {
  const outPath = normalizedStillPath(index);
  if (fileExists(outPath)) return outPath;
  try {
    await runFfmpegAsync([
      '-y',
      '-hide_banner',
      '-i', scene.imagePath,
      '-frames:v', '1',
      '-vf', `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1,format=rgba`,
      outPath,
    ], `normalize still frame ${index + 1}`);
  } catch (error) {
    decodeFallbackCount += 1;
    log(`Decode failed for scene ${index + 1}; creating a local no-blank fallback instead. ${error.message.split('\n')[0]}`);
    const fallback = await createTextFallbackImage(scene, index);
    scene.imagePath = fallback.path;
    scene.selectedRenderAsset = fallback.candidate;
    await runFfmpegAsync([
      '-y',
      '-hide_banner',
      '-i', scene.imagePath,
      '-frames:v', '1',
      '-vf', `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1,format=rgba`,
      outPath,
    ], `normalize local fallback still frame ${index + 1}`);
  }
  return outPath;
}

function segmentVideoFilter(duration, index) {
  const zoomDirection = index % 2 === 0
    ? "min(max(zoom,pzoom)+0.00055,1.045)"
    : "max(1.045-on*0.00045,1.0)";
  return [
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase`,
    `crop=${WIDTH}:${HEIGHT}`,
    'setsar=1',
    `zoompan=z='${zoomDirection}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${WIDTH}x${HEIGHT}:fps=${FPS}`,
    `trim=duration=${duration.toFixed(3)}`,
    'setpts=PTS-STARTPTS',
    'eq=contrast=1.18:saturation=0.66:brightness=-0.025',
    'curves=vintage',
    'noise=alls=7:allf=t+u',
    'vignette=PI/5',
    'format=yuv420p',
  ].join(',');
}

function renderSceneSegment(scene, index, scenes, targetDuration) {
  const outPath = sceneSegmentPath(index);
  const duration = sceneDuration(scenes, index, targetDuration);
  if (fileExists(outPath)) return outPath;
  const stillPath = ensureNormalizedStill(scene, index);
  runFfmpeg([
    '-y',
    '-hide_banner',
    '-loop', '1',
    '-framerate', String(FPS),
    '-t', duration.toFixed(3),
    '-i', stillPath,
    '-vf', segmentVideoFilter(duration, index),
    '-r', String(FPS),
    '-an',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    outPath,
  ], `render scene segment ${index + 1}/${scenes.length} (${duration.toFixed(2)}s)`);
  return outPath;
}

async function renderSceneSegmentAsync(scene, index, scenes, targetDuration) {
  const outPath = sceneSegmentPath(index);
  const duration = sceneDuration(scenes, index, targetDuration);
  if (fileExists(outPath)) return outPath;
  const stillPath = await ensureNormalizedStillAsync(scene, index);
  await runFfmpegAsync([
    '-y',
    '-hide_banner',
    '-loop', '1',
    '-framerate', String(FPS),
    '-t', duration.toFixed(3),
    '-i', stillPath,
    '-vf', segmentVideoFilter(duration, index),
    '-r', String(FPS),
    '-an',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    '-pix_fmt', 'yuv420p',
    outPath,
  ], `render scene segment ${index + 1}/${scenes.length} (${duration.toFixed(2)}s)`);
  return outPath;
}

async function renderSlideshowVideo(scenes, targetDuration) {
  await fs.mkdir(SEGMENT_DIR, { recursive: true });
  await fs.mkdir(STILL_DIR, { recursive: true });
  const segmentPaths = new Array(scenes.length);
  let cursor = 0;
  let completed = 0;

  async function worker(workerId) {
    while (cursor < scenes.length) {
      const index = cursor;
      cursor += 1;
      segmentPaths[index] = await renderSceneSegmentAsync(scenes[index], index, scenes, targetDuration);
      completed += 1;
      if (completed % 25 === 0 || completed === scenes.length) {
        log(`Rendered/reused ${completed}/${scenes.length} motion scene segments.`);
      }
    }
    log(`Segment worker ${workerId} finished.`);
  }

  await Promise.all(Array.from({ length: Math.min(SEGMENT_WORKERS, scenes.length) }, (_, index) => worker(index + 1)));

  const segmentConcatPath = path.join(WORK_DIR, 'segments.ffconcat');
  const lines = ['ffconcat version 1.0'];
  segmentPaths.forEach((segmentPath) => {
    lines.push(`file '${shellQuoteConcatPath(path.relative(WORK_DIR, segmentPath))}'`);
  });
  await fs.writeFile(segmentConcatPath, `${lines.join('\n')}\n`);

  const slideshowPath = path.join(WORK_DIR, 'vitevid_slideshow.mp4');
  runFfmpeg([
    '-y',
    '-hide_banner',
    '-f', 'concat',
    '-safe', '0',
    '-i', path.basename(segmentConcatPath),
    '-c', 'copy',
    '-movflags', '+faststart',
    slideshowPath,
  ], 'concatenate motion scene segments');
  const actual = parseFfmpegDuration(slideshowPath);
  log(`Verified slideshow duration ${actual.toFixed(2)}s before captions/audio.`);
  return slideshowPath;
}

function renderFinalFromSlideshow(slideshowPath, assPath, sfxPath, targetDuration) {
  const outputName = path.basename(OUTPUT_PATH);
  const localOutput = path.join(WORK_DIR, outputName);
  const subtitleFilter = `subtitles=${path.basename(assPath)}`;
  runFfmpeg([
    '-y',
    '-hide_banner',
    '-i', slideshowPath,
    '-i', AUDIO_PATH,
    '-i', sfxPath,
    '-filter_complex',
    `[0:v]${subtitleFilter},format=yuv420p[v];[1:a]volume=1.0[a0];[2:a]volume=1.0[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[a]`,
    '-map', '[v]',
    '-map', '[a]',
    '-t', String(targetDuration),
    '-r', String(FPS),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '19',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    localOutput,
  ], 'render final mp4');
  return localOutput;
}

function verifyDuration(filePath, expectedSeconds) {
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-i', filePath], { encoding: 'utf8' });
  const text = `${result.stdout || ''}\n${result.stderr || ''}`;
  const match = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`Could not verify ${filePath}`);
  const actual = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  log(`Verified output duration ${actual.toFixed(2)}s (target ${expectedSeconds.toFixed(2)}s).`);
  if (Math.abs(actual - expectedSeconds) > 1.5) throw new Error(`Duration mismatch: ${actual}s`);
  return actual;
}

async function ensureServer() {
  const response = await fetch(BASE_URL);
  if (!response.ok) throw new Error(`ViteVid server did not respond with OK: ${response.status}`);
}

async function main() {
  if (!existsSync(AUDIO_PATH)) throw new Error(`Audio file does not exist: ${AUDIO_PATH}`);
  if (!existsSync(STATE_PATH)) throw new Error(`Run state does not exist: ${STATE_PATH}`);
  await ensureServer();
  await fs.mkdir(WORK_DIR, { recursive: true });
  const state = JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));
  const scenes = (state.scenes || []).filter((scene) => Number.isFinite(scene.narrationStart) && Number.isFinite(scene.narrationEnd));
  if (scenes.length === 0) throw new Error('No voice-timed scenes found in run state.');
  const targetDuration = Number(state.durationSeconds || 0);
  if (!Number.isFinite(targetDuration) || targetDuration <= 0) throw new Error('Run state has no valid duration.');
  const callouts = generateCalloutsFromScenes(scenes);

  log(`Starting ViteVid web render for ${scenes.length} scenes, ${callouts.length} callouts, target ${round(targetDuration, 2)}s.`);
  const prepared = await prepareSceneMedia(scenes);
  const concatPath = await writeConcatFile(prepared.scenes, targetDuration);
  const assPath = await writeAssSubtitles(prepared.scenes, callouts, targetDuration);
  const effects = buildSoundEffects(callouts, prepared.scenes);
  const sfxPath = createSfxTrack(effects, targetDuration);
  log(`Scene concat reference written to ${concatPath}.`);
  const slideshowPath = await renderSlideshowVideo(prepared.scenes, targetDuration);
  const localOutput = renderFinalFromSlideshow(slideshowPath, assPath, sfxPath, targetDuration);
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.copyFile(localOutput, OUTPUT_PATH);
  const actualDuration = verifyDuration(OUTPUT_PATH, targetDuration);
  log(`Saved ViteVid render to ${OUTPUT_PATH}`);
  log(`Manifest: ${MANIFEST_PATH}`);
  log(`Summary: ${prepared.scenes.length} visual events, ${callouts.length} special captions, ${effects.length} SFX events, ${prepared.fallbackCount + decodeFallbackCount} local title-card fallbacks, duration ${round(actualDuration, 2)}s.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
