import { NextRequest, NextResponse } from 'next/server';
import { ResultItem } from '@/types';
import { canAutoUseMedia, mediaRightsScore, withMediaRights } from '@/lib/mediaRights';
import { MAX_STORYBOARD_ASSET_REUSE, assetUsageCount, usageMapFromRecord } from '@/lib/mediaIdentity';
import { isUnsafeAdultMedia, isVisuallyUnsafeForScene, mediaSafetyPenalty } from '@/lib/mediaSafety';

export const runtime = 'nodejs';
export const maxDuration = 60;

const CLAUDE_MEDIA_SELECTION_TIMEOUT_MS = 22000;

interface SelectionScene {
  text: string;
  visualConcept: string;
  query: string;
  preferredType: 'all' | 'image' | 'video' | null;
  niche?: string;
  caseTitle?: string;
  caseTime?: string;
}

type CaseTimePreference = 'unspecified' | 'day' | 'night';

function getChatCompletionsEndpoint() {
  const configuredEndpoint = process.env.CLAUDE_STORYBOARD_BASE_URL
    || process.env.CLAUDE_EDIT_BASE_URL
    || 'https://api.freemodel.dev/v1';
  const baseUrl = configuredEndpoint.replace(/\/+$/, '');
  return baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
}

function shouldOmitSamplingParams(modelName: unknown) {
  return typeof modelName === 'string' && /opus-4-(?:7|8)\b/i.test(modelName);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
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

const GENERATED_STYLE_PATTERN = /\b(ai|artificial intelligence|render|rendered|3d|cgi|fantasy|illustration|illustrated|illus\.|digital art|concept art|vector|clipart|clip art|cartoon|anime|drawing|sketch|watercolor|icon|icons|symbol|sticker|logo|isolated|transparent|svg|mockup|template|abstract|graphic|isometric|cutout|decorative)\b/i;
const GENERATED_SOURCE_PATTERN = /\bgoogle|fallback|scrape\b/i;
const BLOCKED_STOCK_OR_SLIDE_PATTERN = /\b(adobe\s*stock|adobestock|stock\.adobe|alamy|shutterstock|getty|istock|dreamstime|depositphotos|123rf|freepik|vecteezy|envato|stock\s*photo|stock-photo|stock\s*image|royalty[-\s]*free|watermark|watermarked|slideplayer|timetoast|pinterest|slideshare)\b/i;

function normalizeCaseTimePreference(value: unknown): CaseTimePreference {
  if (typeof value !== 'string') return 'unspecified';
  const key = value.toLowerCase();
  if (key.includes('night')) return 'night';
  if (key.includes('day')) return 'day';
  return 'unspecified';
}

function isGeneratedOrIllustrativeCandidate(candidate: ResultItem) {
  const searchableText = [
    candidate.source,
    candidate.title,
    candidate.description || '',
    ...(candidate.tags || []),
  ].join(' ');
  const mediaUrls = `${candidate.thumbnail || ''} ${candidate.downloadUrl || ''}`;
  const externalUrl = candidate.url || '';
  return GENERATED_SOURCE_PATTERN.test(candidate.source)
    || GENERATED_STYLE_PATTERN.test(searchableText)
    || BLOCKED_STOCK_OR_SLIDE_PATTERN.test(searchableText)
    || BLOCKED_STOCK_OR_SLIDE_PATTERN.test(mediaUrls)
    || GENERATED_STYLE_PATTERN.test(externalUrl)
    || /\.svg(?:\?|$)/i.test(mediaUrls);
}

const SELECTION_RANK_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'that', 'this', 'real', 'case',
  'photo', 'image', 'evidence', 'true', 'crime', 'documentary', 'photos',
  'picture', 'pictures', 'scene',
]);
const TRUE_CRIME_LOCATION_ANCHOR_TERMS = new Set([
  'road', 'street', 'forest', 'woods', 'trail', 'mountain', 'snow', 'snowy',
  'cabin', 'house', 'home', 'vehicle', 'car', 'highway', 'plumas', 'national',
  'dirt', 'dark', 'midnight', 'night',
]);

