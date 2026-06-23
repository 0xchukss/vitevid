import { NextRequest, NextResponse } from 'next/server';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import fs from 'fs-extra';
import { createServer } from 'http';
import os from 'os';
import path from 'path';
import { createReadStream } from 'fs';
import { spawn, spawnSync } from 'child_process';
import { Readable } from 'stream';
import ffmpegStatic from 'ffmpeg-static';
import { AutomatedVideoProps } from '@/remotion/automated-edit';
import { ResultItem } from '@/types';
import { canAutoUseMedia, withMediaRights } from '@/lib/mediaRights';
import { isVisuallyUnsafeForScene } from '@/lib/mediaSafety';

export const runtime = 'nodejs';
export const maxDuration = 300;

const ffmpegBinaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const fallbackFfmpegPath = path.join(process.cwd(), 'node_modules', 'ffmpeg-static', ffmpegBinaryName);
const resolvedFfmpegPath = ffmpegStatic && fs.existsSync(ffmpegStatic)
  ? ffmpegStatic
  : fallbackFfmpegPath;

function safeFilename(value: string) {
  return value.replace(/["\r\n]/g, '_');
}

function validateProject(project: AutomatedVideoProps) {
  if (!Array.isArray(project.clips) || project.clips.length === 0) {
    throw new Error('Select at least one clip before exporting.');
  }
  if (!Number.isFinite(project.width) || !Number.isFinite(project.height)) {
    throw new Error('Choose a valid canvas size.');
  }
  if (!Number.isFinite(project.durationInFrames) || project.durationInFrames < 1) {
    throw new Error('The Remotion timeline has no frames to render.');
  }
}

function hostnameFromSource(value?: string) {
  if (!value) return '';
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

function resultItemFromClip(clip: AutomatedVideoProps['clips'][number]): ResultItem {
  return {
    id: clip.id,
    source: hostnameFromSource(clip.sourcePageUrl) || 'Video Lab clip',
    title: clip.title || clip.id,
    type: clip.type,
    thumbnail: clip.poster || clip.src,
    downloadUrl: clip.src || clip.poster,
    url: clip.sourcePageUrl,
    rightsStatus: clip.rightsStatus,
    rightsLabel: clip.rightsLabel,
    rightsNote: clip.rightsNote,
    license: clip.license,
    licenseUrl: clip.licenseUrl,
    attribution: clip.attribution,
    sourcePageUrl: clip.sourcePageUrl,
    isCopyrightSafe: clip.isCopyrightSafe,
    needsRightsReview: clip.needsRightsReview,
  };
}

function contentTypeFor(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.mp3') return 'audio/mpeg';
  if (extension === '.wav') return 'audio/wav';
  if (extension === '.ogg') return 'audio/ogg';
  if (extension === '.m4a') return 'audio/mp4';
  if (extension === '.webm') return 'video/webm';
  if (extension === '.mp4') return 'video/mp4';
  if (extension === '.mov') return 'video/quicktime';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  if (extension === '.svg') return 'image/svg+xml';
  return 'application/octet-stream';
}

function startAssetServer(root: string) {
  return new Promise<{ origin: string; close: () => Promise<void> }>((resolve, reject) => {
    const server = createServer(async (request, response) => {
      const name = decodeURIComponent((request.url || '/').replace(/^\/+/, ''));
      const safeName = path.basename(name);
      const filePath = path.join(root, safeName);
      if (!safeName || !filePath.startsWith(root)) {
        response.writeHead(404).end();
        return;
      }
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat) {
        response.writeHead(404).end();
        return;
      }
      const contentType = contentTypeFor(filePath);
      const range = request.headers.range;
      if (range) {
        const match = range.match(/bytes=(\d*)-(\d*)/);
        const start = match?.[1] ? Number(match[1]) : 0;
        const end = match?.[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= stat.size) {
          response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }).end();
          return;
        }
        response.writeHead(206, {
          'Content-Type': contentType,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
        });
        if (request.method === 'HEAD') {
          response.end();
          return;
        }
        createReadStream(filePath, { start, end }).pipe(response);
        return;
      }
      response.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': String(stat.size),
        'Accept-Ranges': 'bytes',
      });
      if (request.method === 'HEAD') {
        response.end();
        return;
      }
      createReadStream(filePath).pipe(response);
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not start local render asset server.'));
        return;
      }
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((closeResolve) => server.close(() => closeResolve())),
      });
    });
  });
}

async function saveUploadedFile(entry: FormDataEntryValue | null, destinationBase: string, defaultExtension: string) {
  if (!entry || typeof entry === 'string') return null;
  const fileName = 'name' in entry && typeof entry.name === 'string' ? entry.name : '';
  const extension = path.extname(fileName).slice(0, 12) || defaultExtension;
  const destination = `${destinationBase}${extension}`;
  await fs.writeFile(destination, Buffer.from(await entry.arrayBuffer()));
  return path.basename(destination);
}

function extensionForContentType(contentType: string, fallback: string) {
  if (contentType.includes('video/mp4')) return '.mp4';
  if (contentType.includes('video/quicktime')) return '.mov';
  if (contentType.includes('video/webm')) return '.webm';
  if (contentType.includes('image/png')) return '.png';
  if (contentType.includes('image/webp')) return '.webp';
  if (contentType.includes('image/gif')) return '.gif';
  if (contentType.includes('image/jpeg') || contentType.includes('image/jpg')) return '.jpg';
  return fallback;
}

