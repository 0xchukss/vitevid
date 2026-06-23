import { NextRequest, NextResponse } from 'next/server';
import { ResultItem } from '@/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const ALLOWED_MOTIONS = ['push-in', 'pull-out', 'pan-left', 'pan-right'] as const;
const ALLOWED_RATIOS = ['16:9', '9:16', '1:1', '4:3'] as const;
const ALLOWED_TRANSITIONS = ['none', 'fade', 'slideleft', 'slidedown', 'screenburn', 'glitch'] as const;

interface EditScene {
  id: number;
  text: string;
  duration: number;
  start?: number;
  asset: ResultItem;
}

interface SoundEffectAsset {
  id: string;
  label: string;
  description: string;
}

interface SceneEditPlan {
  sceneId: number;
  motion: typeof ALLOWED_MOTIONS[number];
  startScale: number;
  endScale: number;
  startX: number;
  endX: number;
  startY: number;
  endY: number;
  rotation: number;
  brightness: number;
  contrast: number;
  saturation: number;
  sepia: number;
  transition: typeof ALLOWED_TRANSITIONS[number];
}

interface SoundEffectPlan {
  assetId: string;
  sceneId: number;
  startOffset: number;
  duration: number;
  volume: number;
}

interface TextOverlayPlan {
  text: string;
  sceneId: number;
  startOffset: number;
  duration: number;
  fontSize: number;
  color: string;
  backgroundColor: string;
  positionX: number;
  positionY: number;
}

interface WordTiming {
  word: string;
  start: number;
  end: number;
  confidence?: number;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, numeric));
}

function getChatCompletionsEndpoint() {
  const baseUrl = (process.env.CLAUDE_EDIT_BASE_URL || 'https://api.freemodel.dev/v1').replace(/\/+$/, '');
  return baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
}

function getNicheEditVibe(niche: string) {
  const key = niche.toLowerCase();
  if (key.includes('true crime')) {
    return [
      'True crime edit vibe: keep the tone dark, investigative, tense, and cinematic without turning the narration into a parody horror trailer.',
      'Do not use hyper-paced cutting for true crime. A single strong real case image can hold for 10 to 15 seconds when it matches the narration.',
      'Use cold low-saturation visuals, heavier contrast, subtle blue-green shadows, dark vignette, slow push-ins, and fade transitions on evidence, documents, suspects, locations, and case-file imagery.',
      'Prioritize real case imagery: exact victims, suspects, court records, police evidence, missing-person posters, mugshots, newspaper images, and real locations. Avoid generic horror visuals when a case-specific image exists.',
      'When true-crime or horror sound effects are provided, use them sparingly: radio/static for investigation or case-file scenes, heartbeat for fear or danger, horror swish/sweep for reveals, and impact hits only for major turns.',
      'Avoid loud or comedic creature-like sounds unless the scene explicitly mentions that exact setting. Keep SFX under the voiceover and timed to spoken evidence, reveal, danger, or transition points.',
      'Numbered-item callouts still must use typewriter or keyboard-typing sound only.',
    ].join(' ');
  }
  if (!key.includes('history')) return '';
  return [
    'History vintage edit vibe: treat the voiceover timestamps as the master timeline.',
    'Match the provided reference style: fast vintage documentary/list editing with a major visual change or reset roughly every 2.6 to 2.8 seconds, while still respecting the exact voiceover scene timing.',
    'Use a vintage American documentary feel: archival framing, old TV/newsreel borders, low saturation, stronger sepia, readable image fit, restrained film contrast, and real period detail.',
    'Prefer edit decisions that make archival photos, old news footage stills, newspaper headlines, documents, maps, charts, vintage ads, food/product closeups, and household objects feel like a fast researched documentary.',
    'Actively vary the visual elements the way the reference videos do: alternate people, streets, government rooms, banks, kitchens, food, ledgers, newspapers, handwritten notes, maps, charts, product labels, advertisements, and old film frames instead of using one repeated category.',
    'Use data/chart/map/document overlays when the narration mentions statistics, locations, policies, years, money, or survival methods; do not waste those moments on unrelated portrait photos.',
    'For list-number callouts, money, years, percentages, and statistics, make short high-impact overlays only, timed to the spoken phrase.',
    'List-number overlays should feel classic and authoritative with serif typography, usually as "25. collecting rainwater" or "#25: collecting rainwater" when the title is spoken. Keyword and statistic overlays should feel bold, punchy, and cinematic.',
    'List-number and numbered-item callouts must use typewriter or keyboard-typing sound only. Never use mouse clicks, popups, whooshes, or cinematic hits for numbering.',
    'Use screenburn transitions regularly for aged-film flashes, time-jump reveals, old-photo reveals, money/year reveals, and major vintage chapter turns. Use glitch transitions sparingly for sudden data shocks, timeline resets, TV/news footage, or unsettling historical twists.',
    'When history-vintage sound effects are provided, prefer typewriter for every numbered item, paper tears or crumples for documents/newspapers/ledgers/bills, camera shutters for people/photos/proof, projector sounds for archival footage, and tape rewind for years, decades, flashbacks, or time jumps.',
    'For non-numbering overlays, prefer period-feeling paper, shutter, projector, tape, subtle whoosh, and low cinematic hit accents only when those assets fit the spoken phrase.',
    'Keep history SFX audible but under the voiceover. Use big impacts sparingly for major turning points, not for every sentence.',
    'Do not request AI-generated illustrations or generic symbolic filler. Choose concrete archival/documentary-style assets that visibly support the exact spoken phrase.',
  ].join(' ');
}

