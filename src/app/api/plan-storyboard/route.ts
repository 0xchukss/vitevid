import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const CLAUDE_STORYBOARD_TIMEOUT_MS = 45000;

interface PlanningSlot {
  text: string;
  contextBefore?: string;
  contextAfter?: string;
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

interface TrueCrimeResearchPayload {
  researchContext?: unknown;
  keyTerms?: unknown;
  sourceLinks?: unknown;
}

type CaseTimePreference = 'unspecified' | 'day' | 'night';

function normalizeCaseTitle(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeCaseTimePreference(value: unknown): CaseTimePreference {
  if (typeof value !== 'string') return 'unspecified';
  const key = value.toLowerCase();
  if (key.includes('night')) return 'night';
  if (key.includes('day')) return 'day';
  return 'unspecified';
}

function isTrueCrimeNiche(niche: string) {
  return niche.toLowerCase().includes('true crime');
}

function withCaseTitle(term: string, niche: string, caseTitle: string) {
  const cleanTerm = term.replace(/\s+/g, ' ').trim();
  const cleanCase = normalizeCaseTitle(caseTitle);
  if (!cleanTerm || !cleanCase || !isTrueCrimeNiche(niche)) return cleanTerm;
  if (cleanTerm.toLowerCase().includes(cleanCase.toLowerCase())) return cleanTerm;
  return `${cleanCase} ${cleanTerm}`;
}

function withCaseTime(term: string, niche: string, caseTime: CaseTimePreference) {
  const cleanTerm = term.replace(/\s+/g, ' ').trim();
  if (!cleanTerm || !isTrueCrimeNiche(niche) || caseTime === 'unspecified') return cleanTerm;
  const lower = cleanTerm.toLowerCase();
  if (/\b(court|courtroom|trial|mugshot|records?|documents?|newspaper|poster|report|file|map|timeline)\b/i.test(lower)) {
    return cleanTerm;
  }
  if (caseTime === 'night') {
    return /\b(night|nighttime|midnight|evening|after dark|dark)\b/i.test(lower)
      ? cleanTerm
      : `${cleanTerm} night`;
  }
  return /\b(daytime|daylight|morning|afternoon|sunny|day scene)\b/i.test(lower)
    ? cleanTerm
    : `${cleanTerm} daylight`;
}

function anchorSearchTermsToCase(
  terms: string[],
  niche: string,
  caseTitle: string,
  caseTime: CaseTimePreference = 'unspecified',
) {
  return Array.from(new Set(
    terms
      .map((term) => withCaseTitle(term, niche, caseTitle))
      .map((term) => withCaseTime(term, niche, caseTime))
      .filter(Boolean),
  )).slice(0, 3);
}

function getNicheGuidance(niche: string) {
  const key = niche.toLowerCase();
  if (key.includes('history')) {
    return [
      'Niche: history (vintage). Let this exact narration determine the edit feel. Use real archival photos, old newsreel or AP-style footage stills, old film frames, historic streets, newspaper headlines, documents, maps, charts, vintage ads, product labels, food/object closeups, government buildings, crowds, homes, kitchens, and period objects only when they literally fit the current scene.',
      'For history search terms, prefer literal visible assets that support the moment: archival film still, black and white newsreel, old newspaper headline, old government document, vintage chart, historic map, vintage product ad, old kitchen cooking photo, vintage food close up, or real period photograph when those match the narration.',
      'Use words like vintage, archival, historic photo, old news footage still, old film still, 1920s, 1930s, 1940s, 1950s, black and white only when they help find era-appropriate visuals. Avoid repeating only generic vintage photo terms across every scene.',
    ].join(' ');
  }
  if (key.includes('true crime')) {
    return [
      'Niche: true crime. Prefer exact real-case photographic search terms using the case name, victim, suspect, location, year, court, police department, documents, mugshots, trial evidence, missing-person posters, newspaper photos, and actual places mentioned in narration.',
      'True crime can hold one strong real image for 10 to 15 seconds when it fits the case. Do not force rapid scene changes; prioritize literal case accuracy, readable documents, and tense documentary pacing over generic scary imagery.',
    ].join(' ');
  }
  if (key.includes('motivational')) {
    return 'Niche: motivational. Prefer cinematic real-photo search terms showing effort, setbacks, discipline, training, work, ambition, progress, and success without becoming abstract.';
  }
  if (key.includes('self improvement')) {
    return 'Niche: self improvement. Prefer real-photo search terms for habits, routines, journaling, reading, workouts, planning, focused work, meditation, and lifestyle change.';
  }
  if (key.includes('finance')) {
    return 'Niche: personal finance and investing. Prefer real-photo search terms for cash, coins, banks, bills, ledgers, investing charts, budgeting, savings, debt, homes, stores, and financial documents.';
  }
  return niche ? `Niche: ${niche}. Use the niche to choose literal DuckDuckGo, Bing, and Yahoo image-search terms.` : '';
}

function fallbackTermsForSlot(
  text: string,
  niche: string,
  caseTitle = '',
  caseTime: CaseTimePreference = 'unspecified',
) {
  const words = Array.from(new Set(
    (text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [])
      .filter((word) => ![
        'and', 'the', 'that', 'this', 'with', 'from', 'into', 'were', 'was', 'are',
        'his', 'her', 'their', 'there', 'then', 'than', 'when', 'what', 'which',
      ].includes(word)),
  ));
  const subject = words.slice(0, 3).join(' ') || 'people';
  const key = niche.toLowerCase();
  if (key.includes('history')) return [`${subject} vintage photograph`, `${subject} archival photo`, 'vintage american photo'];
  if (key.includes('true crime')) {
    return anchorSearchTermsToCase(
      [`${subject} real case photo`, `${subject} crime scene photo`, 'court records evidence photo'],
      niche,
      caseTitle,
      caseTime,
    );
  }
  if (key.includes('motivational')) return [`${subject} cinematic real photo`, 'person working hard photo', 'success documentary photo'];
  if (key.includes('self improvement')) return [`${subject} habits real photo`, 'focused work desk photo', 'morning routine real photo'];
  if (key.includes('finance')) return [`${subject} money photo`, 'counting money real photo', 'financial documents photo'];
  return [subject, `${subject} real photo`, 'people documentary photo'];
}

function createFallbackPlan(
  slot: PlanningSlot,
  index: number,
  startSceneNumber: number,
  niche: string,
  caseTitle = '',
  caseTime: CaseTimePreference = 'unspecified',
): PlannedScene {
  const text = slot.text.trim();
  const searchTerms = fallbackTermsForSlot(text, niche, caseTitle, caseTime).slice(0, 3);
  return {
    scene_number: startSceneNumber + index,
    scene_text: text,
    duration_seconds: Math.max(0.1, Number((slot.narrationEnd - slot.narrationStart).toFixed(2))),
    visual_description: text || searchTerms[0],
    search_terms: searchTerms,
  };
}

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

function isPlannedScene(scene: unknown): scene is PlannedScene {
  if (!scene || typeof scene !== 'object') return false;
  const value = scene as Record<string, unknown>;
  return typeof value.scene_number === 'number'
    && typeof value.scene_text === 'string'
    && typeof value.duration_seconds === 'number'
    && value.duration_seconds > 0
    && value.duration_seconds <= 30
    && typeof value.visual_description === 'string'
    && Array.isArray(value.search_terms)
    && value.search_terms.length >= 2
    && value.search_terms.length <= 3
    && value.search_terms.every((term) => typeof term === 'string' && term.trim().length > 0);
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.CLAUDE_STORYBOARD_API_KEY
    || process.env.CLAUDE_EDIT_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Claude storyboard planning is not configured. Add CLAUDE_STORYBOARD_API_KEY on the server.' },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const slots = Array.isArray(body.scenes) ? body.scenes as PlanningSlot[] : [];
    const startSceneNumber = Number.isFinite(body.startSceneNumber) ? body.startSceneNumber : 1;
    const niche = typeof body.niche === 'string' ? body.niche : '';
    const caseTitle = typeof body.caseTitle === 'string' ? normalizeCaseTitle(body.caseTitle) : '';
    const caseTime = normalizeCaseTimePreference(body.caseTime);
    const mediaPreference = typeof body.mediaPreference === 'string' ? body.mediaPreference : 'video';
    const trueCrimeResearch = body.trueCrimeResearch && typeof body.trueCrimeResearch === 'object'
      ? body.trueCrimeResearch as TrueCrimeResearchPayload
      : null;
    const trueCrimeResearchContext = typeof trueCrimeResearch?.researchContext === 'string'
      ? trueCrimeResearch.researchContext.slice(0, 3000)
      : '';
    const trueCrimeResearchTerms = Array.isArray(trueCrimeResearch?.keyTerms)
      ? trueCrimeResearch.keyTerms
        .filter((term): term is string => typeof term === 'string' && term.trim().length > 0)
        .slice(0, 24)
      : [];
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
    const fullTranscript = typeof body.fullTranscript === 'string' && body.fullTranscript.trim()
      ? body.fullTranscript.replace(/\s+/g, ' ').trim().slice(0, 45000)
      : scriptText;
    const totalSceneCount = Number.isFinite(body.totalSceneCount)
      ? Math.max(slots.length, Math.floor(Number(body.totalSceneCount)))
      : slots.length;
    const slotDurations = slots.map((slot) => Number((slot.narrationEnd - slot.narrationStart).toFixed(2)));
    const contextSlots = slots.map((slot, index) => ({
      order: index + 1,
      text: slot.text,
      contextBefore: slot.contextBefore || slots[index - 1]?.text || '',
      contextAfter: slot.contextAfter || slots[index + 1]?.text || '',
      durationSeconds: slotDurations[index],
    }));
    const model = process.env.CLAUDE_STORYBOARD_MODEL
      || process.env.CLAUDE_EDIT_MODEL
      || 'claude-opus-4-7';
    const instructions = [
      'You are a video production assistant. Analyze a video script and break it down into scenes for a YouTube long-form video.',
      'Each output scene represents one provided voiceover transcript slot. Keep the exact provided timing and do not merge or split slots.',
      'Preserve every spoken word exactly once across scene_text fields, in the same order. Do not paraphrase or invent narration.',
      'Identify the visual content that best fits each moment in visual_description.',
      'Generate exactly 3 specific search terms optimized for DuckDuckGo, Bing, and Yahoo image search.',
      'DuckDuckGo, Bing, and Yahoo are used for every niche, so each query must carry the selected niche context through concrete visual words.',
      'Search terms should prefer real-world photographic results and archival/vintage visuals over illustrations, AI images, icons, or generic stock phrases. Write each term as the best likely web image query, not a caption or a sentence.',
      'For history (vintage), do not copy a fixed template from another video. Read this specific narration and choose the best contextual visual idea for each moment: quick factual/list moments can use punchier visual subjects, while emotional, documentary, or explanatory moments can use stronger archival holds. Ask for a varied mix of archival footage stills, old TV/news frames, documents, maps, newspaper headlines, vintage ads, charts, food/product closeups, household objects, and period photos only where they match the spoken moment.',
      'For history (vintage), short fragment slots are intentional fast-paced visual beats from the voiceover. If the slot is a year, choose a timeline/newspaper/date-card query; if it is a person/subject fragment, choose the person or demographic; if it is an object/action fragment, choose that object/action; if it is a location fragment, choose a map, street, city, county, or state visual. Use contextBefore/contextAfter to know what the fragment belongs to, but keep scene_text exactly equal to the current slot.',
      'For true crime, search terms must aggressively preserve exact case nouns: names, locations, dates, court terms, evidence types, documents, mugshots, crime scene, police, trial, victim, suspect, and newspaper whenever those words are present.',
      isTrueCrimeNiche(niche) && caseTitle
        ? `True crime case title hard anchor: "${caseTitle}". Include this exact case title, or a natural exact variant of it, in every search_terms entry unless the current slot names a more specific person or location inside that same case.`
        : '',
      isTrueCrimeNiche(niche) && caseTime === 'night'
        ? 'True crime case time preference: night. For real locations, roads, houses, scenes, vehicles, woods, streets, searches, or evidence-location visuals, include night, nighttime, after dark, midnight, or dark only where it improves image matching. Do not force night words onto mugshots, court records, posters, maps, or documents.'
        : '',
      isTrueCrimeNiche(niche) && caseTime === 'day'
        ? 'True crime case time preference: day. For real locations, roads, houses, scenes, vehicles, woods, streets, searches, or evidence-location visuals, include daylight, daytime, morning, or afternoon only where it improves image matching. Do not force day words onto mugshots, court records, posters, maps, or documents.'
        : '',
      isTrueCrimeNiche(niche) && trueCrimeResearchContext
        ? 'A Reddit research summary is provided only to identify likely names, locations, evidence terms, timeline words, and community-known case phrases. Use it to improve search keywords, but do not copy Reddit wording into scene_text and do not treat Reddit theories as confirmed facts.'
        : '',
      'For true crime, avoid generic horror terms unless the narration literally says them. A correct real case photo is better than a dramatic but unrelated image.',
      'Use contextBefore and contextAfter to understand very short fragments and generate better visual search terms, but keep each scene_text equal to the current text only.',
      'Use full_transcript_context to understand the entire voiceover arc and choose better visual subjects for short slots. Do not change the provided scene count or timing.',
      'Search terms must be literal visible subjects, places, documents, people, objects, or actions from the narration. Use plain stock-library phrases, not metaphors.',
      'Do not invent unrelated objects or actions. If the scene is abstract, choose the closest concrete real-world visual from the spoken words.',
      getNicheGuidance(niche),
      'Prefer exact proper nouns, years, document names, locations, and visible nouns when they appear in the narration.',
      'Use period or American context only where it helps find the right media; do not repeat generic style phrases across every scene.',
      retryForNoResults
        ? 'The previous terms returned no results. Choose broad substitute visuals likely to exist in web image search, using simple concrete phrases. Preserve the core subject and action of the narration: for money use cash, bills, coins, ledgers, wallets, or banks; for government use courthouse, capitol, papers, or officials. Never invent unrelated chores, objects, or actions. Do not include brand names or abstract financial/political concepts.'
        : '',
      'Avoid abstract phrases, platform names, and non-American locations unless the script explicitly requires them.',
      `Return exactly ${slots.length} scenes, numbered consecutively beginning at ${startSceneNumber}.`,
      'Use the requested duration for each corresponding timeline slot.',
      'Return only valid JSON matching this TypeScript shape: {"scenes":[{"scene_number":number,"scene_text":string,"duration_seconds":number,"visual_description":string,"search_terms":[string,string,string]}]}.',
      'Do not include markdown fences, commentary, or explanatory text.',
    ].filter(Boolean).join(' ');
    const fallbackPlans = slots.map((slot, index) => createFallbackPlan(slot, index, startSceneNumber, niche, caseTitle, caseTime));
    const modelCandidates = Array.from(new Set([
      model,
      process.env.CLAUDE_STORYBOARD_FALLBACK_MODEL,
    ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)));
    let providerResponse: Record<string, unknown> | null = null;
    let lastFailureStatus = 500;
    let lastFailureMessage = 'Claude storyboard planning request failed.';

    for (const candidateModel of modelCandidates) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CLAUDE_STORYBOARD_TIMEOUT_MS);
      try {
        const response = await fetch(getChatCompletionsEndpoint(), {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: candidateModel,
            ...(shouldOmitSamplingParams(candidateModel) ? {} : { temperature: retryForNoResults ? 0.35 : 0.25 }),
            messages: [
              { role: 'system', content: instructions },
              {
                role: 'user',
                content: JSON.stringify({
                  script_text: scriptText,
                  niche,
                  case_title: caseTitle,
                  case_time_preference: isTrueCrimeNiche(niche) ? caseTime : undefined,
                  true_crime_research_context: trueCrimeResearchContext || undefined,
                  true_crime_research_terms: trueCrimeResearchTerms.length > 0 ? trueCrimeResearchTerms : undefined,
                  full_transcript_context: fullTranscript,
                  preferred_media_type: mediaPreference === 'image' ? 'image' : 'video',
                  context_slots: contextSlots,
                  scene_count: slots.length,
                  total_scene_count: totalSceneCount,
                  start_scene_number: startSceneNumber,
                  duration_seconds_by_scene: slotDurations,
                  failed_search_terms: retryForNoResults ? failedSearchTerms : undefined,
                  required_json_keys: [
                    'scene_number',
                    'scene_text',
                    'duration_seconds',
                    'visual_description',
                    'search_terms',
                  ],
                }),
              },
            ],
            response_format: { type: 'json_object' },
          }),
        });