const FALLBACK_IMAGE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAGUlEQVR4nGNkYGD4z0AEYBxVSFUBAAWfAQoC8p0VAAAAAElFTkSuQmCC',
  'base64',
);
const REMOTE_ASSET_TIMEOUT_MS = 25000;
const MAX_REMOTE_VIDEO_BYTES = 35 * 1024 * 1024;
const MAX_REMOTE_IMAGE_BYTES = 12 * 1024 * 1024;
const MIN_REMOTE_IMAGE_BYTES = 4 * 1024;
const FAST_EXPORT_SEGMENT_WORKERS = 4;
const SFX_EXPORT_GAIN = 1.8;
const WINDOWS_ARIAL_FONT = 'C:/Windows/Fonts/arial.ttf';
const WINDOWS_ARIAL_BOLD_FONT = 'C:/Windows/Fonts/arialbd.ttf';
const WINDOWS_GEORGIA_BOLD_FONT = 'C:/Windows/Fonts/georgiab.ttf';

function drawtextFontFileOption(fontPath: string) {
  return `fontfile='${fontPath.replace('C:/', 'C\\:/')}'`;
}

function isListNumberText(text: string) {
  return /^\s*(?:#?\d+|number\s+\w+)\s*[\).:-]/i.test(text);
}

function drawtextFontOption(text: string) {
  if (process.platform === 'win32') {
    if (isListNumberText(text) && fs.existsSync(WINDOWS_GEORGIA_BOLD_FONT)) {
      return drawtextFontFileOption(WINDOWS_GEORGIA_BOLD_FONT);
    }
    if (fs.existsSync(WINDOWS_ARIAL_BOLD_FONT)) return drawtextFontFileOption(WINDOWS_ARIAL_BOLD_FONT);
    if (fs.existsSync(WINDOWS_ARIAL_FONT)) return drawtextFontFileOption(WINDOWS_ARIAL_FONT);
  }
  return isListNumberText(text) ? 'font=Georgia' : 'font=Arial';
}

type PreparedClipAsset = { file: string; type: string };
type PreparedSoundEffect = {
  effect: NonNullable<AutomatedVideoProps['soundEffects']>[number];
  file: string;
};

type PreparedMusicTrack = {
  track: NonNullable<AutomatedVideoProps['musicTracks']>[number];
  file: string;
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapSvgText(value: string, maxChars = 36) {
  const words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines: string[] = [];
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
  return lines.slice(0, 4);
}

function looksLikeImageBuffer(buffer: Buffer) {
  if (buffer.length < MIN_REMOTE_IMAGE_BYTES) return false;
  const header = buffer.subarray(0, 16);
  const ascii = header.toString('ascii');
  return (
    buffer[0] === 0xff && buffer[1] === 0xd8
  ) || (
    buffer[0] === 0x89 && ascii.includes('PNG')
  ) || (
    ascii.startsWith('GIF8')
  ) || (
    ascii.startsWith('RIFF') && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function looksLikeVideoBuffer(buffer: Buffer) {
  if (buffer.length < 1024) return false;
  const firstFour = buffer.subarray(0, 4).toString('ascii');
  const ftyp = buffer.subarray(4, 8).toString('ascii');
  return ftyp === 'ftyp'
    || firstFour === 'RIFF'
    || (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3);
}

function safeRenderDimension(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(240, Math.min(3840, Math.round(value)));
}

function safeRenderFps(value: number) {
  if (!Number.isFinite(value)) return 24;
  return Math.max(12, Math.min(60, Math.round(value)));
}

function runFfmpeg(args: string[], label: string, cwd?: string) {
  const binary = resolvedFfmpegPath;
  if (!binary) throw new Error('FFmpeg is not available for export.');
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, { cwd, windowsHide: true });
    let output = '';
    const appendOutput = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 2 * 1024 * 1024) output = output.slice(-2 * 1024 * 1024);
    };
    child.stdout.on('data', appendOutput);
    child.stderr.on('data', appendOutput);
    child.on('error', reject);
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed${code === null ? '' : ` with exit ${code}`}:\n${output}`));
    });
  });
}

function runFfmpegSync(args: string[], label: string, cwd?: string) {
  if (!resolvedFfmpegPath) return false;
  const result = spawnSync(resolvedFfmpegPath, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    console.warn(`${label} failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
    return false;
  }
  return true;
}

function escapeDrawtext(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/\r?\n/g, '\\n');
}

async function normalizeImageForRender(inputPath: string, destinationBase: string, width: number, height: number) {
  if (!resolvedFfmpegPath) return null;
  const outputPath = `${destinationBase}_render.png`;
  await fs.remove(outputPath).catch(() => undefined);
  const renderWidth = safeRenderDimension(width, 1280);
  const renderHeight = safeRenderDimension(height, 720);
  const result = spawnSync(resolvedFfmpegPath, [
    '-y',
    '-hide_banner',
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-vf',
    `scale=${renderWidth}:${renderHeight}:force_original_aspect_ratio=increase,crop=${renderWidth}:${renderHeight},setsar=1,format=rgba`,
    outputPath,
  ], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });
  const stat = await fs.stat(outputPath).catch(() => null);
  if (result.status === 0 && stat && stat.size > 1024) return path.basename(outputPath);
  console.warn(`Render image decode failed for ${path.basename(inputPath)}: ${result.stderr || result.stdout || `exit ${result.status}`}`);
  await fs.remove(outputPath).catch(() => undefined);
  return null;
}

