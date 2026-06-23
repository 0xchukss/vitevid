import { existsSync, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ffmpegPath = require('ffmpeg-static');

const AUDIO_PATH = process.argv[2] || 'C:\\Users\\Hp\\Downloads\\tts-audio (19).wav';
const STATE_PATH = process.argv[3] || path.join(os.homedir(), 'Downloads', 'ViteVid_tts-audio-19_run-state.json');
const OUTPUT_PATH = process.argv[4] || path.join(os.homedir(), 'Downloads', 'ViteVid_tts-audio-19_final.mp4');
const WORK_DIR = process.argv[5] || path.join(os.homedir(), 'Downloads', 'vitevid_ffmpeg_assets');
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 24;
const DURATION_SECONDS = 1703.48;

const SOUND_EFFECTS = {
  'clock-ticking': { file: path.resolve('public', 'sound-effects', 'clock-ticking.mp3'), duration: 2.2, volume: 0.45 },
  'keyboard-typing': { file: path.resolve('public', 'sound-effects', 'keyboard-typing.mp3'), duration: 2.8, volume: 0.7 },
  whoosh: { file: path.resolve('public', 'sound-effects', 'whoosh.mp3'), duration: 0.9, volume: 0.7 },
  'pop-up': { file: path.resolve('public', 'sound-effects', 'pop-up.mp3'), duration: 1.1, volume: 0.7 },
};
const VINTAGE_IMAGE_POOLS = {
  finance: ['Usingthe1947', 'Financin1935', 'Internat1941', 'MakeMine1948'],
  home: ['DayofTha1951', 'EatforHe1954', 'Internat1941', 'FromtheG1954'],
  hardship: ['TripDown1905', 'FromtheG1954', 'MakeMine1948', 'Townandt1950'],
  documents: ['Usingthe1947', 'Telegram1956', 'Financin1935', 'FromtheG1954'],
  work: ['FromtheG1954', 'MakeMine1948', 'HealthYo1953', 'Exercise1949'],
  default: ['TripDown1905', 'FromtheG1954', 'DayofTha1951', 'EatforHe1954', 'MakeMine1948', 'Usingthe1947'],
};

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
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

function shellQuoteConcatPath(value) {
  return String(value).replace(/\\/g, '/').replace(/'/g, "'\\''");
}

function runFfmpeg(args, label, cwd = WORK_DIR) {
  log(`ffmpeg: ${label}`);
  const result = spawnSync(ffmpegPath, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed:\n${result.stderr || result.stdout}`);
  }
  return result;
}

function extensionForContentType(contentType, fallback = '.jpg') {
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return '.jpg';
  return fallback;
}

async function downloadFile(url, destinationBase) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121 Safari/537.36',
        Accept: 'image/*,*/*',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    const destination = `${destinationBase}${extensionForContentType(contentType)}`;
    const file = createWriteStream(destination);
    await new Promise((resolve, reject) => {
      Readable.fromWeb(response.body).pipe(file);
      file.on('finish', resolve);
      file.on('error', reject);
    });
    return destination;
  } finally {
    clearTimeout(timeout);
  }
}

async function createFallbackImage(filePath) {
  runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=0x061008:s=${WIDTH}x${HEIGHT}:d=1`,
    '-frames:v', '1',
    filePath,
  ], 'create fallback image');
}

function archiveThumb(identifier) {
  return `https://archive.org/services/img/${identifier}`;
}

function visualUrlForScene(scene, index) {
  const text = `${scene.text || ''} ${scene.visualConcept || ''}`.toLowerCase();
  let pool = VINTAGE_IMAGE_POOLS.default;
  if (/\b(bank|money|cash|dollar|coin|budget|debt|bill|rent|saving|savings|credit|finance|deed|mortgage|ledger|income|percent|cost|price)\b/.test(text)) {
    pool = VINTAGE_IMAGE_POOLS.finance;
  } else if (/\b(home|house|family|mother|father|kitchen|food|cellar|garden|cleaning|clothes|table|meal|children)\b/.test(text)) {
    pool = VINTAGE_IMAGE_POOLS.home;
  } else if (/\b(depression|bread|poverty|unemployed|closed|scarcity|collapse|disaster|flood|storm|lost|hardship|crisis)\b/.test(text)) {
    pool = VINTAGE_IMAGE_POOLS.hardship;
  } else if (/\b(document|paper|newspaper|letter|record|deed|ledger|note|contract|law|congress|rule)\b/.test(text)) {
    pool = VINTAGE_IMAGE_POOLS.documents;
  } else if (/\b(work|job|worker|build|skill|method|strategy|learn|exercise|health|habit|effort)\b/.test(text)) {
    pool = VINTAGE_IMAGE_POOLS.work;
  }
  return archiveThumb(pool[index % pool.length]);
}

async function prepareImages(scenes) {
  await fs.mkdir(WORK_DIR, { recursive: true });
  const fallbackPath = path.join(WORK_DIR, 'fallback.jpg');
  if (!existsSync(fallbackPath)) await createFallbackImage(fallbackPath);
  const cache = new Map();
  for (let index = 0; index < scenes.length; index += 1) {
    const asset = scenes[index].selectedAsset || {};
    const url = visualUrlForScene(scenes[index], index) || asset.thumbnail || asset.downloadUrl;
    if (!url) {
      scenes[index].imagePath = fallbackPath;
      continue;
    }
    if (!cache.has(url)) {
      try {
        cache.set(url, await downloadFile(url, path.join(WORK_DIR, `asset_${cache.size}`)));
      } catch (error) {
        log(`Thumbnail failed, using fallback: ${url} (${error.message})`);
        cache.set(url, fallbackPath);
      }
    }
    scenes[index].imagePath = cache.get(url);
  }
  log(`Prepared ${cache.size} unique real visual assets for ${scenes.length} scenes.`);
  return scenes;
}

function sceneDuration(scenes, index, targetDuration) {
  const scene = scenes[index];
  const nextStart = scenes[index + 1]?.narrationStart;
  const visualStart = index === 0 ? 0 : scene.narrationStart || 0;
  const visualEnd = index === scenes.length - 1
    ? targetDuration
    : Math.max(scene.narrationEnd || visualStart + 0.5, Number.isFinite(nextStart) ? nextStart : scene.narrationEnd || visualStart + 0.5);
  return Math.max(0.1, visualEnd - visualStart);
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

function writeAssSubtitles(callouts) {
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${WIDTH}`,
    `PlayResY: ${HEIGHT}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Callout,Arial,54,&H00E1F8F1,&H00FFFFFF,&H00000000,&H99000000,1,0,0,0,100,100,0,0,1,4,2,5,40,40,40,1',
    'Style: Number,Arial,44,&H00E1F8F1,&H00FFFFFF,&H00000000,&H99000000,1,0,0,0,100,100,0,0,1,4,2,5,40,40,40,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = callouts.map((callout) => {
    const style = callout.effectId === 'keyboard-typing' ? 'Number' : 'Callout';
    const y = Math.round((callout.y || 72) * HEIGHT / 100);
    const duration = callout.effectId === 'keyboard-typing' ? 2.8 : 2;
    const text = `{\\pos(${Math.round(WIDTH / 2)},${y})\\fad(120,180)\\bord4\\shad2}${escapeAssText(callout.text)}`;
    return `Dialogue: 0,${secondsToAssTime(callout.start)},${secondsToAssTime(callout.start + duration)},${style},,0,0,0,,${text}`;
  });
  const assPath = path.join(WORK_DIR, 'callouts.ass');
  return fs.writeFile(assPath, `${header.concat(events).join('\n')}\n`).then(() => assPath);
}

