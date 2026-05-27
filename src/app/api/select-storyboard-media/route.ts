import { NextRequest, NextResponse } from 'next/server';
import { ResultItem } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface SelectionScene {
  text: string;
  visualConcept: string;
  query: string;
  preferredType: 'all' | 'image' | 'video' | null;
}

function getResponsesEndpoint() {
  const configuredEndpoint = process.env.OPENAI_STORYBOARD_ENDPOINT
    || process.env.OPENAI_RESPONSES_ENDPOINT;
  const baseUrl = (configuredEndpoint || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')
    .replace(/\/+$/, '');
  return baseUrl.endsWith('/responses') ? baseUrl : `${baseUrl}/responses`;
}

function extractOutputText(response: Record<string, unknown>) {
  if (typeof response.output_text === 'string') return response.output_text;

  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const content = Array.isArray((item as { content?: unknown }).content)
      ? (item as { content: unknown[] }).content
      : [];
    for (const part of content) {
      if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
        return (part as { text: string }).text;
      }
    }
  }
  return '';
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'AI media selection is not configured.' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const scene = body.scene as SelectionScene | undefined;
    const candidates = Array.isArray(body.candidates)
      ? (body.candidates as ResultItem[]).slice(0, 10)
      : [];

    if (!scene || candidates.length === 0) {
      return NextResponse.json({ error: 'A scene and candidate assets are required.' }, { status: 400 });
    }

    const candidateSummary = candidates.map((candidate) => ({
      id: candidate.id,
      source: candidate.source,
      type: candidate.type,
      title: candidate.title,
      year: candidate.year || '',
      description: (candidate.description || '').slice(0, 700),
      tags: (candidate.tags || []).slice(0, 10),
    }));

    const model = process.env.OPENAI_STORYBOARD_MODEL || 'gpt-4o-mini';
    const response = await fetch(getResponsesEndpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        instructions: [
          'You select one Pexels or Pixabay visual asset for a five-second-or-shorter YouTube storyboard scene.',
          'Select only an ID from the provided candidate list.',
          'Choose the asset most literally useful for the visible scene, not one that merely shares a vague keyword.',
          'The visual style should feel vintage and American where the narration allows it.',
          'Choose the most accurate stock asset available and avoid AI-generated, fantasy, or visibly unrelated material.',
          'Respect preferredType when it is set, unless that candidate is clearly irrelevant.',
          'Keep the reason concise and concrete.',
        ].join(' '),
        input: JSON.stringify({ scene, candidates: candidateSummary }),
        text: {
          format: {
            type: 'json_schema',
            name: 'storyboard_media_selection',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                selectedId: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['selectedId', 'reason'],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      const message = failure?.error?.message || 'AI media selection request failed.';
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const providerResponse = await response.json() as Record<string, unknown>;
    const selection = JSON.parse(extractOutputText(providerResponse)) as {
      selectedId?: string;
      reason?: string;
    };
    const selected = candidates.find((candidate) => candidate.id === selection.selectedId);

    if (!selected) throw new Error('AI selected an asset that is not available.');

    return NextResponse.json({ selectedId: selected.id, reason: selection.reason || '' });
  } catch (error) {
    console.error('AI media selection failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'AI media selection failed.' },
      { status: 500 },
    );
  }
}
