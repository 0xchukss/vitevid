import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface PlanningSlot {
  text: string;
  narrationStart: number;
  narrationEnd: number;
}

interface PlannedScene {
  scene_number: number;
  scene_text: string;
  duration_seconds: number;
  visual_description: string;
  search_terms: string[];
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

function isPlannedScene(scene: unknown): scene is PlannedScene {
  if (!scene || typeof scene !== 'object') return false;
  const value = scene as Record<string, unknown>;
  return typeof value.scene_number === 'number'
    && typeof value.scene_text === 'string'
    && typeof value.duration_seconds === 'number'
    && value.duration_seconds > 0
    && value.duration_seconds <= 4
    && typeof value.visual_description === 'string'
    && Array.isArray(value.search_terms)
    && value.search_terms.length >= 2
    && value.search_terms.length <= 3
    && value.search_terms.every((term) => typeof term === 'string' && term.trim().length > 0);
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'AI storyboard planning is not configured. Add OPENAI_API_KEY on the server.' },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const slots = Array.isArray(body.scenes) ? body.scenes as PlanningSlot[] : [];
    const startSceneNumber = Number.isFinite(body.startSceneNumber) ? body.startSceneNumber : 1;
    const retryForNoResults = body.retryForNoResults === true;
    const failedSearchTerms = Array.isArray(body.failedSearchTerms)
      ? body.failedSearchTerms.filter((term: unknown) => typeof term === 'string')
      : [];

    if (slots.length === 0 || slots.length > 15) {
      return NextResponse.json(
        { error: 'Send between 1 and 15 narration slots for planning.' },
        { status: 400 },
      );
    }

    const scriptText = slots.map((slot) => slot.text).join(' ').trim();
    const slotDurations = slots.map((slot) => Number((slot.narrationEnd - slot.narrationStart).toFixed(2)));
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
          'You are a video production assistant. Analyze a video script and break it down into scenes for a YouTube long-form video.',
          'Each output scene represents one provided timeline slot and must be 4 seconds or less.',
          'Preserve every spoken word exactly once across scene_text fields, in the same order. Do not paraphrase or invent narration.',
          'Identify the visual content that best fits each moment in visual_description.',
          'Generate exactly 3 specific search terms optimized for Pixabay and Pexels.',
          'Search terms should be concrete visible subjects or actions that accurately fit the narration and work well on Pixabay and Pexels.',
          'Use period or American context only where it helps find the right media; do not repeat generic style phrases across every scene.',
          retryForNoResults
            ? 'The previous terms returned no results. Choose broad substitute visuals available in stock libraries, using simple phrases of one to three common words. Preserve the core subject and action of the narration: for money use cash, bills, coins, ledgers, wallets, or banks; for government use courthouse, capitol, papers, or officials. Never invent unrelated chores, objects, or actions. Do not include dates, eras, vintage, sepia, America, brand names, or abstract financial/political concepts.'
            : '',
          'Avoid abstract phrases, platform names, and non-American locations unless the script explicitly requires them.',
          `Return exactly ${slots.length} scenes, numbered consecutively beginning at ${startSceneNumber}.`,
          'Use the requested duration for each corresponding timeline slot and never exceed 4 seconds.',
          'Return only structured scene data and no explanatory text.',
        ].join(' '),
        input: JSON.stringify({
          script_text: scriptText,
          scene_count: slots.length,
          start_scene_number: startSceneNumber,
          duration_seconds_by_scene: slotDurations,
          failed_search_terms: retryForNoResults ? failedSearchTerms : undefined,
        }),
        text: {
          format: {
            type: 'json_schema',
            name: 'stock_storyboard_scenes',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                scenes: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      scene_number: { type: 'number' },
                      scene_text: { type: 'string' },
                      duration_seconds: { type: 'number' },
                      visual_description: { type: 'string' },
                      search_terms: {
                        type: 'array',
                        items: { type: 'string' },
                        minItems: 3,
                        maxItems: 3,
                      },
                    },
                    required: [
                      'scene_number',
                      'scene_text',
                      'duration_seconds',
                      'visual_description',
                      'search_terms',
                    ],
                    additionalProperties: false,
                  },
                },
              },
              required: ['scenes'],
              additionalProperties: false,
            },
          },
        },
      }),
    });

    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      const message = failure?.error?.message || 'AI storyboard planning request failed.';
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const providerResponse = await response.json() as Record<string, unknown>;
    const parsed = JSON.parse(extractOutputText(providerResponse)) as { scenes?: unknown[] };
    const plannedScenes = (parsed.scenes || []).filter(isPlannedScene);

    if (plannedScenes.length !== slots.length) {
      throw new Error('AI returned an incomplete storyboard plan.');
    }

    return NextResponse.json(plannedScenes);
  } catch (error) {
    console.error('AI storyboard planning failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'AI storyboard planning failed.' },
      { status: 500 },
    );
  }
}
