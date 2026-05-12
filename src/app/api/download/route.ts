import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

export async function POST(request: NextRequest) {
  try {
    const { items } = await request.json(); // Array of items to download

    if (!items || !Array.isArray(items)) {
      return NextResponse.json({ error: 'Items array is required' }, { status: 400 });
    }

    // Detect if running on Vercel/Serverless
    const isVercel = process.env.VERCEL === '1';
    // Use system Downloads folder on local PC, /tmp on Vercel
    const baseDir = isVercel ? '/tmp' : path.join(os.homedir(), 'Downloads');
    
    const downloadDir = baseDir;
    await fs.ensureDir(downloadDir);

    const results = [];
    for (const item of items) {
      try {
        let downloadUrl = item.downloadUrl;

        // Special handling for Internet Archive to find the actual media file
        if (item.source === 'Internet Archive') {
          const metaUrl = `https://archive.org/metadata/${item.id}`;
          const metaResponse = await axios.get(metaUrl);
          const files = metaResponse.data.files || [];
          
          if (item.type === 'video') {
            const mp4File = files.find((f: any) => f.name.endsWith('.mp4') && !f.name.includes('ia.mp4'));
            if (mp4File) {
              downloadUrl = `https://archive.org/download/${item.id}/${mp4File.name}`;
            }
          } else {
            const jpgFile = files.find((f: any) => f.name.endsWith('.jpg') || f.name.endsWith('.png'));
            if (jpgFile) {
              downloadUrl = `https://archive.org/download/${item.id}/${jpgFile.name}`;
            }
          }
        }

        const extension = item.type === 'video' ? '.mp4' : '.jpg';
        const cleanBase = item.title
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '_')
          .substring(0, 50);
        
        const baseFilename = `${item.year ? item.year + '_' : ''}${cleanBase}`;
        
        let counter = 0;
        let finalFilename = `${baseFilename}${extension}`;
        let filePath = path.join(downloadDir, finalFilename);

        // Prevent overwriting existing files by appending a counter
        while (await fs.pathExists(filePath)) {
          counter++;
          finalFilename = `${baseFilename} (${counter})${extension}`;
          filePath = path.join(downloadDir, finalFilename);
        }

        if (downloadUrl.startsWith('data:image')) {
          const base64Data = downloadUrl.split(';base64,').pop();
          await fs.writeFile(filePath, base64Data || '', { encoding: 'base64' });
        } else {
          const response = await axios({
            url: downloadUrl,
            method: 'GET',
            responseType: 'stream',
          });

          const writer = fs.createWriteStream(filePath);
          response.data.pipe(writer);

          await new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(true));
            writer.on('error', reject);
          });
        }

        // Save metadata
        const metadataPath = path.join(downloadDir, 'metadata.json');
        let metadata = [];
        if (await fs.pathExists(metadataPath)) {
          metadata = await fs.readJson(metadataPath);
        }
        
        // Smart tagging (if not already present)
        const tags = item.tags || item.title.split(' ').filter((t: string) => t.length > 3);

        metadata.push({
          ...item,
          localPath: filePath,
          downloadUrl,
          tags,
          downloadedAt: new Date().toISOString(),
        });
        await fs.writeJson(metadataPath, metadata, { spaces: 2 });

        results.push({ id: item.id, status: 'success', filename: finalFilename, path: filePath });
      } catch (err: any) {
        console.error(`Failed to download ${item.id}:`, err.message);
        results.push({ id: item.id, status: 'error', error: err.message });
      }
    }

    // Optional: Open folder if multiple items were downloaded
    if (items.length > 1 && results.some(r => r.status === 'success')) {
      const { exec } = require('child_process');
      exec(`explorer "${downloadDir}"`);
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