async function saveFallbackImage(destinationBase: string, clip?: AutomatedVideoProps['clips'][number], width = 1280, height = 720) {
  if (!clip) {
    const destination = `${destinationBase}.png`;
    await fs.writeFile(destination, FALLBACK_IMAGE_PNG);
    return path.basename(destination);
  }
  const renderWidth = safeRenderDimension(width, 1280);
  const renderHeight = safeRenderDimension(height, 720);
  const destination = `${destinationBase}_fallback.png`;
  const safeSceneNumber = Number.isFinite(clip.sceneId) ? `scene ${clip.sceneId + 1}` : 'a scene';
  const created = runFfmpegSync([
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=0x071008:s=${renderWidth}x${renderHeight}:d=1`,
    '-frames:v',
    '1',
    '-vf',
    [
      'noise=alls=8:allf=t+u',
      'eq=contrast=1.08:saturation=0.78:brightness=-0.02',
      'vignette=PI/5',
      'format=rgba',
    ].join(','),
    destination,
  ], `create neutral emergency frame for ${safeSceneNumber}`);
  if (created) return path.basename(destination);

  await fs.writeFile(destination, FALLBACK_IMAGE_PNG);
  return path.basename(destination);
}

async function saveRemoteAsset(url: string, destinationBase: string, fallbackExtension: string) {
  if (!/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_ASSET_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121 Safari/537.36',
        Accept: fallbackExtension === '.mp4' ? 'video/*,*/*' : 'image/*,*/*',
        Referer: new URL(url).origin,
      },
    });
    if (!response.ok) {
      console.warn(`Remote render asset failed (${response.status}): ${url}`);
      return null;
    }
    const contentType = response.headers.get('content-type') || '';
    const contentLength = Number(response.headers.get('content-length') || 0);
    const maxBytes = fallbackExtension === '.mp4' ? MAX_REMOTE_VIDEO_BYTES : MAX_REMOTE_IMAGE_BYTES;
    if (fallbackExtension === '.mp4' && contentType && !/video|octet-stream/i.test(contentType)) {
      console.warn(`Remote render asset was not a video (${contentType}): ${url}`);
      return null;
    }
    if (fallbackExtension !== '.mp4' && contentType && !/image|octet-stream/i.test(contentType)) {
      console.warn(`Remote render asset was not an image (${contentType}): ${url}`);
      return null;
    }
    if (contentLength > maxBytes) {
      console.warn(`Remote render asset too large (${contentLength} bytes): ${url}`);
      return null;
    }
    const destination = `${destinationBase}${extensionForContentType(contentType, fallbackExtension)}`;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      console.warn(`Remote render asset exceeded size guard (${buffer.length} bytes): ${url}`);
      return null;
    }
    if (fallbackExtension !== '.mp4' && !looksLikeImageBuffer(buffer)) {
      console.warn(`Remote render asset did not decode as an image candidate: ${url}`);
      return null;
    }
    if (fallbackExtension === '.mp4' && !looksLikeVideoBuffer(buffer)) {
      console.warn(`Remote render asset did not decode as a video candidate: ${url}`);
      return null;
    }
    await fs.writeFile(destination, buffer);
    return path.basename(destination);
  } catch (error) {
    console.warn(`Remote render asset could not be fetched: ${url}`, error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function prepareClipAsset(
  clip: AutomatedVideoProps['clips'][number],
  formData: FormData,
  workingDir: string,
  index: number,
  remoteAssetCache: Map<string, { file: string; type: string } | null>,
  width: number,
  height: number,
) {
  const destinationBase = path.join(workingDir, `clip_${index}`);
  const uploaded = await saveUploadedFile(
    formData.get(`clipAsset_${clip.id}`),
    destinationBase,
    clip.type === 'video' ? '.mp4' : '.png',
  );
  if (uploaded) {
    if (clip.type === 'video') return { file: uploaded, type: clip.type };
    const normalized = await normalizeImageForRender(path.join(workingDir, uploaded), destinationBase, width, height);
    if (normalized) return { file: normalized, type: 'image' };
    return { file: await saveFallbackImage(destinationBase, clip, width, height), type: 'image' };
  }

  const rightsChecked = withMediaRights(resultItemFromClip(clip), {
    providerFiltered: clip.rightsStatus === 'open-license-filtered',
  });
  if (isVisuallyUnsafeForScene(rightsChecked, {
    sceneText: clip.text,
    query: clip.title,
    visualConcept: clip.title,
  })) {
    console.warn(`Using neutral emergency frame for clip ${clip.id}; asset failed ViteVid channel-safety filtering.`);
    return { file: await saveFallbackImage(destinationBase, clip, width, height), type: 'image' };
  }
  if (!canAutoUseMedia(rightsChecked)) {
    throw new Error(`Clip "${clip.title}" is missing reusable license metadata and cannot be exported automatically.`);
  }

  const candidates = Array.from(new Set([
    clip.src,
    clip.poster,
  ].filter((url): url is string => Boolean(url))));

  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    const candidate = candidates[candidateIndex];
    if (remoteAssetCache.has(candidate)) {
      const cached = remoteAssetCache.get(candidate);
      if (cached) return cached;
      continue;
    }
    const file = await saveRemoteAsset(
      candidate,
      `${destinationBase}_${candidateIndex}`,
      clip.type === 'video' && candidate === clip.src ? '.mp4' : '.jpg',
    );
    if (file) {
      const extension = path.extname(file).toLowerCase();
      if (!['.mp4', '.mov', '.webm'].includes(extension)) {
        const normalized = await normalizeImageForRender(path.join(workingDir, file), destinationBase, width, height);
        if (!normalized) {
          remoteAssetCache.set(candidate, null);
          continue;
        }
        const prepared = { file: normalized, type: 'image' };
        remoteAssetCache.set(candidate, prepared);
        return prepared;
      }
      const prepared = {
        file,
        type: ['.mp4', '.mov', '.webm'].includes(extension) ? clip.type : 'image',
      };
      remoteAssetCache.set(candidate, prepared);
      return prepared;
    }
    remoteAssetCache.set(candidate, null);
  }

  console.warn(`Using neutral emergency frame for clip ${clip.id}; all export asset candidates failed.`);
  return { file: await saveFallbackImage(destinationBase, clip, width, height), type: 'image' };
}

function secondsToAssTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const centiseconds = Math.floor((safe - Math.floor(safe)) * 100);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function escapeAssText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

function assColor(value: string | undefined, fallback: string, alpha = '00') {
  const color = /^#[0-9a-f]{6}$/i.test(value || '') ? value as string : fallback;
  const red = color.slice(1, 3);
  const green = color.slice(3, 5);
  const blue = color.slice(5, 7);
  return `&H${alpha}${blue}${green}${red}`;
}

function concatFilePath(value: string) {
  return value.replace(/\\/g, '/').replace(/'/g, "'\\''");
}

function ffmpegHexColor(value: string | undefined, fallback: string) {
  const color = /^#[0-9a-f]{6}$/i.test(value || '') ? value as string : fallback;
  return `0x${color.slice(1)}`;
}

function drawtextOverlayFilter(
  overlay: AutomatedVideoProps['textOverlays'][number],
  width: number,
  height: number,
  textFileName: string,
) {
  const x = Math.round(Math.min(100, Math.max(0, overlay.x)) * width / 100);
  const y = Math.round(Math.min(100, Math.max(0, overlay.y)) * height / 100);
  const size = Math.min(96, Math.max(14, Math.round(overlay.size)));
  const start = Math.max(0, overlay.start);
  const end = Math.max(start + 0.05, overlay.start + overlay.duration);
  const color = ffmpegHexColor(overlay.color, '#ffffff');
  const background = ffmpegHexColor(overlay.background, '#1d1510');
  return [
    `drawtext=${drawtextFontOption(overlay.text)}`,
    `textfile='${textFileName}'`,
    `fontcolor=${color}`,
    `fontsize=${size}`,
    'borderw=2',
    'bordercolor=0x000000@0.72',
    'box=1',
    `boxcolor=${background}@0.80`,
    `boxborderw=${Math.max(8, Math.round(size * 0.2))}`,
    `x=${x}-text_w/2`,
    `y=${y}-text_h/2`,
    `enable=between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})`,
  ].join(':');
}

async function writeDrawtextTextOverlays(project: AutomatedVideoProps, workingDir: string) {
  const overlays = project.textOverlays.filter((overlay) => overlay.text.trim() && overlay.duration > 0);
  if (overlays.length === 0) return null;
  const width = safeRenderDimension(project.width, 1280);
  const height = safeRenderDimension(project.height, 720);
  const textDir = path.join(workingDir, 'vitevid_text_overlay_files');
  await fs.ensureDir(textDir);
  const segments = await Promise.all(overlays.map(async (overlay, index) => {
    const textFileName = `vitevid_text_overlay_files/caption_${String(index).padStart(4, '0')}.txt`;
    await fs.writeFile(path.join(workingDir, textFileName), overlay.text, 'utf8');
    const input = index === 0 ? '[0:v]' : `[v${index - 1}]`;
    const output = index === overlays.length - 1 ? '[v]' : `[v${index}]`;
    return `${input}${drawtextOverlayFilter(overlay, width, height, textFileName)}${output}`;
  }));
  const filterPath = path.join(workingDir, 'vitevid_text_overlays.fffilter');
  await fs.writeFile(filterPath, `${segments.join(';')}\n`);
  return filterPath;
}

async function writeAssTextOverlays(project: AutomatedVideoProps, workingDir: string) {
  const overlays = project.textOverlays.filter((overlay) => overlay.text.trim() && overlay.duration > 0);
  if (overlays.length === 0) return null;
  const width = safeRenderDimension(project.width, 1280);
  const height = safeRenderDimension(project.height, 720);
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Overlay,Arial,44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H3310151d,1,0,0,0,100,100,0,0,3,8,0,5,24,24,24,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const events = overlays.map((overlay) => {
    const x = Math.round(Math.min(100, Math.max(0, overlay.x)) * width / 100);
    const y = Math.round(Math.min(100, Math.max(0, overlay.y)) * height / 100);
    const size = Math.min(96, Math.max(14, Math.round(overlay.size)));
    const start = secondsToAssTime(overlay.start);
    const end = secondsToAssTime(overlay.start + overlay.duration);
    const color = assColor(overlay.color, '#ffffff');
    const background = assColor(overlay.background, '#1d1510');
    const text = `{\\pos(${x},${y})\\fs${size}\\1c${color}&\\4c${background}&\\4a&H33&\\fad(80,140)\\t(0,220,\\fscx108\\fscy108)\\t(220,520,\\fscx100\\fscy100)}${escapeAssText(overlay.text)}`;
    return `Dialogue: 2,${start},${end},Overlay,,0,0,0,,${text}`;
  });
  const assPath = path.join(workingDir, 'vitevid_text_overlays.ass');
  await fs.writeFile(assPath, `${header.concat(events).join('\n')}\n`);
  return assPath;
}

async function makeStillForFastExport(
  clip: AutomatedVideoProps['clips'][number],
  localAsset: PreparedClipAsset,
  workingDir: string,
  index: number,
  width: number,
  height: number,
) {
  const sourcePath = path.join(workingDir, localAsset.file);
  const stillPath = path.join(workingDir, `fast_still_${String(index + 1).padStart(4, '0')}.png`);
  if (localAsset.type === 'video') {
    const ok = await runFfmpeg([
      '-y',
      '-hide_banner',
      '-ss',
      Math.max(0, clip.sourceStart || 0).toFixed(2),
      '-i',
      sourcePath,
      '-frames:v',
      '1',
      '-vf',
      `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,format=rgba`,
      stillPath,
    ], `extract still for clip ${clip.id}`).then(() => true).catch((error) => {
      console.warn(error);
      return false;
    });
    if (ok) return stillPath;
    const fallback = await saveFallbackImage(path.join(workingDir, `fast_still_${String(index + 1).padStart(4, '0')}`), clip, width, height);
    return path.join(workingDir, fallback);
  }

  const normalized = await normalizeImageForRender(sourcePath, path.join(workingDir, `fast_still_${String(index + 1).padStart(4, '0')}`), width, height);
  if (normalized) return path.join(workingDir, normalized);
  const fallback = await saveFallbackImage(path.join(workingDir, `fast_still_${String(index + 1).padStart(4, '0')}`), clip, width, height);
  return path.join(workingDir, fallback);
}

function segmentVideoFilter(
  duration: number,
  index: number,
  width: number,
  height: number,
  fps: number,
  historyVintage: boolean,
  trueCrimeDark: boolean,
) {
  const baseZoom = index % 2 === 0
    ? "min(max(zoom,pzoom)+0.00055,1.055)"
    : "max(1.055-on*0.00045,1.0)";
  const jumpFrame = Math.max(1, Math.round(4 * fps));
  const crimeJumpFrame = Math.max(1, Math.round(3.4 * fps));
  const zoomDirection = historyVintage && duration > 4
    ? `min((${baseZoom})+if(gte(on,${jumpFrame}),0.10,0),1.18)`
    : trueCrimeDark && duration > 3.6
      ? `min((${baseZoom})+if(gte(on,${crimeJumpFrame}),0.08,0),1.20)`
      : baseZoom;
  const colorFilter = historyVintage
    ? 'eq=contrast=1.18:saturation=0.62:brightness=-0.022'
    : trueCrimeDark
      ? 'eq=contrast=1.34:saturation=0.44:brightness=-0.062'
      : 'eq=contrast=1.16:saturation=0.72:brightness=-0.018';
  const filters = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    'setsar=1',
    `zoompan=z='${zoomDirection}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}`,
    `trim=duration=${duration.toFixed(3)}`,
    'setpts=PTS-STARTPTS',
    colorFilter,
    trueCrimeDark ? 'hue=s=0.55' : 'curves=vintage',
    historyVintage ? 'noise=alls=9:allf=t+u' : trueCrimeDark ? 'noise=alls=7:allf=t+u' : 'noise=alls=5:allf=t+u',
    `drawbox=x=${(index * 37) % Math.max(1, width)}:y=0:w=1:h=${height}:color=white@0.07:t=fill`,
    trueCrimeDark ? 'vignette=PI/3' : 'vignette=PI/5',
  ];
  filters.push('format=yuv420p');
  return [
    ...filters,
  ].join(',');
}

