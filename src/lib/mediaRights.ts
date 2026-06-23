import { ResultItem } from '@/types';

export type RightsStatus = NonNullable<ResultItem['rightsStatus']>;

const BLOCKED_HOST_PATTERNS = [
  /(^|\.)stock\.adobe\.com$/,
  /(^|\.)adobe\.com$/,
  /(^|\.)alamy\.com$/,
  /(^|\.)shutterstock\.com$/,
  /(^|\.)gettyimages\.com$/,
  /(^|\.)istockphoto\.com$/,
  /(^|\.)dreamstime\.com$/,
  /(^|\.)depositphotos\.com$/,
  /(^|\.)123rf\.com$/,
  /(^|\.)pinterest\./,
  /(^|\.)slideplayer\.com$/,
  /(^|\.)slideshare\.net$/,
];

const PUBLIC_DOMAIN_HOST_PATTERNS = [
  /(^|\.)loc\.gov$/,
  /(^|\.)archives\.gov$/,
  /(^|\.)nara\.gov$/,
  /(^|\.)nasa\.gov$/,
  /(^|\.)noaa\.gov$/,
  /(^|\.)usgs\.gov$/,
  /(^|\.)cdc\.gov$/,
  /(^|\.)nih\.gov$/,
  /(^|\.)defense\.gov$/,
  /(^|\.)army\.mil$/,
  /(^|\.)navy\.mil$/,
  /(^|\.)af\.mil$/,
  /(^|\.)marines\.mil$/,
];

const OPEN_ARCHIVE_HOST_PATTERNS = [
  /(^|\.)archive\.org$/,
  /(^|\.)commons\.wikimedia\.org$/,
  /(^|\.)upload\.wikimedia\.org$/,
  /(^|\.)wikimedia\.org$/,
  /(^|\.)wikipedia\.org$/,
  /(^|\.)europeana\.eu$/,
];

const FILTERED_REVIEW_HOST_PATTERNS = [
  /(^|\.)flickr\.com$/,
  /(^|\.)staticflickr\.com$/,
  /(^|\.)live\.staticflickr\.com$/,
];

const BLOCKED_RIGHTS_TEXT_PATTERN = /\b(all rights reserved|editorial use only|rights managed|not for commercial|non[-\s]?commercial|no derivatives|no[-\s]?derivatives|cc[-\s]?by[-\s]?nc|cc[-\s]?by[-\s]?nd|copyright protected|unauthori[sz]ed use prohibited)\b/i;
const PUBLIC_DOMAIN_TEXT_PATTERN = /\b(public domain|cc0|creative commons zero|u\.?s\.? government work|work of the united states government|no known copyright restrictions)\b/i;
const OPEN_LICENSE_TEXT_PATTERN = /\b(creative commons|cc[-\s]?by|cc[-\s]?by[-\s]?sa|reuse allowed|commercial use allowed|open access|free to use and share|free to share and use)\b/i;

