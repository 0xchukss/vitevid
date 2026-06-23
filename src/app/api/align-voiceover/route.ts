import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface WordTiming {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

function normalizeDuration(value: unknown) {
  const duration = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return duration > 0 ? Math.round(duration * 100) / 100 : 0;
}

function scaleWordTimings(words: WordTiming[], scale: number) {
  if (!Number.isFinite(scale) || scale <= 0 || Math.abs(scale - 1) < 0.01) return words;
  return words.map((word) => ({
    ...word,
    start: Math.round(word.start * scale * 100) / 100,
    end: Math.round(word.end * scale * 100) / 100,
  }));
}

function tokenizeScript(script: string) {
  return script
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .match(/[a-z0-9$€£]+(?:[.'-][a-z0-9]+)?|[^\s]/gi) || [];
}

function estimateWordTimings(script: string, duration: number): WordTiming[] {
  const tokens = tokenizeScript(script).filter((token) => /[a-z0-9$€£]/i.test(token));
  if (tokens.length === 0 || duration <= 0) return [];

  const weights = tokens.map((token) => {
    const base = Math.max(0.7, Math.min(2.4, token.length / 5));
    return /[.!?]$/.test(token) ? base + 0.8 : /[,;:]$/.test(token) ? base + 0.35 : base;
  });
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  let cursor = 0;

  return tokens.map((token, index) => {
    const wordDuration = Math.max(0.04, (weights[index] / totalWeight) * duration);
    const start = cursor;
    const end = Math.min(duration, cursor + wordDuration);
    cursor = end;
    return {
      word: token.replace(/[^\w$€£.'-]/g, ''),
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      confidence: 0,
    };
  });
}

function estimateScriptDuration(script: string) {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return words > 0 ? (words / 150) * 60 : 0;
}

function getSaneFallbackDuration(script: string, duration: number) {
  const scriptEstimate = estimateScriptDuration(script);
  if (scriptEstimate > 0 && (!duration || duration > scriptEstimate * 1.75 || duration < scriptEstimate * 0.45)) {
    return Math.round(scriptEstimate * 100) / 100;
  }
  return normalizeDuration(duration || scriptEstimate);
}

function getExpectedDuration(script: string, providedDuration: number, expectedDuration: number) {
  const scriptEstimate = estimateScriptDuration(script);
  if (expectedDuration > 0) return expectedDuration;
  if (scriptEstimate > 0 && providedDuration > 0 && providedDuration > scriptEstimate * 1.75) return scriptEstimate;
  return providedDuration || scriptEstimate;
}

function normalizeOpenAiWords(data: unknown): WordTiming[] {
  const response = data as {
    words?: Array<{
      word?: unknown;
      start?: unknown;
      end?: unknown;
    }>;
    segments?: Array<{
      words?: Array<{
        word?: unknown;
        start?: unknown;
        end?: unknown;
      }>;
    }>;
  };
  const words = response.words || response.segments?.flatMap((segment) => segment.words || []) || [];
  return words.reduce<WordTiming[]>((normalized, entry) => {
    const start = typeof entry.start === 'number' ? entry.start : NaN;
    const end = typeof entry.end === 'number' ? entry.end : NaN;
    const word = typeof entry.word === 'string' ? entry.word.trim() : '';
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return normalized;
    normalized.push({
      word,
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
    });
    return normalized;
  }, []);
}

function getOpenAiTranscript(data: unknown) {
  const response = data as { text?: unknown };
  return typeof response.text === 'string' ? response.text.trim() : '';
}

function normalizeDeepgramWords(data: unknown): WordTiming[] {
  const response = data as {
    results?: {
      channels?: Array<{
        alternatives?: Array<{
          words?: Array<{
            word?: unknown;
            punctuated_word?: unknown;
            start?: unknown;
            end?: unknown;
            confidence?: unknown;
          }>;
        }>;
      }>;
    };
  };
  const alternatives = response.results?.channels?.flatMap((channel) => channel.alternatives || []) || [];
  const words = alternatives.flatMap((alternative) => alternative.words || []);
  return words.reduce<WordTiming[]>((normalized, entry) => {
    const start = typeof entry.start === 'number' ? entry.start : NaN;
    const end = typeof entry.end === 'number' ? entry.end : NaN;
    const word = typeof entry.punctuated_word === 'string' && entry.punctuated_word.trim()
      ? entry.punctuated_word.trim()
      : typeof entry.word === 'string'
        ? entry.word.trim()
        : '';
    if (!word || !Number.isFinite(start) || !Number.isFinite(end)) return normalized;
    normalized.push({
      word,
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      confidence: typeof entry.confidence === 'number' ? entry.confidence : undefined,
    });
    return normalized;
  }, []);
}

function getDeepgramTranscript(data: unknown) {
  const response = data as {
    results?: {
      channels?: Array<{
        alternatives?: Array<{
          transcript?: unknown;
        }>;
      }>;
    };
  };
  return response.results?.channels?.[0]?.alternatives?.[0]?.transcript;
}

function describeProviderError(error: unknown) {
  if (!(error instanceof Error)) return 'Transcription provider failed.';
  const message = error.message.trim();
  try {
    const parsed = JSON.parse(message) as { error?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error && typeof parsed.error === 'object') {
      const nested = parsed.error as { message?: unknown };
      if (typeof nested.message === 'string') return nested.message;
    }
  } catch {}
  return message || 'Transcription provider failed.';
}

function getDeepgramEndpoint() {
  const baseUrl = (process.env.DEEPGRAM_BASE_URL || 'https://api.deepgram.com/v1').replace(/\/+$/, '');
  const endpoint = baseUrl.endsWith('/listen') ? baseUrl : `${baseUrl}/listen`;
  const params = new URLSearchParams({
    model: process.env.DEEPGRAM_MODEL || 'nova-3',
    smart_format: 'true',
    utterances: 'true',
  });
  return `${endpoint}?${params.toString()}`;
}

async function transcribeWithDeepgram({
  apiKey,
  audio,
  audioBuffer,
}: {
  apiKey: string;
  audio: File;
  audioBuffer: Buffer;
}) {
  const response = await fetch(getDeepgramEndpoint(), {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': audio.type || 'application/octet-stream',
    },
    body: new Uint8Array(audioBuffer),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Deepgram transcription failed with ${response.status}.`);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function getOpenAiAudioEndpoint(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.endsWith('/audio/transcriptions')
    ? normalized
    : `${normalized}/audio/transcriptions`;
}

async function transcribeWithOpenAi({
  apiKey,
  baseUrl,
  model,
  audio,
  audioBuffer,
  responseFormat,
  includeWordTimestamps,
}: {
  apiKey: string;
  baseUrl: string;
  model: string;
  audio: File;
  audioBuffer: Buffer;
  responseFormat: 'json' | 'verbose_json';
  includeWordTimestamps?: boolean;
}) {
  const formData = new FormData();
  const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: audio.type || 'audio/mpeg' });
  formData.append('file', audioBlob, audio.name || 'voiceover.mp3');
  formData.append('model', model);
  formData.append('response_format', responseFormat);
  if (includeWordTimestamps) formData.append('timestamp_granularities[]', 'word');

  const response = await fetch(getOpenAiAudioEndpoint(baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });
  if (!response.ok) {
    const failure = await response.text().catch(() => '');
    throw new Error(failure || `OpenAI transcription failed with ${response.status}.`);
  }
  return response.json();
}

function sanitizeProviderTiming(words: WordTiming[], providerDuration: number, expectedDuration: number) {
  if (words.length === 0) return { words, duration: providerDuration };
  if (!expectedDuration || expectedDuration <= 0) return { words, duration: providerDuration };
  const actualDuration = providerDuration || words[words.length - 1]?.end || 0;
  if (!actualDuration || actualDuration <= 0) return { words, duration: expectedDuration };
  if (actualDuration > expectedDuration * 1.35 || actualDuration < expectedDuration * 0.65) {
    return {
      words: scaleWordTimings(words, expectedDuration / actualDuration),
      duration: Math.round(expectedDuration * 100) / 100,
    };
  }
  return { words, duration: Math.round(expectedDuration * 100) / 100 };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audio = formData.get('audio');
    const script = String(formData.get('script') || '');
    const timingSource = String(formData.get('timingSource') || '');
    const duration = Number(formData.get('duration') || 0);
    const expectedDuration = timingSource === 'audio'
      ? normalizeDuration(duration)
      : getExpectedDuration(
        script,
        duration,
        Number(formData.get('expectedDuration') || 0),
      );

    if (!audio || typeof audio === 'string') {
      return NextResponse.json({ error: 'Attach a voiceover audio file.' }, { status: 400 });
    }
    const audioBuffer = Buffer.from(await audio.arrayBuffer());

    const transcriptionProviders = [
      {
        kind: 'deepgram' as const,
        name: 'Deepgram provider',
        apiKey: process.env.DEEPGRAM_API_KEY,
      },
      {
        kind: 'openai' as const,
        name: 'configured Whisper provider',
        apiKey: process.env.OPENAI_WHISPER_API_KEY,
        baseUrl: process.env.OPENAI_WHISPER_BASE_URL || 'https://api.openai.com/v1',
        model: process.env.OPENAI_WHISPER_MODEL || 'whisper-1',
      },
      {
        kind: 'openai' as const,
        name: 'OpenAI fallback provider',
        apiKey: process.env.OPENAI_API_KEY,
        baseUrl: 'https://api.openai.com/v1',
        model: process.env.OPENAI_WHISPER_MODEL || 'whisper-1',
      },
    ].filter((provider, index, providers) => (
      provider.apiKey
      && providers.findIndex((candidate) => (
        candidate.apiKey === provider.apiKey
        && candidate.baseUrl === provider.baseUrl
        && candidate.model === provider.model
      )) === index
    ));
    let transcriptionFailure = '';

    for (const provider of transcriptionProviders) {
      try {
        if (provider.kind === 'deepgram') {
          const deepgramPayload = await transcribeWithDeepgram({
            apiKey: provider.apiKey as string,
            audio,
            audioBuffer,
          });
          const rawWords = normalizeDeepgramWords(deepgramPayload);
          const rawDuration = rawWords[rawWords.length - 1]?.end || 0;
          const sanitized = sanitizeProviderTiming(rawWords, rawDuration, expectedDuration);
          if (sanitized.words.length > 0) {
            return NextResponse.json({
              mode: 'transcribed',
              provider: provider.name,
              words: sanitized.words,
              transcript: getDeepgramTranscript(deepgramPayload) || sanitized.words.map((word) => word.word).join(' '),
              durationSeconds: sanitized.duration,
              timingScaled: rawWords !== sanitized.words,
            });
          }
          throw new Error('Deepgram returned no word timestamps.');
        }

        const whisperPayload = await transcribeWithOpenAi({
          apiKey: provider.apiKey as string,
          baseUrl: provider.baseUrl as string,
          model: provider.model as string,
          audio,
          audioBuffer,
          responseFormat: 'verbose_json',
          includeWordTimestamps: true,
        });
        const rawWords = normalizeOpenAiWords(whisperPayload);
        const rawDuration = normalizeDuration((whisperPayload as { duration?: unknown }).duration)
          || rawWords[rawWords.length - 1]?.end
          || 0;
        const sanitized = sanitizeProviderTiming(rawWords, rawDuration, expectedDuration);
        if (sanitized.words.length > 0) {
          let transcript = getOpenAiTranscript(whisperPayload);
          const cleanTranscriptKey = process.env.OPENAI_TRANSCRIBE_API_KEY;
          if (cleanTranscriptKey) {
            try {
              const cleanPayload = await transcribeWithOpenAi({
                apiKey: cleanTranscriptKey,
                baseUrl: process.env.OPENAI_TRANSCRIBE_BASE_URL || 'https://api.openai.com/v1',
                model: process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-transcribe',
                audio,
                audioBuffer,
                responseFormat: 'json',
              });
              transcript = getOpenAiTranscript(cleanPayload) || transcript;
            } catch (error) {
              console.warn('Cleaner OpenAI transcript failed:', error);
            }
          }
          return NextResponse.json({
            mode: 'transcribed',
            provider: provider.name,
            words: sanitized.words,
            transcript,
            durationSeconds: sanitized.duration,
            timingScaled: rawWords !== sanitized.words,
          });
        }
      } catch (error) {
        transcriptionFailure = `${provider.name}: ${describeProviderError(error)}`;
        console.warn('OpenAI Whisper transcription failed:', transcriptionFailure);
      }
    }

    if (!script.trim()) {
      return NextResponse.json(
        {
          error: transcriptionFailure
            ? `Voiceover transcription failed. ${transcriptionFailure}`
            : 'Voiceover transcription is not configured. Add OPENAI_API_KEY or OPENAI_WHISPER_API_KEY for a provider that supports /audio/transcriptions.',
        },
        { status: 503 },
      );
    }

    const fallbackDuration = getSaneFallbackDuration(script, expectedDuration || duration);
    return NextResponse.json({
      mode: 'estimated',
      provider: 'script-duration',
      words: estimateWordTimings(script, fallbackDuration),
      durationSeconds: fallbackDuration,
      warning: 'OpenAI Whisper transcription failed, so script-estimated timing was used.',
    });
  } catch (error) {
    console.error('Voiceover alignment failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Voiceover alignment failed.' },
      { status: 500 },
    );
  }
}
