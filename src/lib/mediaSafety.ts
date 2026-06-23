import { ResultItem } from '@/types';

const ADULT_TEXT_PATTERN = /\b(?:porn|porno|pornographic|pornography|xxx|x-rated|nsfw|nude|nudity|naked|erotic|erotica|sexual|sexually|hardcore|hentai|fetish|onlyfans|escort|brothel|stripper|strip club|breasts?|boobs?|nipples?|vagina|penis|blowjob|masturbat(?:e|ion)|orgasm)\b/i;
const ADULT_URL_PATTERN = /\b(?:pornhub|xvideos|xnxx|xhamster|redtube|youporn|spankbang|brazzers|onlyfans|nudevista|sex\.com|erome|fapello)\b/i;
const UNREQUESTED_CAMERA_PATTERN = /\b(?:camera|cameras|dslr|lens|lenses|photographer|photographers|photography studio|camera shutter|tripod|camcorder)\b/i;
const CAMERA_ALLOWED_PATTERN = /\b(?:camera|cameras|lens|lenses|photo|photos|photograph|photographs|photographer|photography|filming|film camera|shutter|portrait|snapshot)\b/i;
const UNREQUESTED_BODY_PATTERN = /\b(?:dead body|corpse|morgue|autopsy|cadaver|bloody body|murder victim|crime scene body|gore|gruesome)\b/i;
const BODY_ALLOWED_PATTERN = /\b(?:dead|death|died|body|corpse|murder|victim|crime|autopsy|forensic|morgue|killed|killing|true crime)\b/i;
const UNREQUESTED_ALCOHOL_PATTERN = /\b(?:wine|liquor|whiskey|whisky|vodka|beer|champagne|cocktail|bar bottle|alcohol)\b/i;
const ALCOHOL_ALLOWED_PATTERN = /\b(?:wine|liquor|whiskey|whisky|vodka|beer|champagne|cocktail|bar|alcohol|bottle)\b/i;
const UNUSABLE_STOCK_PATTERN = /\b(?:adobe\s*stock|adobestock|stock\.adobe|alamy|shutterstock|getty|istock|dreamstime|depositphotos|123rf|freepik|vecteezy|envato|watermark|watermarked)\b/i;

function mediaText(item: Partial<ResultItem>) {
  return [
    item.source,
    item.title,
    item.description,
    item.year,
    item.url,
    item.sourcePageUrl,
    item.thumbnail,
    item.downloadUrl,
    ...(item.tags || []),
  ].filter(Boolean).join(' ');
}

function sceneText(sceneText = '', query = '', visualConcept = '', niche = '') {
  return [sceneText, query, visualConcept, niche].filter(Boolean).join(' ');
}

export function isUnsafeAdultMedia(item: Partial<ResultItem>) {
  const text = mediaText(item);
  return ADULT_TEXT_PATTERN.test(text) || ADULT_URL_PATTERN.test(text);
}

export function isVisuallyUnsafeForScene(
  item: Partial<ResultItem>,
  options: { sceneText?: string; query?: string; visualConcept?: string; niche?: string } = {},
) {
  if (isUnsafeAdultMedia(item)) return true;
  const candidateText = mediaText(item);
  const context = sceneText(options.sceneText, options.query, options.visualConcept, options.niche);
  if (UNUSABLE_STOCK_PATTERN.test(candidateText)) return true;
  if (UNREQUESTED_CAMERA_PATTERN.test(candidateText) && !CAMERA_ALLOWED_PATTERN.test(context)) return true;
  if (UNREQUESTED_BODY_PATTERN.test(candidateText) && !BODY_ALLOWED_PATTERN.test(context)) return true;
  if (UNREQUESTED_ALCOHOL_PATTERN.test(candidateText) && !ALCOHOL_ALLOWED_PATTERN.test(context)) return true;
  return false;
}

export function mediaSafetyPenalty(
  item: Partial<ResultItem>,
  options: { sceneText?: string; query?: string; visualConcept?: string; niche?: string } = {},
) {
  if (isUnsafeAdultMedia(item)) return -10000;
  return isVisuallyUnsafeForScene(item, options) ? -250 : 0;
}