function getHost(value?: string) {
  if (!value) return '';
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function matchesAnyHost(hosts: string[], patterns: RegExp[]) {
  return hosts.some((host) => patterns.some((pattern) => pattern.test(host)));
}

function collectHosts(item: Partial<ResultItem>) {
  return [
    getHost(item.url),
    getHost(item.sourcePageUrl),
    getHost(item.thumbnail),
    getHost(item.downloadUrl),
  ].filter(Boolean);
}

function searchableRightsText(item: Partial<ResultItem>) {
  return [
    item.source,
    item.title,
    item.description,
    item.license,
    item.rightsLabel,
    item.rightsNote,
  ].filter(Boolean).join(' ');
}

function baseAttribution(item: Partial<ResultItem>) {
  return item.attribution
    || [item.title, item.source].filter(Boolean).join(' - ')
    || item.source
    || 'Unknown source';
}

export function withMediaRights(
  item: ResultItem,
  options: { providerFiltered?: boolean; allowUnfilteredWeb?: boolean } = {},
): ResultItem {
  const hosts = collectHosts(item);
  const rightsText = searchableRightsText(item);
  const source = (item.source || '').toLowerCase();
  const providerFiltered = options.providerFiltered ?? ['duckduckgo', 'bing', 'yahoo'].includes(source);
  const sourcePageUrl = item.sourcePageUrl || item.url || item.downloadUrl;

  if (item.rightsStatus === 'blocked'
    || BLOCKED_RIGHTS_TEXT_PATTERN.test(rightsText)
    || matchesAnyHost(hosts, BLOCKED_HOST_PATTERNS)) {
    return {
      ...item,
      sourcePageUrl,
      rightsStatus: 'blocked',
      rightsLabel: 'Blocked rights',
      rightsNote: 'Blocked because the source or license text indicates stock, editorial-only, noncommercial, no-derivatives, or otherwise restricted use.',
      isCopyrightSafe: false,
      needsRightsReview: true,
      attribution: baseAttribution(item),
    };
  }

  if (PUBLIC_DOMAIN_TEXT_PATTERN.test(rightsText) || matchesAnyHost(hosts, PUBLIC_DOMAIN_HOST_PATTERNS)) {
    return {
      ...item,
      sourcePageUrl,
      rightsStatus: 'verified-safe',
      rightsLabel: 'Verified open',
      rightsNote: 'Public-domain or U.S. federal/public archive source. Check the source page for third-party credit lines before publishing.',
      license: item.license || 'Public domain / no known copyright restrictions',
      licenseUrl: item.licenseUrl || 'https://creativecommons.org/publicdomain/mark/1.0/',
      isCopyrightSafe: true,
      needsRightsReview: false,
      attribution: baseAttribution(item),
    };
  }

  if (OPEN_LICENSE_TEXT_PATTERN.test(rightsText) || matchesAnyHost(hosts, OPEN_ARCHIVE_HOST_PATTERNS)) {
    return {
      ...item,
      sourcePageUrl,
      rightsStatus: 'verified-safe',
      rightsLabel: 'Open license',
      rightsNote: 'Open-license archive result. Keep attribution metadata with the exported project.',
      license: item.license || 'Creative Commons / open license',
      licenseUrl: item.licenseUrl || 'https://creativecommons.org/licenses/by/4.0/',
      isCopyrightSafe: true,
      needsRightsReview: false,
      attribution: baseAttribution(item),
    };
  }

  if (options.allowUnfilteredWeb || item.rightsStatus === 'unfiltered-web') {
    return {
      ...item,
      sourcePageUrl,
      rightsStatus: 'unfiltered-web',
      rightsLabel: 'Unfiltered web',
      rightsNote: 'Found without search-engine license filtering. Use only when you have reviewed the source page and publishing rights for the final video.',
      license: item.license || 'Unfiltered web result - review source rights',
      isCopyrightSafe: false,
      needsRightsReview: true,
      attribution: baseAttribution(item),
    };
  }

  if (matchesAnyHost(hosts, FILTERED_REVIEW_HOST_PATTERNS) && providerFiltered) {
    return {
      ...item,
      sourcePageUrl,
      rightsStatus: 'open-license-filtered',
      rightsLabel: 'License-filtered',
      rightsNote: 'Found through a commercial-reuse license filter. Verify the original source page if this becomes a final export asset.',
      license: item.license || 'Search-engine commercial reuse filter',
      isCopyrightSafe: true,
      needsRightsReview: true,
      attribution: baseAttribution(item),
    };
  }

  if (providerFiltered) {
    return {
      ...item,
      sourcePageUrl,
      rightsStatus: 'open-license-filtered',
      rightsLabel: 'License-filtered',
      rightsNote: 'Found through DuckDuckGo/Bing/Yahoo commercial-reuse filters. Search engines can be wrong, so verify the source page before final publishing.',
      license: item.license || 'Search-engine commercial reuse filter',
      isCopyrightSafe: true,
      needsRightsReview: true,
      attribution: baseAttribution(item),
    };
  }

  return {
    ...item,
    sourcePageUrl,
    rightsStatus: 'needs-review',
    rightsLabel: 'Review rights',
    rightsNote: 'No reusable license was detected. Review the original source before downloading or exporting.',
    isCopyrightSafe: false,
    needsRightsReview: true,
    attribution: baseAttribution(item),
  };
}

export function isBlockedByRights(item: Partial<ResultItem>) {
  if (item.rightsStatus === 'unfiltered-web') return false;
  return item.rightsStatus === 'blocked' || item.isCopyrightSafe === false && item.needsRightsReview === true;
}

export function canAutoUseMedia(item: Partial<ResultItem>) {
  return item.rightsStatus === 'verified-safe'
    || item.rightsStatus === 'open-license-filtered'
    || item.rightsStatus === 'unfiltered-web'
    || item.isCopyrightSafe === true;
}

export function mediaRightsScore(item: Partial<ResultItem>) {
  if (item.rightsStatus === 'verified-safe') return 16;
  if (item.rightsStatus === 'open-license-filtered') return item.needsRightsReview ? 7 : 10;
  if (item.rightsStatus === 'unfiltered-web') return 3;
  if (item.rightsStatus === 'needs-review') return -20;
  if (item.rightsStatus === 'blocked') return -100;
  return 0;
}