function meaningfulSelectionTerms(value: string) {
  return Array.from(new Set(
    (value.toLowerCase().match(/[a-z0-9][a-z0-9'-]{2,}/g) || [])
      .filter((term) => !SELECTION_RANK_STOP_WORDS.has(term)),
  ));
}

function actualCandidateText(candidate: ResultItem) {
  return [
    candidate.title,
    candidate.description || '',
    candidate.year || '',
    candidate.url || '',
    candidate.sourcePageUrl || '',
    candidate.downloadUrl || '',
  ].join(' ').toLowerCase();
}

function isTrueCrimeLocationScene(value: string) {
  return /\b(road|street|forest|woods?|trail|mountain|snow|cabin|house|home|vehicle|car|scene|location|area|highway|bridge|river|lake|field|parking|driveway|store|motel|hotel|apartment)\b/i.test(value)
    && !/\b(court|courtroom|trial|mugshot|records?|documents?|newspaper|poster|report|file|map|timeline|article)\b/i.test(value);
}

function hasNightSignal(value: string) {
  return /\b(night|nighttime|midnight|evening|after dark|dark road|dark street|dark forest|dark woods|dark highway|dark mountain|dark cabin|eerie midnight|headlights?)\b/i.test(value);
}

function hasDaySignal(value: string) {
  return /\b(daylight|daytime|sunny|morning|afternoon|blue sky|day road|day forest|daytime forest)\b/i.test(value);
}

function scoreCandidateForScene(candidate: ResultItem, scene?: SelectionScene) {
  const niche = (scene?.niche || '').toLowerCase();
  const caseTitle = (scene?.caseTitle || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const caseTime = normalizeCaseTimePreference(scene?.caseTime);
  const searchableText = actualCandidateText(candidate);
  const sceneSearchText = [scene?.query || '', scene?.visualConcept || '', scene?.text || ''].join(' ').toLowerCase();
  const timeSensitiveLocation = niche.includes('true crime') && isTrueCrimeLocationScene(sceneSearchText);
  const exactSceneTerms = meaningfulSelectionTerms(sceneSearchText);
  const visualAnchorTerms = exactSceneTerms.filter((term) => TRUE_CRIME_LOCATION_ANCHOR_TERMS.has(term));
  const caseTerms = meaningfulSelectionTerms(caseTitle);
  let score = 0;
  score += mediaSafetyPenalty(candidate, {
    sceneText: scene?.text,
    query: scene?.query,
    visualConcept: scene?.visualConcept,
    niche: scene?.niche,
  });
  score += mediaRightsScore(candidate);
  score += exactSceneTerms.filter((term) => searchableText.includes(term)).length * 5;
  if (timeSensitiveLocation) {
    score += visualAnchorTerms.filter((term) => searchableText.includes(term)).length * 14;
  }
  score += caseTerms.filter((term) => searchableText.includes(term)).length * 10;
  if (caseTitle && searchableText.includes(caseTitle)) score += 35;
  if (candidate.type === 'video') score += niche.includes('true crime') ? 2 : 10;
  if (candidate.type === 'image' && niche.includes('true crime')) score += 8;
  if (scene?.preferredType && candidate.type === scene.preferredType) score += 6;
  if (niche.includes('history') && /\b(vintage|historic|history|old|archive|archival|retro|1920|1930|1940|1950|black and white)\b/.test(searchableText)) {
    score += 7;
  }
  if (niche.includes('history') && /\b(newsreel|news footage|documentary|film still|film frame|newspaper|headline|document|ledger|map|chart|graph|advertisement|product|label|kitchen|food|cooking|jar|coffee|soap|bank|government|congress|crowd|street|family)\b/.test(searchableText)) {
    score += 9;
  }
  if (niche.includes('true crime') && /\b(police|crime|detective|evidence|court|forensic|investigation)\b/.test(searchableText)) {
    score += 6;
  }
  if (niche.includes('true crime') && /\b(case|victim|suspect|mugshot|trial|courtroom|crime scene|missing person|document|records?|newspaper|location)\b/.test(searchableText)) {
    score += 8;
  }
  if (niche.includes('true crime') && caseTitle && caseTerms.length > 0 && caseTerms.every((term) => !searchableText.includes(term))) {
    score -= 18;
  }
  if (niche.includes('true crime') && /\b(police line|police tape|crime scene tape)\b/.test(searchableText) && !/\b(police line|police tape|crime scene tape)\b/.test(sceneSearchText)) {
    score -= 16;
  }
  if (niche.includes('true crime') && caseTime === 'night') {
    if (hasNightSignal(searchableText)) score += timeSensitiveLocation ? 45 : 18;
    if (hasDaySignal(searchableText)) score -= timeSensitiveLocation ? 35 : 10;
    if (timeSensitiveLocation && !hasNightSignal(searchableText)) score -= 25;
  }
  if (niche.includes('true crime') && caseTime === 'day') {
    if (hasDaySignal(searchableText)) score += timeSensitiveLocation ? 35 : 18;
    if (hasNightSignal(searchableText)) score -= timeSensitiveLocation ? 30 : 10;
  }
  if (niche.includes('finance') && /\b(money|cash|bank|finance|stock|investment|budget|coin|debt|bill)\b/.test(searchableText)) {
    score += 6;
  }
  return score;
}

function getNicheSelectionGuidance(niche = '') {
  const key = niche.toLowerCase();
  if (key.includes('history')) return 'The selected niche is history (vintage): choose the most literal real archival or documentary visual for this exact scene, not a fixed copied template. Fast list/fact scenes can use punchier visuals; emotional or explanatory scenes can hold stronger archival photos, documents, newspapers, maps, charts, vintage ads/product labels, food or household closeups, period streets, homes, crowds, and government scenes when they fit. Variety matters; avoid choosing the same kind of generic vintage family/street image repeatedly.';
  if (key.includes('true crime')) return 'The selected niche is true crime: prefer the most literal real case photograph or document. If caseTitle is provided, candidates matching that case title should beat generic dark visuals or unrelated video. Exact people, places, case names, court evidence, mugshots, newspaper photos, and real locations matter most.';
  if (key.includes('motivational')) return 'The selected niche is motivational: prefer cinematic real photographs that show effort, action, progress, ambition, training, and success.';
  if (key.includes('self improvement')) return 'The selected niche is self improvement: prefer real photographs of routines, habits, planning, reading, working, training, and focus.';
  if (key.includes('finance')) return 'The selected niche is personal finance and investing: prefer real photographs of money, banks, charts, bills, ledgers, stores, homes, and financial documents.';
  return niche ? `The selected niche is ${niche}: use it when choosing the most literal real-image candidate.` : '';
}

function getTrueCrimeCaseTimeGuidance(scene?: SelectionScene) {
  const niche = scene?.niche || '';
  if (!niche.toLowerCase().includes('true crime')) return '';
  const caseTime = normalizeCaseTimePreference(scene?.caseTime);
  if (caseTime === 'night') {
    return 'Case time preference is night: when selecting location, road, house, vehicle, street, search, or evidence-location visuals, prefer candidates that visibly fit nighttime, after dark, midnight, or dark conditions. Do not reject accurate mugshots, documents, posters, maps, or court records just because they are not night images.';
  }
  if (caseTime === 'day') {
    return 'Case time preference is day: when selecting location, road, house, vehicle, street, search, or evidence-location visuals, prefer candidates that visibly fit daylight, daytime, morning, or afternoon. Do not reject accurate mugshots, documents, posters, maps, or court records just because they are not day images.';
  }
  return '';
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.CLAUDE_STORYBOARD_API_KEY
    || process.env.CLAUDE_EDIT_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Claude media selection is not configured.' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const scene = body.scene as SelectionScene | undefined;
    const usedAssetCounts = usageMapFromRecord(body.usedAssetCounts);
    const maxReuse = typeof body.maxReuse === 'number' && Number.isFinite(body.maxReuse)
      ? body.maxReuse
      : MAX_STORYBOARD_ASSET_REUSE;
    const rawCandidates = Array.isArray(body.candidates)
      ? (body.candidates as ResultItem[])
        .map((candidate) => withMediaRights(candidate))
        .filter((candidate) => !isGeneratedOrIllustrativeCandidate(candidate))
        .filter((candidate) => !isVisuallyUnsafeForScene(candidate, {
          sceneText: scene?.text,
          query: scene?.query,
          visualConcept: scene?.visualConcept,
          niche: scene?.niche,
        }))
        .filter(canAutoUseMedia)
      : [];
    const sceneSearchText = [scene?.query || '', scene?.visualConcept || '', scene?.text || ''].join(' ');
    const caseTime = normalizeCaseTimePreference(scene?.caseTime);
    const timeSensitiveLocation = Boolean(scene?.niche?.toLowerCase().includes('true crime')) && isTrueCrimeLocationScene(sceneSearchText);
    const timeMatchedCandidates = timeSensitiveLocation && caseTime === 'night'
      ? rawCandidates.filter((candidate) => hasNightSignal(actualCandidateText(candidate)))
      : timeSensitiveLocation && caseTime === 'day'
        ? rawCandidates.filter((candidate) => hasDaySignal(actualCandidateText(candidate)))
        : [];
    const scopedCandidates = timeMatchedCandidates.length > 0 ? timeMatchedCandidates : rawCandidates;
    const freshCandidates = scopedCandidates.filter((candidate) => assetUsageCount(usedAssetCounts, candidate) < maxReuse);
    const candidates = (freshCandidates.length > 0 ? freshCandidates : scopedCandidates)
      .sort((left, right) => {
        const usageDelta = assetUsageCount(usedAssetCounts, left) - assetUsageCount(usedAssetCounts, right);
        if (usageDelta !== 0) return usageDelta;
        return scoreCandidateForScene(right, scene) - scoreCandidateForScene(left, scene);
      })
      .slice(0, 10);

    if (!scene || candidates.length === 0) {
      return NextResponse.json({ error: 'No reusable real-photo candidate assets are available for this scene.' }, { status: 400 });
    }

    const fallbackSelection = (reason: string) => NextResponse.json({
      selectedId: candidates[0].id,
      reason,
    });

    if (timeSensitiveLocation && caseTime !== 'unspecified' && timeMatchedCandidates.length > 0) {
      return fallbackSelection(
        `Selected deterministically because this is a true-crime ${caseTime} location scene. ViteVid used the highest-ranked candidate that matches the requested time of day and the visual location terms instead of allowing a generic case image to override it.`,
      );
    }

    const candidateSummary = candidates.map((candidate) => ({
      id: candidate.id,
      source: candidate.source,
      type: candidate.type,
      title: candidate.title,
      year: candidate.year || '',
      description: (candidate.description || '').slice(0, 700),
      tags: [],
      rightsStatus: candidate.rightsStatus || '',
      rightsLabel: candidate.rightsLabel || '',
      rightsNote: candidate.rightsNote || '',
      license: candidate.license || '',
      sourcePageUrl: candidate.sourcePageUrl || candidate.url || '',
      previousUses: assetUsageCount(usedAssetCounts, candidate),
    }));

    const model = process.env.CLAUDE_STORYBOARD_MODEL
      || process.env.CLAUDE_EDIT_MODEL
      || 'claude-opus-4-7';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CLAUDE_MEDIA_SELECTION_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(getChatCompletionsEndpoint(), {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          ...(shouldOmitSamplingParams(model) ? {} : { temperature: 0.15 }),
          messages: [
            {
              role: 'system',
              content: [
                'You select one DuckDuckGo, Bing, or Yahoo visual asset for a short voice-timed YouTube storyboard scene.',
                'Select only an ID from the provided candidate list.',
                'Choose the asset most literally useful for the visible scene, not one that merely shares a vague keyword.',
                'Hard safety rule: never select pornographic, nude, erotic, fetish, adult, or sexually explicit imagery. If any candidate appears adult/NSFW, reject it completely.',
                'Hard relevance rule: do not select cameras, lenses, photographers, wine/alcohol, dead bodies, gore, or crime-scene bodies unless the current scene explicitly says that subject.',
                `Avoid repeated visuals. A candidate with previousUses ${maxReuse} or higher has already hit the reuse limit; choose a candidate with previousUses 0 whenever it is scene-relevant, and previousUses 1 only if it is clearly the best fit.`,
                getNicheSelectionGuidance(scene.niche),
                getTrueCrimeCaseTimeGuidance(scene),
                'Choose the most accurate reusable visual asset available and avoid AI-generated, fantasy, or visibly unrelated material.',
                'Never select AI images, illustrations, icons, clipart, vector art, CGI renders, digital art, concept art, fantasy imagery, logos, or symbolic graphics. Prefer real historical photography and documentary-looking stills from the web search engines.',
                'For true crime, choose the real case image/document/location match whenever available, even if it is a still image and even if another candidate is a video. Do not choose generic horror scenery when case-specific media exists.',
                'If the scene includes caseTitle, treat it as the case anchor. Prefer candidates that visibly match that case name, its people, locations, records, or documents.',
                'Prefer verified-safe or open-license-filtered candidates. Unfiltered-web candidates are allowed only when they are the best visual match, and the reason must mention that the source page needs rights review. If a candidate says needs-review or blocked, do not select it. Keep the license/rights note in mind when choosing.',
                'If preferredType is video but the available candidates are web image results, choose the most literal image instead of failing.',
                'Return only valid JSON matching this TypeScript shape: {"selectedId":string,"reason":string}.',
                'Do not include markdown fences, commentary, or explanatory text.',
              ].join(' '),
            },
            {
              role: 'user',
              content: JSON.stringify({ scene, candidates: candidateSummary }),
            },
          ],
          response_format: { type: 'json_object' },
        }),
      });
    } catch (error) {
      return fallbackSelection(
        isAbortError(error)
          ? 'Claude media selection timed out, so ViteVid used the highest-ranked available visual.'
          : 'Claude media selection was unavailable, so ViteVid used the highest-ranked available visual.',
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return fallbackSelection('Claude media selection returned an error, so ViteVid used the highest-ranked available visual.');
    }

    const providerResponse = await response.json() as Record<string, unknown>;
    let selection: { selectedId?: string; reason?: string };
    try {
      selection = parseJsonObject(extractChatContent(providerResponse)) as {
        selectedId?: string;
        reason?: string;
      };
    } catch {
      return fallbackSelection('Claude media selection returned malformed JSON, so ViteVid used the highest-ranked available visual.');
    }
    const selected = candidates.find((candidate) => candidate.id === selection.selectedId);

    if (!selected || isUnsafeAdultMedia(selected) || isVisuallyUnsafeForScene(selected, {
      sceneText: scene.text,
      query: scene.query,
      visualConcept: scene.visualConcept,
      niche: scene.niche,
    })) {
      return fallbackSelection('Claude selected an unavailable asset, so ViteVid used the highest-ranked available visual.');
    }

    return NextResponse.json({ selectedId: selected.id, reason: selection.reason || '' });
  } catch (error) {
    console.error('Claude media selection failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Claude media selection failed.' },
      { status: 500 },
    );
  }
}
