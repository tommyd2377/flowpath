'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { layoutTransition, revealTransition } from './motion-primitives';
import type { HeadlineItem } from '@/lib/atlas/contracts';
import type { CuratedStory } from '@/lib/story-contracts';
import { ArrowUpRight } from 'lucide-react';

type StoryCard = HeadlineItem & Partial<Pick<CuratedStory, 'summary' | 'whyItMatters' | 'scope' | 'headlines'>>;

type Props = {
  headlines: StoryCard[];
  selectedHeadlineId: string | null;
  spotlightStoryId?: string | null;
  loading: boolean;
  onSelect: (headline: HeadlineItem) => void;
};

function formatDate(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

export default function HeadlineGrid({ headlines, selectedHeadlineId, spotlightStoryId, loading, onSelect }: Props) {
  const reduced = useReducedMotion();
  const grid = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  useEffect(() => {
    if (!spotlightStoryId) return;
    const card = Array.from(grid.current?.querySelectorAll<HTMLElement>('[data-story-id]') ?? [])
      .find(element => element.dataset.storyId === spotlightStoryId);
    if (!card) return;
    // Wait for the opening dock/layout to settle; never move keyboard focus.
    const timer = window.setTimeout(() => {
      const bounds = card.getBoundingClientRect();
      const dockBottom = document.querySelector('.voice-stage')?.getBoundingClientRect().bottom ?? 0;
      if (bounds.top < dockBottom + 16 || bounds.bottom > window.innerHeight - 20) {
        window.scrollBy({ top: bounds.top - dockBottom - 24, behavior: reduced ? 'instant' : 'smooth' });
      }
    }, reduced ? 0 : 700);
    const cancel = () => window.clearTimeout(timer);
    window.addEventListener('voice-scroll', cancel);
    return () => { cancel(); window.removeEventListener('voice-scroll', cancel); };
  }, [spotlightStoryId, reduced]);
  return (
    <section className="news-section" aria-label="Choose a news story" aria-busy={loading}>
      <motion.div ref={grid} layout className="headline-grid" data-spotlighting={Boolean(spotlightStoryId)}><AnimatePresence initial={false}>
        {loading && headlines.length === 0
          ? Array.from({ length: 6 }, (_, index) => <div key={index} className="headline-card headline-skeleton" aria-hidden="true" />)
          : headlines.map((headline, index) => (
            <motion.button
              layout layoutId={`story-${headline.id}`} data-story-id={headline.id}
              initial={reduced ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0, scale: spotlightStoryId === headline.id && !reduced ? 1.025 : 1 }} exit={{ opacity: 0, y: -10 }}
              transition={{ ...revealTransition, delay: reduced ? 0 : Math.min(index, 5) * 0.035, layout: layoutTransition }}
              whileHover={reduced ? undefined : { y: -3 }} whileTap={reduced ? undefined : { scale: 0.99 }}
              style={{ borderRadius: 13 }}
              className="headline-card"
              data-spotlight={spotlightStoryId === headline.id}
              data-expanded={spotlightStoryId === headline.id || hovered === headline.id || focused === headline.id}
              onHoverStart={() => setHovered(headline.id)} onHoverEnd={() => setHovered(null)}
              onFocus={() => setFocused(headline.id)} onBlur={() => setFocused(null)}
              aria-current={spotlightStoryId === headline.id ? true : undefined}
              key={headline.id}
              type="button"
              aria-pressed={selectedHeadlineId === headline.id}
              onClick={() => onSelect(headline)}
            >
              <span className="headline-kicker"><span>{String(index + 1).padStart(2, '0')} <span aria-hidden="true">/</span> {headline.scope === 'us' ? 'U.S. AFFAIRS' : headline.scope === 'both' ? 'U.S. & WORLD' : 'GLOBAL AFFAIRS'}</span><ArrowUpRight size={14} aria-hidden="true" /></span>
              <motion.span layout="position" layoutId={`story-title-${headline.id}`} className="headline-title">{headline.title}</motion.span>
              {(headline.whyItMatters || headline.summary) && <motion.span layout="position" className="headline-context">{headline.whyItMatters || headline.summary}</motion.span>}
              <small>{headline.headlines && headline.headlines.length > 1 ? `${headline.headlines.length} reports` : headline.publisher ?? 'Google News source'} · {formatDate(headline.publishedAt)}</small>
            </motion.button>
          ))}
      </AnimatePresence></motion.div>
    </section>
  );
}
