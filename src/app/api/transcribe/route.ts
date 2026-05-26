import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SUPPORTED_AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp4',
  'audio/mpga',
  'audio/m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'video/mp4',
]);

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Voice-over transcription is not configured yet.' },
      { status: 503 },
    );
  }

  try {
    const formData = await request.formData();
    const audio = formData.get('audio');

    if (!(audio instanceof File) || audio.size === 0) {
      return NextResponse.json({ error: 'An audio file is required.' }, { status: 400 });
    }

    if (audio.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: 'Audio files must be 25 MB or smaller.' }, { status: 400 });
    }

    if (audio.type && !SUPPORTED_AUDIO_TYPES.has(audio.type)) {
      return NextResponse.json({ error: 'Unsupported audio file format.' }, { status: 400 });
    }

    const transcriptionForm = new FormData();
    transcriptionForm.append('file', audio, audio.name);
    transcriptionForm.append('model', 'gpt-4o-mini-transcribe');
    transcriptionForm.append('response_format', 'json');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: transcriptionForm,
    });

    const data = await response.json();
    if (!response.ok) {
      return NextResponse.json(
        { error: data.error?.message || 'Voice-over transcription failed.' },
        { status: response.status },
      );
    }

    return NextResponse.json({ text: data.text || '' });
  } catch (error) {
    console.error('Transcription failed:', error);
    return NextResponse.json({ error: 'Voice-over transcription failed.' }, { status: 500 });
  }
}
