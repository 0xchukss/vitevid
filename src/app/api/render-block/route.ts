import { NextRequest, NextResponse } from 'next/server';
import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
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

interface RenderScene {
  asset: ResultItem;
  duration: number;
  clipStart: number;
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

async function saveAsset(item: ResultItem, sceneDir: string, sceneIndex: number) {
  const rightsCheckedItem = withMediaRights(item);
  if (!canAutoUseMedia(rightsCheckedItem)) {
    throw new Error(`Asset "${item.title}" is missing reusable license metadata and cannot be exported automatically.`);
  }
  const extension = item.type === 'video' ? '.mp4' : '.jpg';
  const sourcePath = path.join(sceneDir, `source_${sceneIndex}${extension}`);
  const url = await resolveAssetUrl(rightsCheckedItem);

  if (url.startsWith('data:image')) {
    const base64Data = url.split(',')[1] || '';
    await fs.writeFile(sourcePath, base64Data, { encoding: 'base64' });
    return sourcePath;
  }

  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
  await fs.writeFile(sourcePath, Buffer.from(response.data));
  return sourcePath;
}

function encodeScene(
  scene: RenderScene,
  sourcePath: string,
  outputPath: string,
) {
  return new Promise<void>((resolve, reject) => {
    const command = ffmpeg(sourcePath);
    if (scene.asset.type === 'image') {
      command.inputOptions(['-loop 1']);
    } else if (scene.clipStart > 0) {
      command.seekInput(scene.clipStart);
    }

    command
      .duration(scene.duration)
      .videoFilters([
        'scale=720:1280:force_original_aspect_ratio=decrease',
        'pad=720:1280:(ow-iw)/2:(oh-ih)/2:black',
        'setsar=1',
        'fps=25',
        'format=yuv420p',
      ])
      .noAudio()
      .outputOptions([
        '-c:v libx264',
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

function mergeScenes(files: string[], listPath: string, outputPath: string) {
  return new Promise<void>(async (resolve, reject) => {
    const fileList = files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n');
    await fs.writeFile(listPath, fileList);

    ffmpeg()
      .input(listPath)
      .inputOptions(['-f concat', '-safe 0'])
      .noAudio()
      .outputOptions(['-c copy', '-movflags +faststart'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run();
  });
}

export async function POST(request: NextRequest) {
  let workingDir = '';
  try {
    const { scenes, blockIndex = 0, blockSeconds = 30 } = await request.json() as {
      scenes: RenderScene[];
      blockIndex?: number;
      blockSeconds?: number;
    };

    if (!Array.isArray(scenes) || scenes.length === 0) {
      return NextResponse.json({ error: 'At least one selected scene is required.' }, { status: 400 });
    }

    if (![30, 45].includes(blockSeconds)) {
      return NextResponse.json({ error: 'Blocks must be 30 or 45 seconds.' }, { status: 400 });
    }

    const totalDuration = scenes.reduce((total, scene) => total + scene.duration, 0);
    if (totalDuration > blockSeconds + 0.2) {
      return NextResponse.json({ error: 'This block exceeds the selected duration.' }, { status: 400 });
    }

    const isVercel = process.env.VERCEL === '1';
    const baseDir = isVercel ? '/tmp' : path.join(os.homedir(), 'Downloads');
    const tempRoot = path.join(baseDir, 'storyboard_temp');
    workingDir = path.join(tempRoot, `block_${Date.now()}_${blockIndex}`);
    await fs.ensureDir(workingDir);

    const encodedScenes: string[] = [];
    for (let index = 0; index < scenes.length; index += 1) {
      const sourcePath = await saveAsset(scenes[index].asset, workingDir, index);
      const encodedPath = path.join(workingDir, `scene_${String(index).padStart(2, '0')}.mp4`);
      await encodeScene(scenes[index], sourcePath, encodedPath);
      encodedScenes.push(encodedPath);
    }

    const baseFilename = `Storyboard_Block_${String(blockIndex + 1).padStart(3, '0')}_${blockSeconds}s_vertical`;
    let filename = `${baseFilename}.mp4`;
    let outputPath = path.join(isVercel ? workingDir : baseDir, filename);
    let copyNumber = 0;
    while (await fs.pathExists(outputPath)) {
      copyNumber += 1;
      filename = `${baseFilename} (${copyNumber}).mp4`;
      outputPath = path.join(isVercel ? workingDir : baseDir, filename);
    }
    await mergeScenes(encodedScenes, path.join(workingDir, 'concat.txt'), outputPath);

    if (isVercel) {
      const buffer = await fs.readFile(outputPath);
      await fs.remove(workingDir);
      return new Response(buffer, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${safeFilename(filename)}"`,
          'Content-Length': String(buffer.length),
        },
      });
    }

    await fs.remove(workingDir);
    return NextResponse.json({ status: 'success', filename, path: outputPath });
  } catch (error) {
    console.error('Block render failed:', error);
    if (workingDir) await fs.remove(workingDir).catch(() => undefined);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Block export failed.' },
      { status: 500 },
    );
  }
}
