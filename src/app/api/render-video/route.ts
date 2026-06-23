import { NextRequest, NextResponse } from 'next/server';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { createReadStream } from 'fs';
import { Readable } from 'stream';
import axios from 'axios';
import ffmpegStatic from 'ffmpeg-static';
import { ResultItem } from '@/types';
import { canAutoUseMedia, withMediaRights } from '@/lib/mediaRights';

export const runtime = 'nodejs';
export const maxDuration = 300;

const ffmpegBinaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const runtimeCwd = globalThis.process?.cwd?.() || '';
const fallbackFfmpegPath = `${runtimeCwd}/node_modules/ffmpeg-static/${ffmpegBinaryName}`;
const ffmpegPath = ffmpegStatic && fs.existsSync(ffmpegStatic)
  ? ffmpegStatic
  : fallbackFfmpegPath;
ffmpeg.setFfmpegPath(ffmpegPath);

type Transition = 'none' | 'fade' | 'slideleft' | 'slidedown';

interface RenderKeyframe {
  id: string;
  time: number;
  scale: number;
  positionX: number;
  positionY: number;
  rotation: number;
}

interface RenderClip {
  clipId: string;
  sceneId: number;
  asset: ResultItem;
  duration: number;
  sourceStart: number;
  scale?: number;
  positionX?: number;
  positionY?: number;
  rotation?: number;
  opacity?: number;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  sepia?: number;
  blur?: number;
  keyframes?: RenderKeyframe[];
  transition: Transition;
}

interface RenderProject {
  clips: RenderClip[];
  canvasColor?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  audio?: {
    duration: number;
    sourceStart: number;
    timelineStart: number;
    volume: number;
  } | null;
  textOverlays?: Array<{
    id: string;
    text: string;
    timelineStart: number;
    duration: number;
    fontSize?: number;
    color?: string;
    backgroundColor?: string;
    positionX?: number;
    positionY?: number;
  }>;
  soundEffects?: Array<{
    id: string;
    duration: number;
    sourceStart: number;
    timelineStart: number;
    volume: number;
  }>;
}

