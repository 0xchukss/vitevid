import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

const SUBREDDITS = [
  'TrueCrime',
  'TrueCrimeDiscussion',
  'UnresolvedMysteries',
  'ColdCases',
];

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'against',
  'also',
  'been',
  'being',
  'because',
  'before',
  'between',
  'case',
  'crime',
  'could',
  'discussion',
  'does',
  'from',
  'have',
  'into',
  'just',
  'like',
  'missing',
  'more',
  'murder',
  'people',
  'reddit',
  'some',
  'that',
  'their',
  'there',
  'these',
  'they',
  'this',
  'true',
  'unsolved',
  'were',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
]);

interface RedditListingChild {
  data?: {
    id?: unknown;
    subreddit?: unknown;
    title?: unknown;
    selftext?: unknown;
    permalink?: unknown;
    score?: unknown;
    num_comments?: unknown;
    created_utc?: unknown;
  };
}

interface RedditListingResponse {
  data?: {
    children?: RedditListingChild[];
  };
}

interface ResearchPost {
  id: string;
  subreddit: string;
  title: string;
  excerpt: string;
  url: string;
  score: number;
  comments: number;
  createdUtc: number;
}

function normalizeCaseTitle(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function getRedditUserAgent() {
  return process.env.REDDIT_USER_AGENT
    || 'ViteVidTrueCrimeResearch/1.0 by local-vitevid-user';
}

function redactRedditText(value: string) {
  return value
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 420);
}

function titleWords(title: string) {
  return (title.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || [])
    .filter((word) => !STOP_WORDS.has(word));
}

function extractCapitalizedPhrases(text: string) {
  const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,4}\b/g) || [];
  return matches
    .map((value) => value.trim())
    .filter((value) => value.length > 3 && !/^(The|This|That|Reddit|True Crime)$/i.test(value));
}

function rankTerms(posts: ResearchPost[], caseTitle: string) {
  const caseParts = new Set(titleWords(caseTitle));
  const counts = new Map<string, number>();
  const add = (term: string, weight: number) => {
    const clean = term.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    if (clean.length < 3 || clean.length > 64) return;
    if (caseParts.has(clean.toLowerCase())) return;
    counts.set(clean, (counts.get(clean) || 0) + weight);
  };

  posts.forEach((post) => {
    extractCapitalizedPhrases(post.title).forEach((term) => add(term, 4));
    extractCapitalizedPhrases(post.excerpt).forEach((term) => add(term, 1.5));
    titleWords(post.title).forEach((term) => add(term, 1));
  });

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([term]) => term)
    .slice(0, 24);
}

function buildSearchQuery(caseTitle: string) {
  const quoted = `"${caseTitle.replace(/"/g, '')}"`;
  return `${quoted} OR "${caseTitle} case" OR "${caseTitle} mystery"`;
}

async function getRedditAccessToken() {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Reddit research is not configured. Add REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, and REDDIT_USER_AGENT.');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': getRedditUserAgent(),
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });

  if (!response.ok) {
    throw new Error(`Reddit OAuth failed (${response.status}).`);
  }

  const data = await response.json() as { access_token?: unknown };
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('Reddit OAuth did not return an access token.');
  }
  return data.access_token;
}

async function fetchSubredditPosts(subreddit: string, caseTitle: string, token: string) {
  const params = new URLSearchParams({
    q: buildSearchQuery(caseTitle),
    restrict_sr: '1',
    sort: 'relevance',
    t: 'all',
    limit: '8',
    raw_json: '1',
  });
  const response = await fetch(`https://oauth.reddit.com/r/${subreddit}/search?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': getRedditUserAgent(),
    },
  });
  if (!response.ok) return [];

  const listing = await response.json() as RedditListingResponse;
  const children = listing.data?.children || [];
  return children.map((child): ResearchPost | null => {
    const post = child.data || {};
    const title = typeof post.title === 'string' ? redactRedditText(post.title) : '';
    if (!title) return null;
    const permalink = typeof post.permalink === 'string' ? post.permalink : '';
    return {
      id: typeof post.id === 'string' ? post.id : `${subreddit}-${title}`,
      subreddit: typeof post.subreddit === 'string' ? post.subreddit : subreddit,
      title,
      excerpt: typeof post.selftext === 'string' ? redactRedditText(post.selftext) : '',
      url: permalink ? `https://www.reddit.com${permalink}` : `https://www.reddit.com/r/${subreddit}`,
      score: typeof post.score === 'number' ? post.score : 0,
      comments: typeof post.num_comments === 'number' ? post.num_comments : 0,
      createdUtc: typeof post.created_utc === 'number' ? post.created_utc : 0,
    };
  }).filter((post): post is ResearchPost => Boolean(post));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const caseTitle = typeof body.caseTitle === 'string' ? normalizeCaseTitle(body.caseTitle) : '';
    if (caseTitle.length < 3) {
      return NextResponse.json({ error: 'Enter a true-crime case title first.' }, { status: 400 });
    }

    const token = await getRedditAccessToken();
    const nestedPosts = await Promise.all(
      SUBREDDITS.map((subreddit) => fetchSubredditPosts(subreddit, caseTitle, token)),
    );
    const postsById = new Map<string, ResearchPost>();
    nestedPosts.flat().forEach((post) => {
      const existing = postsById.get(post.id);
      if (!existing || existing.score + existing.comments < post.score + post.comments) {
        postsById.set(post.id, post);
      }
    });

    const posts = Array.from(postsById.values())
      .sort((left, right) => (right.score + right.comments) - (left.score + left.comments))
      .slice(0, 12);
    const keyTerms = rankTerms(posts, caseTitle);
    const sourceLinks = posts.slice(0, 6).map((post) => ({
      title: post.title,
      subreddit: post.subreddit,
      url: post.url,
    }));

    return NextResponse.json({
      caseTitle,
      subreddits: SUBREDDITS,
      postsFound: posts.length,
      keyTerms,
      sourceLinks,
      researchContext: [
        `Case title: ${caseTitle}`,
        keyTerms.length > 0 ? `Reddit-derived names, places, evidence terms, and timeline words: ${keyTerms.join(', ')}` : '',
        sourceLinks.length > 0
          ? `Useful Reddit source titles for context only: ${sourceLinks.map((source) => `${source.title} (${source.subreddit})`).join(' | ')}`
          : '',
      ].filter(Boolean).join('\n'),
    });
  } catch (error) {
    console.error('True crime Reddit research failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'True crime Reddit research failed.' },
      { status: 500 },
    );
  }
}