function calloutY(callout, allCallouts) {
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
    if (index === 0 || start - lastTransitionStart < 18) return;
    lastTransitionStart = start;
    effects.push({
      effectId: 'whoosh',
      start: Math.max(0, start - 0.12),
      duration: SOUND_EFFECTS.whoosh.duration,
      volume: 0.34,
    });
  });
  return effects;
}

function createSfxTrack(effects, targetDuration) {
  const outPath = path.join(WORK_DIR, 'sfx_mix.wav');
  if (effects.length === 0) {
    runFfmpeg(['-y', '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${targetDuration}`, '-c:a', 'pcm_s16le', outPath], 'create empty sfx');
    return outPath;
  }
  const args = ['-y', '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${targetDuration}`];
  effects.forEach((effect) => {
    args.push('-i', SOUND_EFFECTS[effect.effectId]?.file || SOUND_EFFECTS['pop-up'].file);
  });
  const filters = ['[0:a]atrim=duration=' + targetDuration + ',asetpts=PTS-STARTPTS[base]'];
  effects.forEach((effect, index) => {
    const inputIndex = index + 1;
    const delay = Math.max(0, Math.round(effect.start * 1000));
    const volume = effect.volume || 0.7;
    filters.push(`[${inputIndex}:a]atrim=duration=${effect.duration},asetpts=PTS-STARTPTS,volume=${volume},adelay=${delay}|${delay}[s${index}]`);
  });
  const inputs = ['[base]', ...effects.map((_, index) => `[s${index}]`)].join('');
  filters.push(`${inputs}amix=inputs=${effects.length + 1}:duration=first:dropout_transition=0[sfx]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[sfx]', '-c:a', 'pcm_s16le', outPath);
  runFfmpeg(args, `mix ${effects.length} sound effects`);
  return outPath;
}

function renderFinal(concatPath, assPath, sfxPath, targetDuration) {
  const outputName = path.basename(OUTPUT_PATH);
  const localOutput = path.join(WORK_DIR, outputName);
  const subtitleFilter = `subtitles=${path.basename(assPath)}`;
  const videoFilter = `fps=${FPS},scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},setsar=1,eq=contrast=1.16:saturation=0.78:brightness=-0.03,${subtitleFilter}`;
  runFfmpeg([
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', path.basename(concatPath),
    '-i', AUDIO_PATH,
    '-i', sfxPath,
    '-filter_complex',
    `[0:v]${videoFilter}[v];[1:a]volume=1.0[a0];[2:a]volume=1.0[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=0[a]`,
    '-map', '[v]',
    '-map', '[a]',
    '-t', String(targetDuration),
    '-r', String(FPS),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
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
}

async function main() {
  const state = JSON.parse(await fs.readFile(STATE_PATH, 'utf8'));
  const scenes = (state.scenes || []).filter((scene) => scene.selectedAsset);
  if (scenes.length === 0) throw new Error('No matched scenes found in run state.');
  const targetDuration = Number(state.durationSeconds || DURATION_SECONDS);
  const callouts = (state.callouts || []).map((callout) => ({ ...callout, y: calloutY(callout, state.callouts || []) }));
  await prepareImages(scenes);
  const concatPath = await writeConcatFile(scenes, targetDuration);
  const assPath = await writeAssSubtitles(callouts);
  const sfxPath = createSfxTrack(buildSoundEffects(callouts, scenes), targetDuration);
  const localOutput = renderFinal(concatPath, assPath, sfxPath, targetDuration);
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.copyFile(localOutput, OUTPUT_PATH);
  verifyDuration(OUTPUT_PATH, targetDuration);
  log(`Saved fast ViteVid render to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