async function renderFastSegment(
  clip: AutomatedVideoProps['clips'][number],
  localAsset: PreparedClipAsset,
  workingDir: string,
  index: number,
  width: number,
  height: number,
  fps: number,
  historyVintage: boolean,
  trueCrimeDark: boolean,
) {
  const outPath = path.join(workingDir, `fast_segment_${String(index + 1).padStart(4, '0')}.mp4`);
  const stillPath = await makeStillForFastExport(clip, localAsset, workingDir, index, width, height);
  const duration = Math.max(0.1, clip.duration);
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-loop',
    '1',
    '-framerate',
    String(fps),
    '-t',
    duration.toFixed(3),
    '-i',
    stillPath,
    '-vf',
    segmentVideoFilter(duration, index, width, height, fps, historyVintage, trueCrimeDark),
    '-r',
    String(fps),
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    outPath,
  ], `render fast segment ${index + 1}`);
  return outPath;
}

async function renderFastSegments(
  project: AutomatedVideoProps,
  localClipFiles: Map<string, PreparedClipAsset>,
  workingDir: string,
  width: number,
  height: number,
  fps: number,
) {
  const segmentPaths = new Array<string>(project.clips.length);
  const historyVintage = project.stylePreset === 'history-vintage';
  const trueCrimeDark = project.stylePreset === 'true-crime-dark';
  let cursor = 0;
  let completed = 0;
  async function worker() {
    while (cursor < project.clips.length) {
      const index = cursor;
      cursor += 1;
      const clip = project.clips[index];
      const localAsset = localClipFiles.get(clip.id);
      if (!localAsset) throw new Error(`Clip "${clip.title}" could not be prepared for export.`);
      segmentPaths[index] = await renderFastSegment(clip, localAsset, workingDir, index, width, height, fps, historyVintage, trueCrimeDark);
      completed += 1;
      if (completed % 25 === 0 || completed === project.clips.length) {
        console.log(`[render-remotion] fast export rendered ${completed}/${project.clips.length} visual segments`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(FAST_EXPORT_SEGMENT_WORKERS, project.clips.length) }, () => worker()));
  return segmentPaths;
}

async function concatFastSegments(segmentPaths: string[], workingDir: string, outputPath: string) {
  const concatPath = path.join(workingDir, 'fast_segments.ffconcat');
  const lines = ['ffconcat version 1.0'];
  segmentPaths.forEach((segment) => {
    lines.push(`file '${concatFilePath(path.relative(workingDir, segment))}'`);
  });
  await fs.writeFile(concatPath, `${lines.join('\n')}\n`);
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatPath,
    '-c',
    'copy',
    outputPath,
  ], 'concat fast segments', workingDir);
}

