import type { HeadlineItem } from '@/lib/atlas/contracts';

const STORAGE_KEY = 'the-voice.exploration.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SavedExploration = { installationId: string; selectedHeadline: HeadlineItem | null };
let saved: SavedExploration | undefined;

export function isHeadline(value: unknown): value is HeadlineItem {
  if (!value || typeof value !== 'object') return false;
  const headline = value as Partial<HeadlineItem>;
  return typeof headline.id === 'string' && headline.id.length >= 8 && headline.id.length <= 64
    && typeof headline.title === 'string' && headline.title.length > 0 && headline.title.length <= 240
    && (headline.publisher === null || typeof headline.publisher === 'string')
    && (headline.publishedAt === null || (typeof headline.publishedAt === 'string' && Number.isFinite(Date.parse(headline.publishedAt))))
    && typeof headline.googleNewsUrl === 'string';
}

function load(): SavedExploration {
  if (saved) return saved;
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (value && typeof value.installationId === 'string' && UUID.test(value.installationId)) {
      saved = { installationId: value.installationId, selectedHeadline: isHeadline(value.selectedHeadline) ? value.selectedHeadline : null };
      return saved;
    }
  } catch { /* Private browsing may make storage unavailable. Keep this visit usable. */ }
  saved = { installationId: crypto.randomUUID(), selectedHeadline: null };
  persist(saved);
  return saved;
}

function persist(value: SavedExploration) {
  saved = value;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* Retain the reference for this visit. */ }
}

export function getInstallationId() {
  return load().installationId;
}

export function loadSelectedHeadline() {
  return load().selectedHeadline;
}

export function saveSelectedHeadline(selectedHeadline: HeadlineItem | null) {
  persist({ installationId: getInstallationId(), selectedHeadline });
}
