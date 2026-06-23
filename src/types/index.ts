export interface ResultItem {
  id: string;
  source: string;
  title: string;
  type: string;
  thumbnail: string;
  url?: string;
  year?: string;
  description?: string;
  downloadUrl: string;
  downloads?: number;
  tags?: string[];
  rightsStatus?: 'verified-safe' | 'open-license-filtered' | 'unfiltered-web' | 'needs-review' | 'blocked';
  rightsLabel?: string;
  rightsNote?: string;
  license?: string;
  licenseUrl?: string;
  attribution?: string;
  sourcePageUrl?: string;
  isCopyrightSafe?: boolean;
  needsRightsReview?: boolean;
}
