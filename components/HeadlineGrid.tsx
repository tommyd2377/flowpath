'use client';

import { useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { layoutTransition, revealTransition, useSpotlightScroll, useCardHover } from './motion-primitives';
import type { HeadlineItem } from '@/lib/atlas/contracts';
import { formatStoriesUpdatedAt, type CuratedStory, type StoryCatalogResponse } from '@/lib/story-contracts';
import { ArrowUpRight, RefreshCw } from 'lucide-react';

type StoryCard = HeadlineItem & Partial<Pick<CuratedStory, 'summary' | 'whyItMatters' | 'scope' | 'headlines'>>;

type Props = {
  headlines: StoryCard[];
  selectedHeadlineId: string | null;
  spotlightStoryId?: string | null;
  loading: boolean;
  catalog: StoryCatalogResponse | null;
  storyCatalogId?: string;
  error: string;
  onRefresh: () => void;
  onSelect: (headline: HeadlineItem) => void;
};

function formatDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function sameStoryText(left: string | undefined, right: string | undefined) {
  const normalize = (value: string | undefined) => (value ?? '').toLocaleLowerCase().replace(/[\s\p{P}]+/gu, '');
  return normalize(left) === normalize(right);
}

export default function HeadlineGrid({ headlines, selectedHeadlineId, spotlightStoryId, loading, catalog, storyCatalogId, error, onRefresh, onSelect }: Props) {
  const filling = catalog?.complete === false;
  const reduced = useReducedMotion();
  const grid = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useCardHover();
  const [focused, setFocused] = useState<string | null>(null);
  useSpotlightScroll(grid, spotlightStoryId, reduced);
  return (
    <section className="news-section" data-story-catalog-id={storyCatalogId} aria-label="Choose a news story" aria-busy={loading || filling}>
      <div className="stories-update">
        <span>{catalog ? <>{filling ? 'More stories arriving · ' : catalog.stale ? 'Saved stories from ' : 'Stories updated '}<time dateTime={catalog.fetchedAt}>{formatStoriesUpdatedAt(catalog.fetchedAt)}</time></> : loading ? 'Loading stories…' : 'Stories unavailable'}</span>
        <button type="button" className="stories-refresh" onClick={onRefresh} disabled={loading || filling} aria-label="Refresh stories" title="Refresh stories" aria-busy={loading || filling}>
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      </div>
      {(error || catalog?.warning) && <p className="stories-notice">{error || catalog?.warning}</p>}
      <motion.div ref={grid} layout={!reduced} className="headline-grid" data-spotlighting={Boolean(spotlightStoryId)}><AnimatePresence initial={false}>
        {loading && headlines.length === 0
          ? Array.from({ length: 6 }, (_, index) => <div key={index} className="headline-card headline-skeleton" aria-hidden="true" />)
          : headlines.map((headline, index) => {
            const expanded = spotlightStoryId ? spotlightStoryId === headline.id : hovered === headline.id || focused === headline.id;
            const context = catalog?.curated === false
              ? headline.summary !== headline.title ? headline.summary : ''
              : headline.whyItMatters || headline.summary;
            const summary = headline.summary && !sameStoryText(headline.summary, headline.title) && !sameStoryText(headline.summary, context)
              ? headline.summary : '';
            return (
            <motion.button
              layout={!reduced} layoutId={reduced ? undefined : `story-${headline.id}`} data-story-id={headline.id}
              initial={reduced ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0, scale: spotlightStoryId === headline.id && !reduced ? 1.025 : 1 }} exit={{ opacity: 0, y: -10 }}
              transition={{ ...revealTransition, delay: reduced ? 0 : Math.min(index, 5) * 0.035, layout: layoutTransition }}
              whileHover={reduced ? undefined : { y: -3 }} whileTap={reduced ? undefined : { scale: 0.99 }}
              style={{ borderRadius: 13 }}
              className="headline-card"
              data-spotlight={spotlightStoryId === headline.id}
              data-expanded={expanded}
              onHoverStart={() => setHovered(headline.id)} onHoverEnd={() => setHovered(null)}
              onFocus={() => setFocused(headline.id)} onBlur={() => setFocused(null)}
              aria-current={spotlightStoryId === headline.id ? true : undefined}
              key={headline.id}
              type="button"
              aria-pressed={selectedHeadlineId === headline.id}
              onClick={() => onSelect(headline)}
            >
              <span className="headline-kicker"><span>{String(index + 1).padStart(2, '0')} <span aria-hidden="true">/</span> {headline.scope === 'us' ? 'U.S. AFFAIRS' : headline.scope === 'both' ? 'U.S. & WORLD' : 'GLOBAL AFFAIRS'}</span><ArrowUpRight size={14} aria-hidden="true" /></span>
              <motion.span layout={reduced ? false : 'position'} layoutId={reduced ? undefined : `story-title-${headline.id}`} className="headline-title">{headline.title}</motion.span>
              {context && <motion.span className="card-copy" aria-hidden={!expanded} initial={false} animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }} transition={{ ...revealTransition, duration: reduced ? 0 : 0.45 }}>
                {summary && <span className="headline-mobile-summary"><span className="headline-context-label">The story</span><span className="headline-summary">{summary}</span></span>}
                <span>{summary && <span className="headline-context-label">Why it matters</span>}<span className="headline-context">{context}</span></span>
              </motion.span>}
              <small>{headline.headlines && headline.headlines.length > 1 ? `${headline.headlines.length} reports` : headline.publisher ?? 'Google News source'} · {formatDate(headline.publishedAt)}</small>
            </motion.button>
          ); })}
        {filling && Array.from({ length: Math.max(0, 6 - headlines.length) }, (_, index) => <div key={`pending-${index}`} className="headline-card headline-skeleton" aria-hidden="true" />)}
      </AnimatePresence></motion.div>
    </section>
  );
}
