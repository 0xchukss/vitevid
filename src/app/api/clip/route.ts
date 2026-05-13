import { NextRequest, NextResponse } from 'next/server';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs-extra';
import axios from 'axios';
import os from 'os';

// Ensure absolute path for FFmpeg on Windows
const ffmpegStatic = require('ffmpeg-static');
const ffmpegBinaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const runtimeCwd = globalThis.process?.cwd?.() || '';
const fallbackFfmpegPath = `${runtimeCwd}/node_modules/ffmpeg-static/${ffmpegBinaryName}`;
const ffmpegPath = ffmpegStatic && fs.existsSync(ffmpegStatic)
  ? ffmpegStatic
  : fallbackFfmpegPath;
ffmpeg.setFfmpegPath(ffmpegPath);

function contentDispositionFilename(filename: string) {
  return filename.replace(/["\r\n]/g, '_');
}

export async function POST(request: NextRequest) {
  try {
    const { item, start, end, customName } = await request.json();
    
    if (!item || start === undefined || end === undefined) {
      return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    // Detect if running on Vercel/Serverless
    const isVercel = process.env.VERCEL === '1';
    // Use system Downloads folder on local PC, /tmp on Vercel
    const baseDir = isVercel ? '/tmp' : path.join(os.homedir(), 'Downloads');
    
    const downloadDir = baseDir;
    const tempDir = path.join(baseDir, 'temp');
    await fs.ensureDir(downloadDir);
    await fs.ensureDir(tempDir);

    const duration = end - start;
    if (duration <= 0) {
      return NextResponse.json({ error: 'End time must be after start time' }, { status: 400 });
    }
    const cleanName = item.title.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 30);
    const baseClipFilename = customName || `clip_${Math.floor(start)}s_${Math.floor(end)}s_${cleanName}`;
    
    let counter = 0;
    let clipFilename = `${baseClipFilename}.mp4`;
    let outputPath = path.join(isVercel ? tempDir : downloadDir, clipFilename);

    // Prevent overwriting existing files by appending a counter
    while (await fs.pathExists(outputPath)) {
      counter++;
      clipFilename = `${baseClipFilename} (${counter}).mp4`;
      outputPath = path.join(isVercel ? tempDir : downloadDir, clipFilename);
    }

    // We need the direct video URL. 
    // If it's an IA item, we might need to find the MP4 again.
    let videoUrl = item.downloadUrl;
    if (item.source === 'Internet Archive' && !videoUrl.endsWith('.mp4')) {
      const metaUrl = `https://archive.org/metadata/${item.id}`;
      const metaResponse = await axios.get(metaUrl);
      const files = metaResponse.data.files || [];
      const mp4File = files.find((f: any) => f.name.endsWith('.mp4') && !f.name.includes('ia.mp4'));
      if (mp4File) {
        videoUrl = `https://archive.org/download/${item.id}/${mp4File.name}`;
      }
    }

    console.log(`Clipping from ${videoUrl} starting at ${start} for ${duration}s -> ${outputPath}`);

    await new Promise((resolve, reject) => {
      ffmpeg(videoUrl)
        .setStartTime(start)
        .setDuration(duration)
        .output(outputPath)
        .on('end', () => {
          console.log('Clipping finished');
          resolve(true);
        })
        .on('error', (err) => {
          console.error('FFmpeg error:', err);
          reject(err);
        })
        .run();
    });

    if (isVercel) {
      const clipBuffer = await fs.readFile(outputPath);
      await fs.remove(outputPath);

      return new Response(clipBuffer, {
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${contentDispositionFilename(clipFilename)}"`,
          'Content-Length': String(clipBuffer.length),
        },
      });
    }

    // Save metadata for the clip - read just before writing to minimize race window
    // (Still not perfect without a lock but better than nothing for local app)
    const metadataPath = path.join(downloadDir, 'metadata.json');
    let metadata = [];
    if (await fs.pathExists(metadataPath)) {
      try {
        metadata = await fs.readJson(metadataPath);
      } catch (e) {
        console.error('Failed to read metadata, starting fresh');
      }
    }
    
    metadata.push({
      ...item,
      id: `${item.id}_clip_${start}_${end}_${Date.now()}`,
      title: `${item.title} (Clip ${start}s-${end}s)`,
      localPath: outputPath,
      type: 'video-clip',
      start,
      end,
      downloadedAt: new Date().toISOString(),
    });
    await fs.writeJson(metadataPath, metadata, { spaces: 2 });

    return NextResponse.json({ status: 'success', path: outputPath, filename: clipFilename });
  } catch (error: any) {
    console.error('Clipping failed:', error);
    return NextResponse.json({ 
      error: error.message || 'Clipping failed',
      path: ffmpegPath 
    }, { status: 500 });
  }
}