        if (response.ok) {
          providerResponse = await response.json() as Record<string, unknown>;
          break;
        }

        const failure = await response.json().catch(() => ({}));
        lastFailureStatus = response.status;
        lastFailureMessage = `${candidateModel}: ${
          (failure as { error?: { message?: string } })?.error?.message
            || `Claude storyboard planning request failed with HTTP ${response.status}.`
        }`;
      } catch (error) {
        lastFailureStatus = isAbortError(error) ? 504 : 502;
        lastFailureMessage = `${candidateModel}: ${
          isAbortError(error)
            ? `Claude storyboard planning timed out after ${Math.round(CLAUDE_STORYBOARD_TIMEOUT_MS / 1000)} seconds.`
            : error instanceof Error ? error.message : 'Claude storyboard planning request failed.'
        }`;
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!providerResponse) {
      console.warn('Claude storyboard planning fell back:', lastFailureStatus, lastFailureMessage);
      return NextResponse.json(fallbackPlans);
    }
    let parsed: { scenes?: unknown[] };
    try {
      parsed = parseJsonObject(extractChatContent(providerResponse)) as { scenes?: unknown[] };
    } catch (error) {
      console.warn('Claude storyboard planning returned malformed JSON, using fallback plans:', error);
      return NextResponse.json(fallbackPlans);
    }
    const plannedScenes = (parsed.scenes || [])
      .filter(isPlannedScene)
      .map((scene) => ({
        ...scene,
        search_terms: anchorSearchTermsToCase(scene.search_terms, niche, caseTitle, caseTime),
      }));

    const plannedByNumber = new Map(plannedScenes.map((scene) => [scene.scene_number, scene]));
    const completedScenes = slots.map((slot, index) => {
      const sceneNumber = startSceneNumber + index;
      return plannedByNumber.get(sceneNumber) || createFallbackPlan(slot, index, startSceneNumber, niche, caseTitle, caseTime);
    });

    return NextResponse.json(completedScenes);
  } catch (error) {
    console.error('Claude storyboard planning failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Claude storyboard planning failed.' },
      { status: 500 },
    );
  }
}