function extractChatContent(response: Record<string, unknown>) {
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const firstChoice = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = firstChoice?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') return '';
        const value = part as { text?: unknown; content?: unknown };
        return typeof value.text === 'string'
          ? value.text
          : typeof value.content === 'string'
            ? value.content
            : '';
      })
      .join('');
  }
  return '';
}

function parseJsonObject(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as Record<string, unknown>;
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude did not return JSON.');
  return JSON.parse(match[0]) as Record<string, unknown>;
}

function normalizeScenePlan(plan: unknown, scene: EditScene, index: number): SceneEditPlan {
  const value = plan && typeof plan === 'object' ? plan as Record<string, unknown> : {};
  const motion = ALLOWED_MOTIONS.includes(value.motion as typeof ALLOWED_MOTIONS[number])
    ? value.motion as typeof ALLOWED_MOTIONS[number]
    : ALLOWED_MOTIONS[index % ALLOWED_MOTIONS.length];
  const transition = ALLOWED_TRANSITIONS.includes(value.transition as typeof ALLOWED_TRANSITIONS[number])
    ? value.transition as SceneEditPlan['transition']
    : index === 0 ? 'none' : 'fade';

  return {
    sceneId: scene.id,
    motion,
    startScale: clamp(value.startScale, 100, 180, 104),
    endScale: clamp(value.endScale, 100, 180, 112),
    startX: clamp(value.startX, -40, 40, index % 2 === 0 ? -3 : 3),
    endX: clamp(value.endX, -40, 40, index % 2 === 0 ? 3 : -3),
    startY: clamp(value.startY, -40, 40, index % 2 === 0 ? 0 : -2),
    endY: clamp(value.endY, -40, 40, index % 2 === 0 ? -2 : 0),
    rotation: clamp(value.rotation, -8, 8, index % 3 === 0 ? -0.35 : 0.25),
    brightness: clamp(value.brightness, 60, 150, 98),
    contrast: clamp(value.contrast, 60, 180, 112),
    saturation: clamp(value.saturation, 0, 180, 82),
    sepia: clamp(value.sepia, 0, 100, 18),
    transition,
  };
}

function normalizeSoundEffectPlan(
  plan: unknown,
  scenes: EditScene[],
  soundEffectAssets: SoundEffectAsset[],
): SoundEffectPlan | null {
  const value = plan && typeof plan === 'object' ? plan as Record<string, unknown> : {};
  const assetId = typeof value.assetId === 'string' ? value.assetId : '';
  const assetExists = soundEffectAssets.some((asset) => asset.id === assetId);
  const sceneId = typeof value.sceneId === 'number' ? value.sceneId : NaN;
  const scene = scenes.find((entry) => entry.id === sceneId);
  if (!assetExists || !scene) return null;

  return {
    assetId,
    sceneId,
    startOffset: clamp(value.startOffset, 0, Math.max(0, scene.duration - 0.1), 0),
    duration: clamp(value.duration, 0.1, Math.min(8, scene.duration), Math.min(1.5, scene.duration)),
    volume: clamp(value.volume, 5, 100, 70),
  };
}