function safeFilename(value: string) {
  return value.replace(/["\r\n]/g, '_');
}

async function resolveAssetUrl(item: ResultItem) {
  if (item.source !== 'Internet Archive') return item.downloadUrl;

  const metadata = await axios.get(`https://archive.org/metadata/${item.id}`);
  const files = metadata.data.files || [];
  if (item.type === 'video') {
    const mediaFile = files.find((file: { name: string }) => (
      file.name.endsWith('.mp4') && !file.name.includes('ia.mp4')
    ));
    return mediaFile
      ? `https://archive.org/download/${item.id}/${mediaFile.name}`
      : item.downloadUrl;
  }

  const imageFile = files.find((file: { name: string }) => (
    /\.(jpg|jpeg|png)$/i.test(file.name)
  ));
  return imageFile
    ? `https://archive.org/download/${item.id}/${imageFile.name}`
    : item.downloadUrl;
}

async function saveAsset(item: ResultItem, workingDir: string, sceneIndex: number) {
  const rightsCheckedItem = withMediaRights(item);
  if (!canAutoUseMedia(rightsCheckedItem)) {
    throw new Error(`Asset "${item.title}" is missing reusable license metadata and cannot be exported automatically.`);
  }
  const extension = item.type === 'video' ? '.mp4' : '.jpg';
  const sourcePath = path.join(workingDir, `source_${sceneIndex}${extension}`);
  const url = await resolveAssetUrl(rightsCheckedItem);

  if (url.startsWith('data:image')) {
    const base64Data = url.split(',')[1] || '';
    await fs.writeFile(sourcePath, base64Data, { encoding: 'base64' });
    return sourcePath;
  }

  try {
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    await fs.writeFile(sourcePath, Buffer.from(response.data));
  } catch (error) {
    if (item.type !== 'image' || !item.thumbnail || item.thumbnail === url) throw error;
    const fallback = await axios.get(item.thumbnail, { responseType: 'arraybuffer', timeout: 30000 });
    await fs.writeFile(sourcePath, Buffer.from(fallback.data));
  }
  return sourcePath;
}

function safeCanvasDimension(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(3840, Math.max(240, Math.round((value as number) / 2) * 2));
}

function encodeClip(
  clip: RenderClip,
  sourcePath: string,
  outputPath: string,
  projectCanvasColor?: string,
  projectCanvasWidth?: number,
  projectCanvasHeight?: number,
) {
  return new Promise<void>((resolve, reject) => {
    const command = ffmpeg(sourcePath);
    const canvasWidth = safeCanvasDimension(projectCanvasWidth, 1280);
    const canvasHeight = safeCanvasDimension(projectCanvasHeight, 720);
    const scale = Math.min(2, Math.max(0.5, (clip.scale ?? 100) / 100)).toFixed(2);
    const horizontalShift = (Math.min(50, Math.max(-50, clip.positionX ?? 0)) * canvasWidth / 200).toFixed(0);
    const verticalShift = (Math.min(50, Math.max(-50, clip.positionY ?? 0)) * canvasHeight / 200).toFixed(0);
    const rotation = (Math.min(180, Math.max(-180, clip.rotation ?? 0)) * Math.PI / 180).toFixed(5);
    const opacity = Math.min(1, Math.max(0, (clip.opacity ?? 100) / 100));
    const brightness = ((Math.min(180, Math.max(20, clip.brightness ?? 100)) - 100) / 100).toFixed(2);
    const contrast = (Math.min(180, Math.max(20, clip.contrast ?? 100)) / 100).toFixed(2);
    const saturation = (Math.min(200, Math.max(0, clip.saturation ?? 100)) / 100).toFixed(2);
    const sepia = Math.min(1, Math.max(0, (clip.sepia ?? 0) / 100));
    const blur = Math.min(16, Math.max(0, clip.blur ?? 0));
    const canvasColor = safeColor(projectCanvasColor, '#000000').replace('#', '0x');
    if (clip.asset.type === 'image') {
      command.inputOptions(['-loop 1']);
    } else if (clip.sourceStart > 0) {
      command.seekInput(clip.sourceStart);
    }

    const videoFilters = [
      `scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=decrease`,
      `scale=trunc(iw*${scale}/2)*2:trunc(ih*${scale}/2)*2`,
      `pad=max(iw\\,${canvasWidth * 2}):max(ih\\,${canvasHeight * 2}):(ow-iw)/2:(oh-ih)/2:${canvasColor}`,
      `crop=${canvasWidth}:${canvasHeight}:max(0\\,min(iw-${canvasWidth}\\,(iw-${canvasWidth})/2-${horizontalShift})):max(0\\,min(ih-${canvasHeight}\\,(ih-${canvasHeight})/2-${verticalShift}))`,
      `rotate=${rotation}:ow=${canvasWidth}:oh=${canvasHeight}:c=${canvasColor}`,
      `eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`,
      'setsar=1',
      'fps=25',
    ];
    if (sepia > 0) {
      const rr = (1 + (0.393 - 1) * sepia).toFixed(3);
      const rg = (0.769 * sepia).toFixed(3);
      const rb = (0.189 * sepia).toFixed(3);
      const gr = (0.349 * sepia).toFixed(3);
      const gg = (1 + (0.686 - 1) * sepia).toFixed(3);
      const gb = (0.168 * sepia).toFixed(3);
      const br = (0.272 * sepia).toFixed(3);
      const bg = (0.534 * sepia).toFixed(3);
      const bb = (1 + (0.131 - 1) * sepia).toFixed(3);
      videoFilters.push(`colorchannelmixer=${rr}:${rg}:${rb}:0:${gr}:${gg}:${gb}:0:${br}:${bg}:${bb}`);
    }
    if (blur > 0) videoFilters.push(`gblur=sigma=${blur.toFixed(1)}`);
    if (opacity < 1) videoFilters.push(`colorchannelmixer=rr=${opacity.toFixed(2)}:gg=${opacity.toFixed(2)}:bb=${opacity.toFixed(2)}`);
    videoFilters.push('format=yuv420p');

    command
      .duration(clip.duration)
      .videoFilters(videoFilters)
      .noAudio()
      .outputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-preset veryfast',
        '-crf 22',
        '-movflags +faststart',
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

function expandKeyframedClips(clips: RenderClip[]) {
  return clips.flatMap((clip) => {
    const keyframes = (clip.keyframes || [])
      .filter((keyframe) => keyframe.time >= 0 && keyframe.time <= clip.duration)
      .sort((left, right) => left.time - right.time);
    if (keyframes.length === 0) return [clip];

    const base = {
      scale: clip.scale ?? 100,
      positionX: clip.positionX ?? 0,
      positionY: clip.positionY ?? 0,
      rotation: clip.rotation ?? 0,
      time: 0,
    };
    const transformAtTime = (time: number) => {
      const exact = keyframes.find((keyframe) => Math.abs(keyframe.time - time) < 0.01);
      if (exact) return exact;
      const target = keyframes.find((keyframe) => keyframe.time >= time);
      if (!target) return keyframes[keyframes.length - 1];
      const previous = [...keyframes].reverse().find((keyframe) => keyframe.time < time) || base;
      const distance = Math.max(0.01, target.time - previous.time);
      const progress = Math.min(1, Math.max(0, (time - previous.time) / distance));
      return {
        scale: previous.scale + (target.scale - previous.scale) * progress,
        positionX: previous.positionX + (target.positionX - previous.positionX) * progress,
        positionY: previous.positionY + (target.positionY - previous.positionY) * progress,
        rotation: previous.rotation + (target.rotation - previous.rotation) * progress,
      };
    };
    const animatedUntil = keyframes[keyframes.length - 1].time;
    const samples = Array.from(
      { length: Math.ceil(animatedUntil / 0.25) },
      (_, index) => Math.min(animatedUntil, (index + 1) * 0.25),
    );
    const boundaries = Array.from(new Set([0, ...samples, animatedUntil, clip.duration]))
      .sort((left, right) => left - right);
    return boundaries.slice(0, -1).map((start, index) => {
      const applied = transformAtTime(start);
      return {
        ...clip,
        clipId: `${clip.clipId}-keyframe-${index}`,
        duration: boundaries[index + 1] - start,
        sourceStart: clip.asset.type === 'video' ? clip.sourceStart + start : clip.sourceStart,
        scale: applied.scale,
        positionX: applied.positionX,
        positionY: applied.positionY,
        rotation: applied.rotation,
        keyframes: [],
        transition: index === 0 ? clip.transition : 'none' as Transition,
      };
    }).filter((segment) => segment.duration >= 0.05);
  });
}

function transitionDuration(clip: RenderClip, previousClip: RenderClip) {
  if (clip.transition === 'none') return 0;
  return Math.min(0.45, clip.duration / 3, previousClip.duration / 3);
}

function mergeVideo(clips: RenderClip[], files: string[], outputPath: string) {
  return new Promise<number>((resolve, reject) => {
    if (files.length === 1) {
      fs.copy(files[0], outputPath)
        .then(() => resolve(clips[0].duration))
        .catch(reject);
      return;
    }

    const command = ffmpeg();
    files.forEach((file) => command.input(file));
    const filters: string[] = files.map((_, index) => `[${index}:v]settb=AVTB[base${index}]`);
    let latestLabel = '[base0]';
    let timelineDuration = clips[0].duration;

    for (let index = 1; index < clips.length; index += 1) {
      const nextLabel = `v${index}`;
      if (clips[index].transition === 'none') {
        filters.push(`${latestLabel}[base${index}]concat=n=2:v=1:a=0[${nextLabel}]`);
        latestLabel = `[${nextLabel}]`;
        timelineDuration += clips[index].duration;
        continue;
      }

      const overlap = transitionDuration(clips[index], clips[index - 1]);
      const offset = timelineDuration - overlap;
      filters.push(
        `${latestLabel}[base${index}]xfade=transition=${clips[index].transition}:duration=${overlap.toFixed(3)}:offset=${offset.toFixed(3)}[${nextLabel}]`,
      );
      latestLabel = `[${nextLabel}]`;
      timelineDuration += clips[index].duration - overlap;
    }

    command
      .complexFilter(filters)
      .noAudio()
      .outputOptions([
        `-map ${latestLabel}`,
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-preset veryfast',
        '-crf 22',
        '-movflags +faststart',
      ])
      .output(outputPath)
      .on('end', () => resolve(timelineDuration))
      .on('error', reject)
      .run();
  });
}

function escapeDrawText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/\r?\n/g, '\\n');
}

function safeColor(value: string | undefined, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value as string : fallback;
}

function addTextOverlays(
  videoPath: string,
  outputPath: string,
  overlays: NonNullable<RenderProject['textOverlays']>,
) {
  if (overlays.length === 0) return fs.copy(videoPath, outputPath);

  return new Promise<void>((resolve, reject) => {
    const localFont = process.platform === 'win32'
      ? 'C\\:/Windows/Fonts/arial.ttf'
      : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    const fontOption = fs.existsSync(localFont.replace('C\\:', 'C:'))
      ? `fontfile='${localFont}':`
      : '';
    const filters = overlays
      .filter((overlay) => overlay.text.trim() && overlay.duration > 0)
      .map((overlay) => {
        const start = Math.max(0, overlay.timelineStart).toFixed(2);
        const end = Math.max(0, overlay.timelineStart + overlay.duration).toFixed(2);
        const fontSize = Math.min(96, Math.max(16, overlay.fontSize ?? 44));
        const color = safeColor(overlay.color, '#ffffff');
        const background = safeColor(overlay.backgroundColor, '#000000');
        const positionX = Math.min(100, Math.max(0, overlay.positionX ?? 50)) / 100;
        const positionY = Math.min(100, Math.max(0, overlay.positionY ?? 88)) / 100;
        return `drawtext=${fontOption}text='${escapeDrawText(overlay.text)}':fontcolor=${color}:fontsize=${fontSize}:borderw=2:bordercolor=black:box=1:boxcolor=${background}@0.72:boxborderw=10:x=w*${positionX.toFixed(2)}-text_w/2:y=h*${positionY.toFixed(2)}-text_h/2:enable='between(t\\,${start}\\,${end})'`;
      });

    if (filters.length === 0) {
      fs.copy(videoPath, outputPath).then(resolve).catch(reject);
      return;
    }

    ffmpeg(videoPath)
      .videoFilters(filters)
      .noAudio()
      .outputOptions([
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-preset veryfast',
        '-crf 22',
        '-movflags +faststart',
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

async function saveAudio(entry: FormDataEntryValue | null, destination: string) {
  if (!entry || typeof entry === 'string') return false;
  await fs.writeFile(destination, Buffer.from(await entry.arrayBuffer()));
  return true;
}

function mixAudio(
  videoPath: string,
  outputPath: string,
  timelineDuration: number,
  backgroundPath: string | null,
  audioSettings: RenderProject['audio'],
  soundEffects: Array<{ path: string; start: number; duration?: number; sourceStart?: number; volume?: number }>,
) {
  return new Promise<void>((resolve, reject) => {
    if (!backgroundPath && soundEffects.length === 0) {
      fs.copy(videoPath, outputPath).then(resolve).catch(reject);
      return;
    }

    const command = ffmpeg(videoPath);
    const filters: string[] = [`anullsrc=r=44100:cl=stereo:d=${timelineDuration.toFixed(2)}[base]`];
    const labels = ['[base]'];
    let inputIndex = 1;

    if (backgroundPath && audioSettings) {
      command.input(backgroundPath);
      const delay = Math.round(Math.max(0, audioSettings.timelineStart) * 1000);
      const sourceStart = Math.max(0, audioSettings.sourceStart);
      const duration = Math.max(0.5, audioSettings.duration);
      const volume = Math.min(1, Math.max(0, audioSettings.volume));
      filters.push(
        `[${inputIndex}:a]atrim=start=${sourceStart.toFixed(2)}:duration=${duration.toFixed(2)},asetpts=PTS-STARTPTS,volume=${volume.toFixed(2)},adelay=${delay}:all=1,apad=pad_dur=${timelineDuration.toFixed(2)}[music]`,
      );
      labels.push('[music]');
      inputIndex += 1;
    }

    soundEffects.forEach((effect, index) => {
      command.input(effect.path);
      const delay = Math.round(effect.start * 1000);
      const label = `effect${index}`;
      const trim = effect.duration
        ? `atrim=start=${Math.max(0, effect.sourceStart || 0).toFixed(2)}:duration=${effect.duration.toFixed(2)},asetpts=PTS-STARTPTS,`
        : '';
      const volume = `volume=${Math.min(1, Math.max(0, effect.volume ?? 1)).toFixed(2)},`;
      filters.push(`[${inputIndex}:a]${trim}${volume}adelay=${delay}:all=1[${label}]`);
      labels.push(`[${label}]`);
      inputIndex += 1;
    });

    filters.push(
      `${labels.join('')}amix=inputs=${labels.length}:duration=first:dropout_transition=0[audio]`,
    );
    command
      .complexFilter(filters)
      .duration(timelineDuration)
      .outputOptions([
        '-map 0:v',
        '-map [audio]',
        '-c:v copy',
        '-c:a aac',
        '-movflags +faststart',
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

export async function POST(request: NextRequest) {
  let workingDir = '';
  try {
    const formData = await request.formData();
    const projectValue = formData.get('project');
    if (!projectValue || typeof projectValue !== 'string') {
      return NextResponse.json({ error: 'A video project is required.' }, { status: 400 });
    }

    const project = JSON.parse(projectValue) as RenderProject;
    if (!Array.isArray(project.clips) || project.clips.length === 0) {
      return NextResponse.json({ error: 'Select at least one clip before exporting.' }, { status: 400 });
    }

    const invalidClip = project.clips.find((clip) => (
      !Number.isFinite(clip.duration) || clip.duration < 0.5 || clip.duration > 30
    ));
    if (invalidClip) {
      return NextResponse.json({ error: 'Each clip duration must be between 0.5 and 30 seconds.' }, { status: 400 });
    }

    workingDir = path.join(os.tmpdir(), 'video_lab_temp', `project_${Date.now()}`);
    await fs.ensureDir(workingDir);

    const renderClips = expandKeyframedClips(project.clips);
    const encodedClips: string[] = [];
    const downloadedAssets = new Map<string, string>();
    for (let index = 0; index < renderClips.length; index += 1) {
      const clip = renderClips[index];
      const assetKey = `${clip.asset.source}:${clip.asset.id}:${clip.asset.downloadUrl}`;
      let sourcePath = downloadedAssets.get(assetKey);
      if (!sourcePath) {
        sourcePath = await saveAsset(clip.asset, workingDir, downloadedAssets.size);
        downloadedAssets.set(assetKey, sourcePath);
      }
      const encodedPath = path.join(workingDir, `clip_${index}.mp4`);
      await encodeClip(
        clip,
        sourcePath,
        encodedPath,
        project.canvasColor,
        project.canvasWidth,
        project.canvasHeight,
      );
      encodedClips.push(encodedPath);
    }

    const mergedPath = path.join(workingDir, 'merged_video.mp4');
    const timelineDuration = await mergeVideo(renderClips, encodedClips, mergedPath);
    const textVideoPath = path.join(workingDir, 'text_video.mp4');
    await addTextOverlays(mergedPath, textVideoPath, project.textOverlays || []);

    const backgroundPath = path.join(workingDir, 'background_audio');
    const hasBackground = await saveAudio(formData.get('backgroundAudio'), backgroundPath);
    const soundEffects: Array<{
      path: string;
      start: number;
      duration?: number;
      sourceStart?: number;
      volume?: number;
    }> = [];
    for (let index = 0; index < (project.soundEffects || []).length; index += 1) {
      const effect = project.soundEffects![index];
      const soundPath = path.join(workingDir, `effect_${index}`);
      if (await saveAudio(formData.get(`timelineEffect_${effect.id}`), soundPath)) {
        soundEffects.push({
          path: soundPath,
          start: effect.timelineStart,
          duration: effect.duration,
          sourceStart: effect.sourceStart,
          volume: effect.volume,
        });
      }
    }

    const baseFilename = `Video_Lab_Project_${Date.now()}`;
    const filename = `${baseFilename}.mp4`;
    const outputPath = path.join(workingDir, filename);
    await mixAudio(
      textVideoPath,
      outputPath,
      timelineDuration,
      hasBackground && project.audio ? backgroundPath : null,
      project.audio || null,
      soundEffects,
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
  } catch (error) {
    console.error('Video Lab render failed:', error);
    if (workingDir) await fs.remove(workingDir).catch(() => undefined);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Full video export failed.' },
      { status: 500 },
    );
  }
}