async function burnDrawtextText(videoPath: string, filterPath: string | null, workingDir: string, outputPath: string) {
  if (!filterPath) {
    await fs.copy(videoPath, outputPath);
    return;
  }
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-i',
    videoPath,
    '-filter_complex_script',
    path.basename(filterPath),
    '-map',
    '[v]',
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    outputPath,
  ], 'burn captions into fast export', workingDir);
}

async function mixEffectChunk(
  effects: PreparedSoundEffect[],
  duration: number,
  workingDir: string,
  chunkIndex: number,
) {
  const outPath = path.join(workingDir, `fast_sfx_chunk_${chunkIndex}.wav`);
  const args = ['-y', '-hide_banner', '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${duration.toFixed(2)}`];
  effects.forEach(({ file }) => {
    args.push('-i', path.join(workingDir, file));
  });
  const filters = [`[0:a]atrim=duration=${duration.toFixed(2)},asetpts=PTS-STARTPTS[base]`];
  effects.forEach(({ effect }, index) => {
    const inputIndex = index + 1;
    const delay = Math.max(0, Math.round(effect.start * 1000));
    const effectDuration = Math.max(0.05, effect.duration || 1);
    const sourceStart = Math.max(0, effect.sourceStart || 0);
    const volume = Math.min(2.5, Math.max(0, effect.volume ?? 1) * SFX_EXPORT_GAIN);
    filters.push(
      `[${inputIndex}:a]atrim=start=${sourceStart.toFixed(2)}:duration=${effectDuration.toFixed(2)},asetpts=PTS-STARTPTS,volume=${volume.toFixed(2)},adelay=${delay}|${delay}[s${index}]`,
    );
  });
  const labels = ['[base]', ...effects.map((_, index) => `[s${index}]`)].join('');
  filters.push(`${labels}amix=inputs=${effects.length + 1}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[sfx]`);
  args.push('-filter_complex', filters.join(';'), '-map', '[sfx]', '-c:a', 'pcm_s16le', outPath);
  await runFfmpeg(args, `mix fast sound-effect chunk ${chunkIndex}`);
  return outPath;
}

async function mixFastAudio(
  videoPath: string,
  project: AutomatedVideoProps,
  backgroundAudioFile: string | null,
  musicFiles: PreparedMusicTrack[],
  effectFiles: PreparedSoundEffect[],
  workingDir: string,
  outputPath: string,
) {
  if (!backgroundAudioFile && musicFiles.length === 0 && effectFiles.length === 0) {
    await fs.copy(videoPath, outputPath);
    return;
  }

  const duration = Math.max(0.1, project.durationInFrames / safeRenderFps(project.fps));
  const effectChunks: string[] = [];
  for (let start = 0; start < effectFiles.length; start += 34) {
    effectChunks.push(await mixEffectChunk(effectFiles.slice(start, start + 34), duration, workingDir, effectChunks.length + 1));
  }

  const args = ['-y', '-hide_banner', '-i', videoPath, '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=stereo:d=${duration.toFixed(2)}`];
  if (backgroundAudioFile) args.push('-i', path.join(workingDir, backgroundAudioFile));
  musicFiles.forEach(({ track, file }) => {
    if (track.loop) args.push('-stream_loop', '-1');
    args.push('-i', path.join(workingDir, file));
  });
  effectChunks.forEach((chunk) => args.push('-i', chunk));
  const filters = [`[1:a]atrim=duration=${duration.toFixed(2)},asetpts=PTS-STARTPTS[base]`];
  const labels = ['[base]'];
  let inputIndex = 2;
  const voiceSidechainLabels: string[] = [];
  const hasMusic = musicFiles.length > 0;
  if (backgroundAudioFile && project.audioTrack) {
    const delay = Math.max(0, Math.round(project.audioTrack.start * 1000));
    const sourceStart = Math.max(0, project.audioTrack.sourceStart || 0);
    const audioDuration = Math.max(0.1, project.audioTrack.duration);
    const volume = Math.min(1, Math.max(0, project.audioTrack.volume ?? 1));
    const voiceOutput = hasMusic ? 'voicebase' : 'voice';
    filters.push(
      `[${inputIndex}:a]atrim=start=${sourceStart.toFixed(2)}:duration=${audioDuration.toFixed(2)},asetpts=PTS-STARTPTS,volume=${volume.toFixed(2)},adelay=${delay}|${delay},apad=pad_dur=${duration.toFixed(2)}[${voiceOutput}]`,
    );
    if (voiceOutput === 'voicebase') {
      const chainOutputs = musicFiles.map((_, index) => `[voicechain${index}]`).join('');
      filters.push(`[voicebase]asplit=${musicFiles.length + 1}[voice]${chainOutputs}`);
      musicFiles.forEach((_, index) => voiceSidechainLabels.push(`[voicechain${index}]`));
    }
    labels.push('[voice]');
    inputIndex += 1;
  }
  musicFiles.forEach(({ track }, index) => {
    const delay = Math.max(0, Math.round(track.start * 1000));
    const sourceStart = Math.max(0, track.sourceStart || 0);
    const musicDuration = Math.max(0.1, track.duration);
    const volume = Math.min(1, Math.max(0, track.volume ?? 0.08));
    const musicLabel = voiceSidechainLabels[index] ? `musicraw${index}` : `music${index}`;
    filters.push(
      `[${inputIndex + index}:a]atrim=start=${sourceStart.toFixed(2)}:duration=${musicDuration.toFixed(2)},asetpts=PTS-STARTPTS,volume=${volume.toFixed(3)},adelay=${delay}|${delay},apad=pad_dur=${duration.toFixed(2)}[${musicLabel}]`,
    );
    if (voiceSidechainLabels[index]) {
      filters.push(`[musicraw${index}]${voiceSidechainLabels[index]}sidechaincompress=threshold=0.02:ratio=12:attack=200:release=200[music${index}]`);
    }
    labels.push(`[music${index}]`);
  });
  inputIndex += musicFiles.length;
  effectChunks.forEach((_, index) => {
    filters.push(`[${inputIndex + index}:a]atrim=duration=${duration.toFixed(2)},asetpts=PTS-STARTPTS[sfx${index}]`);
    labels.push(`[sfx${index}]`);
  });
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[audio]`);
  args.push(
    '-filter_complex',
    filters.join(';'),
    '-map',
    '0:v',
    '-map',
    '[audio]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-shortest',
    '-movflags',
    '+faststart',
    outputPath,
  );
  await runFfmpeg(args, 'mix fast export audio');
}

async function renderFastFfmpegExport(
  project: AutomatedVideoProps,
  workingDir: string,
  localClipFiles: Map<string, PreparedClipAsset>,
  backgroundAudioFile: string | null,
  musicFiles: PreparedMusicTrack[],
  effectFiles: PreparedSoundEffect[],
  filename: string,
) {
  const width = safeRenderDimension(project.width, 1280);
  const height = safeRenderDimension(project.height, 720);
  const fps = safeRenderFps(project.fps);
  console.log(`[render-remotion] using fast FFmpeg export for ${project.clips.length} clips at ${width}x${height}`);
  const segments = await renderFastSegments(project, localClipFiles, workingDir, width, height, fps);
  const mergedPath = path.join(workingDir, 'fast_merged.mp4');
  await concatFastSegments(segments, workingDir, mergedPath);
  const overlayFilterPath = await writeDrawtextTextOverlays(project, workingDir);
  const captionedPath = path.join(workingDir, 'fast_captioned.mp4');
  await burnDrawtextText(mergedPath, overlayFilterPath, workingDir, captionedPath);
  const outputPath = path.join(workingDir, filename);
  await mixFastAudio(captionedPath, project, backgroundAudioFile, musicFiles, effectFiles, workingDir, outputPath);
  return outputPath;
}

export async function POST(request: NextRequest) {
  let workingDir = '';
  let assetServer: { origin: string; close: () => Promise<void> } | null = null;
  try {
    const formData = await request.formData();
    const projectValue = formData.get('project');
    if (!projectValue || typeof projectValue !== 'string') {
      return NextResponse.json({ error: 'A Remotion project is required.' }, { status: 400 });
    }

    const project = JSON.parse(projectValue) as AutomatedVideoProps;
    validateProject(project);

    workingDir = path.join(os.tmpdir(), 'video_lab_remotion', `project_${Date.now()}`);
    await fs.ensureDir(workingDir);
    const backgroundAudioFile = await saveUploadedFile(
      formData.get('backgroundAudio'),
      path.join(workingDir, 'background_audio'),
      '.mp3',
    );
    const backgroundMusicFile = await saveUploadedFile(
      formData.get('backgroundMusic'),
      path.join(workingDir, 'background_music'),
      '.mp3',
    );
    const projectMusicTracks = Array.isArray(project.musicTracks) && project.musicTracks.length > 0
      ? project.musicTracks
      : project.musicTrack ? [project.musicTrack] : [];
    const musicFiles: PreparedMusicTrack[] = [];
    for (let index = 0; index < projectMusicTracks.length; index += 1) {
      const musicFile = await saveUploadedFile(
        formData.get(`backgroundMusicTrack_${index}`) || (index === 0 ? formData.get('backgroundMusic') : null),
        path.join(workingDir, `background_music_${index}`),
        '.mp3',
      );
      if (musicFile) musicFiles.push({ track: projectMusicTracks[index], file: musicFile });
    }
    if (musicFiles.length === 0 && backgroundMusicFile && project.musicTrack) {
      musicFiles.push({ track: project.musicTrack, file: backgroundMusicFile });
    }
    const localClipFiles = new Map<string, { file: string; type: string }>();
    const remoteAssetCache = new Map<string, { file: string; type: string } | null>();
    for (const clip of project.clips) {
      const prepared = await prepareClipAsset(
        clip,
        formData,
        workingDir,
        localClipFiles.size,
        remoteAssetCache,
        project.width,
        project.height,
      );
      localClipFiles.set(clip.id, prepared);
    }
    const effectFiles: Array<{ effect: NonNullable<AutomatedVideoProps['soundEffects']>[number]; file: string }> = [];
    if (Array.isArray(project.soundEffects)) {
      for (let index = 0; index < project.soundEffects.length; index += 1) {
        const effect = project.soundEffects[index];
        const effectFile = await saveUploadedFile(
          formData.get(`timelineEffect_${index}`),
          path.join(workingDir, `effect_${index}`),
          '.mp3',
        );
        if (effectFile) effectFiles.push({ effect, file: effectFile });
      }
    }
    console.log(`[render-remotion] prepared ${effectFiles.length}/${project.soundEffects?.length || 0} timeline sound effects for export`);
    const filename = `Video_Lab_Remotion_${Date.now()}.mp4`;
    if (process.env.VITEVID_USE_REMOTION_EXPORT !== '1') {
      const outputPath = await renderFastFfmpegExport(
        project,
        workingDir,
        localClipFiles,
        backgroundAudioFile,
        musicFiles,
        effectFiles,
        filename,
      );
      const size = (await fs.stat(outputPath)).size;
      const fileStream = createReadStream(outputPath);
      fileStream.on('close', () => {
        fs.remove(workingDir).catch(() => undefined);
      });
      const responseStream = Readable.toWeb(fileStream) as ReadableStream<Uint8Array>;
      return new Response(responseStream, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${safeFilename(filename)}"`,
          'Content-Length': String(size),
        },
      });
    }

    if (backgroundAudioFile || musicFiles.length > 0 || effectFiles.length > 0 || localClipFiles.size > 0) {
      assetServer = await startAssetServer(workingDir);
    }
    if (assetServer) {
      const localAssetOrigin = assetServer.origin;
      project.clips = project.clips.map((clip) => {
        const localAsset = localClipFiles.get(clip.id);
        if (!localAsset) return clip;
        const src = `${localAssetOrigin}/${encodeURIComponent(localAsset.file)}`;
        return { ...clip, type: localAsset.type, src, poster: src };
      });
    }
    if (backgroundAudioFile && project.audioTrack && assetServer) {
      project.audioTrack.src = `${assetServer.origin}/${encodeURIComponent(backgroundAudioFile)}`;
    } else {
      project.audioTrack = null;
    }
    const assetOrigin = assetServer?.origin || '';
    project.musicTracks = assetOrigin
      ? musicFiles.map(({ track, file }) => ({ ...track, src: `${assetOrigin}/${encodeURIComponent(file)}` }))
      : [];
    project.musicTrack = null;
    project.soundEffects = assetOrigin
      ? effectFiles.map(({ effect, file }) => ({ ...effect, src: `${assetOrigin}/${encodeURIComponent(file)}` }))
      : [];
    const outputPath = path.join(workingDir, filename);
    const entryPoint = path.join(process.cwd(), 'src', 'remotion', 'index.ts');

    const serveUrl = await bundle({
      entryPoint,
      onProgress: () => undefined,
      webpackOverride: (config) => config,
    });
    const composition = await selectComposition({
      serveUrl,
      id: 'AutomatedVideo',
      inputProps: project as unknown as Record<string, unknown>,
    });

    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      x264Preset: 'veryfast',
      concurrency: Math.max(2, Math.min(8, os.cpus().length - 1)),
      outputLocation: outputPath,
      inputProps: project as unknown as Record<string, unknown>,
      chromiumOptions: {
        ignoreCertificateErrors: true,
      },
    });
    if (assetServer) {
      await assetServer.close().catch(() => undefined);
      assetServer = null;
    }

    const size = (await fs.stat(outputPath)).size;
    const fileStream = createReadStream(outputPath);
    fileStream.on('close', () => {
      fs.remove(workingDir).catch(() => undefined);
    });
    const responseStream = Readable.toWeb(fileStream) as ReadableStream<Uint8Array>;
    return new Response(responseStream, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${safeFilename(filename)}"`,
        'Content-Length': String(size),
      },
    });
  } catch (error) {
    console.error('Remotion render failed:', error);
    if (assetServer) await assetServer.close().catch(() => undefined);
    if (workingDir) await fs.remove(workingDir).catch(() => undefined);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Remotion video export failed.' },
      { status: 500 },
    );
  }
}