function normalizeTextOverlayPlan(plan: unknown, scenes: EditScene[]): TextOverlayPlan | null {
  const value = plan && typeof plan === 'object' ? plan as Record<string, unknown> : {};
  const text = typeof value.text === 'string' ? value.text.trim().slice(0, 120) : '';
  const sceneId = typeof value.sceneId === 'number' ? value.sceneId : NaN;
  const scene = scenes.find((entry) => entry.id === sceneId);
  if (!text || !scene) return null;
  const color = /^#[0-9a-f]{6}$/i.test(String(value.color || '')) ? String(value.color) : '#ffffff';
  const backgroundColor = /^#[0-9a-f]{6}$/i.test(String(value.backgroundColor || ''))
    ? String(value.backgroundColor)
    : '#000000';

  return {
    text,
    sceneId,
    startOffset: clamp(value.startOffset, 0, Math.max(0, scene.duration - 0.1), 0),
    duration: clamp(value.duration, 0.4, Math.min(6, scene.duration), Math.min(2, scene.duration)),
    fontSize: clamp(value.fontSize, 18, 96, 56),
    color,
    backgroundColor,
    positionX: clamp(value.positionX, 0, 100, 50),
    positionY: clamp(value.positionY, 0, 100, 78),
  };
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.CLAUDE_EDIT_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Claude editing is not configured.' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const niche = typeof body.niche === 'string' ? body.niche : 'YouTube documentary';
    const editingInstructions = typeof body.editingInstructions === 'string'
      ? body.editingInstructions.slice(0, 1200)
      : '';
    const soundEffectAssets = Array.isArray(body.soundEffectAssets)
      ? body.soundEffectAssets.filter((asset: unknown): asset is SoundEffectAsset => {
        if (!asset || typeof asset !== 'object') return false;
        const value = asset as Record<string, unknown>;
        return typeof value.id === 'string'
          && typeof value.label === 'string'
          && typeof value.description === 'string';
      }).slice(0, 60)
      : [];
    const scenes = Array.isArray(body.scenes) ? body.scenes.slice(0, 120) as EditScene[] : [];
    const wordTimings = Array.isArray(body.wordTimings)
      ? (body.wordTimings as WordTiming[])
        .filter((word) => (
          word
          && typeof word.word === 'string'
          && typeof word.start === 'number'
          && typeof word.end === 'number'
        ))
        .slice(0, 2000)
      : [];
    if (scenes.length === 0) {
      return NextResponse.json({ error: 'Send at least one scene for editing.' }, { status: 400 });
    }

    const nicheEditVibe = getNicheEditVibe(niche);
    const sceneBrief = scenes.map((scene, index) => ({
      sceneId: scene.id,
      order: index + 1,
      text: scene.text,
      duration: scene.duration,
      start: scene.start ?? 0,
      assetType: scene.asset.type,
      assetTitle: scene.asset.title,
      source: scene.asset.source,
      tags: (scene.asset.tags || []).slice(0, 8),
      timedWords: wordTimings
        .filter((word) => (
          word.start >= (scene.start ?? 0) - 0.25
          && word.end <= (scene.start ?? 0) + scene.duration + 0.25
        ))
        .slice(0, 80),
    }));

    const response = await fetch(getChatCompletionsEndpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_EDIT_MODEL || 'sonnet 4.6',
        messages: [
          {
            role: 'system',
            content: [
              'You are a senior YouTube video editor and Remotion motion director.',
              'Return only valid JSON. No markdown.',
              'Choose edit decisions for an automated Remotion render.',
              'Make the edit thrilling and tense for retention: use deliberate push-ins, readable transitions, contrast shifts, and well-timed sound accents. For true crime, slow documentary tension is better than fast cutting.',
              'Keep motion realistic, avoid extreme values, keep images readable inside the frame, and match the requested niche.',
              'Do not create full narration captions by default.',
              'Only return textOverlays for specific words, phrases, money labels, translations, number callouts, or on-screen text that the user explicitly requested in editingInstructions.',
              'For money or numeric callouts, keep text short and visually useful. If translation is requested, include it in the same text field on a second line.',
              'When placing a requested caption or callout, set startOffset slightly before the phrase would be spoken when possible.',
              'If timedWords are provided, use their word start/end timestamps to place requested captions and sound effects accurately. startOffset must be relative to that scene start.',
              'You may place sound effects only from the provided sound_effect_assets list. Use them sparingly and only when they fit the scene or requested caption.',
              'Important hard rule: numbering/list callouts must use typewriter or keyboard-typing sound only.',
              nicheEditVibe,
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify({
              niche,
              editingInstructions,
              scenes: sceneBrief,
              timing_note: wordTimings.length > 0
                ? 'timedWords contain voiceover word timestamps in seconds. Use them for captions, callouts, and SFX timing.'
                : 'No word timestamps were provided.',
              sound_effect_assets: soundEffectAssets,
              allowed_motions: ALLOWED_MOTIONS,
              allowed_aspect_ratios: ALLOWED_RATIOS,
              schema: {
                aspectRatio: '16:9 | 9:16 | 1:1 | 4:3',
                canvasColor: '#000000',
                scenes: [{
                  sceneId: 'number from provided sceneId',
                  motion: 'push-in | pull-out | pan-left | pan-right',
                  startScale: '100-180',
                  endScale: '100-180',
                  startX: '-40 to 40',
                  endX: '-40 to 40',
                  startY: '-40 to 40',
                  endY: '-40 to 40',
                  rotation: '-8 to 8',
                  brightness: '60-150',
                  contrast: '60-180',
                  saturation: '0-180',
                  sepia: '0-100',
                  transition: 'none | fade | slideleft | slidedown | screenburn | glitch',
                }],
                soundEffects: [{
                  assetId: 'id from provided sound_effect_assets',
                  sceneId: 'number from provided sceneId',
                  startOffset: 'seconds after that scene begins',
                  duration: '0.1-8 seconds',
                  volume: '5-100',
                }],
                textOverlays: [{
                  text: 'caption or callout text, optional translated line',
                  sceneId: 'number from provided sceneId',
                  startOffset: 'seconds after that scene begins',
                  duration: '0.4-6 seconds',
                  fontSize: '18-96',
                  color: '#ffffff',
                  backgroundColor: '#000000',
                  positionX: '0-100',
                  positionY: '0-100',
                }],
              },
            }),
          },
        ],
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      const message = failure?.error?.message || 'Claude edit planning request failed.';
      return NextResponse.json({ error: message }, { status: response.status });
    }

    const providerResponse = await response.json() as Record<string, unknown>;
    const parsed = parseJsonObject(extractChatContent(providerResponse));
    const ratio = ALLOWED_RATIOS.includes(parsed.aspectRatio as typeof ALLOWED_RATIOS[number])
      ? parsed.aspectRatio as typeof ALLOWED_RATIOS[number]
      : '16:9';
    const scenePlans = Array.isArray(parsed.scenes) ? parsed.scenes : [];
    const soundEffectPlans = Array.isArray(parsed.soundEffects)
      ? parsed.soundEffects
        .map((plan) => normalizeSoundEffectPlan(plan, scenes, soundEffectAssets))
        .filter((plan): plan is SoundEffectPlan => Boolean(plan))
        .slice(0, Math.min(24, scenes.length * 2))
      : [];
    const textOverlayPlans = Array.isArray(parsed.textOverlays)
      ? parsed.textOverlays
        .map((plan) => normalizeTextOverlayPlan(plan, scenes))
        .filter((plan): plan is TextOverlayPlan => Boolean(plan))
        .slice(0, Math.min(40, scenes.length * 3))
      : [];

    return NextResponse.json({
      niche,
      aspectRatio: ratio,
      canvasColor: /^#[0-9a-f]{6}$/i.test(String(parsed.canvasColor || ''))
        ? parsed.canvasColor
        : '#000000',
      scenes: scenes.map((scene, index) => {
        const matchingPlan = scenePlans.find((plan) => (
          plan && typeof plan === 'object' && (plan as { sceneId?: unknown }).sceneId === scene.id
        ));
        return normalizeScenePlan(matchingPlan, scene, index);
      }),
      textOverlays: textOverlayPlans,
      soundEffects: soundEffectPlans,
    });
  } catch (error) {
    console.error('Claude edit planning failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Claude edit planning failed.' },
      { status: 500 },
    );
  }
}
