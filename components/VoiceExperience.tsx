'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { InterfaceMotion, MotionView, revealTransition } from './motion-primitives';
import Waveform from './Waveform';
import PersonalFooter from './PersonalFooter';
import HeadlineGrid from './HeadlineGrid';
import ExplorationPanel from './ExplorationPanel';
import { useVoiceSession } from '@/lib/use-voice-session';
import type { HeadlineItem } from '@/lib/atlas/contracts';
import { loadSelectedHeadline, saveSelectedHeadline } from '@/lib/news-storage';
import { StoryCatalogResponseSchema, type CuratedStory } from '@/lib/story-contracts';

const captions = {
  idle: 'A little space to think out loud.',
  connecting: 'Making a connection…',
  listening: 'I’m listening.',
  thinking: 'A moment of thought.',
  speaking: 'The Voice is speaking.',
  error: 'Let’s try that again.',
};

export default function VoiceExperience() {
  const { phase, message, inputAnalyser, outputAnalyser, start, stop, selectStory, display, act, sessionActive, researchBusy } = useVoiceSession();
  const [entered, setEntered] = useState(false);
  const [headlines, setHeadlines] = useState<CuratedStory[]>([]);
  const [savedHeadline, setSavedHeadline] = useState<HeadlineItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedMessage, setFeedMessage] = useState('');
  const stage = useRef<HTMLDivElement>(null);
  const focusAfterAction = useRef(false);
  const reducedMotion = useReducedMotion();
  const exploring = display?.view === 'exploration';
  const active = sessionActive;
  const selectedHeadline = display ? display.headline : savedHeadline;
  const docked = entered || active || exploring;
  const hideCopy = docked;
  const showNotice = hideCopy && !active && phase === 'error' && Boolean(message);
  const label = phase === 'connecting' ? 'Cancel connection' : active ? 'End conversation' : 'Start conversation';

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setSavedHeadline(loadSelectedHeadline());
    });
    void fetch('/api/stories', { cache: 'no-store', signal: controller.signal }).then(async (response) => {
      const parsed = StoryCatalogResponseSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error('Stories are unavailable. Refresh the page to try again.');
      if (controller.signal.aborted) return;
      const body = parsed.data;
      const items = body.items;
      setHeadlines(items);
      setFeedMessage(items.length === 0 ? 'No stories are available right now. Refresh the page to try again.'
        : typeof body.warning === 'string' && body.warning ? body.warning
          : body.stale ? 'Showing the latest saved stories.' : '');
    }).catch(() => {
      if (!controller.signal.aborted) setFeedMessage('Stories are unavailable. Refresh the page to try again.');
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (display?.headline) saveSelectedHeadline(display.headline);
  }, [display?.headline]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (!focusAfterAction.current) return;
    focusAfterAction.current = false;
    const timer = window.setTimeout(() => {
      const selector = display?.view !== 'exploration'
        ? `[data-story-id="${CSS.escape(display?.headline?.id ?? '')}"]`
        : display?.exploration?.currentNode?.id
          ? '[data-motion-section="ScenarioDetail"] h3'
          : '[data-motion-section="StoryOverview"] h2';
      const destination = document.querySelector<HTMLElement>(`.dashboard-view:not([aria-hidden="true"]) ${selector}`);
      destination?.focus({ preventScroll: true });
      if (display?.view !== 'exploration') destination?.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'instant' : 'smooth' });
    }, reducedMotion ? 0 : 520);
    return () => window.clearTimeout(timer);
  }, [display?.view, display?.headline?.id, display?.exploration?.currentNode?.id, reducedMotion]);

  const rememberKeyboardNavigation = () => {
    const focused = document.activeElement;
    focusAfterAction.current = focused instanceof HTMLElement && focused.matches(':focus-visible') && Boolean(focused.closest('.dashboard-stage'));
  };

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--voice-stage-height', `${element.getBoundingClientRect().height + 24}px`);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const chooseHeadline = (headline: HeadlineItem) => {
    setEntered(true);
    rememberKeyboardNavigation();
    const reference = { id: headline.id, title: headline.title, publisher: headline.publisher, publisherUrl: headline.publisherUrl,
      googleNewsUrl: headline.googleNewsUrl, publishedAt: headline.publishedAt };
    setSavedHeadline(reference);
    saveSelectedHeadline(reference);
    selectStory(headline.id);
  };
  const currentStories = display?.stories ?? headlines;
  const visibleHeadlines = selectedHeadline && !currentStories.some((headline) => headline.id === selectedHeadline.id)
    ? [selectedHeadline, ...currentStories].slice(0, 20) : currentStories;
  const beginConversation = () => {
    if (active) { stop('Conversation ended. Take your time.'); return; }
    setEntered(true);
    window.scrollTo({ top: 0, behavior: 'instant' });
    // A remembered selection does not hijack a fresh briefing.
    void start(exploring ? selectedHeadline?.id : undefined, !exploring);
  };
  const copyAnimation = { opacity: hideCopy ? 0 : 1 };
  const copyTransition = { ...revealTransition, duration: reducedMotion ? 0 : 0.65 };

  return (
    <InterfaceMotion><motion.main className={`voice-page phase-${phase}`} data-view={exploring ? 'exploration' : 'stories'} data-started={docked} data-notice={showNotice}
      initial={false} animate={{ '--exploration-progress': exploring ? 1 : 0, '--opening-progress': docked ? 0 : 1 }}
      transition={{ ...revealTransition, duration: reducedMotion ? 0 : 0.52, '--opening-progress': { ...revealTransition, duration: reducedMotion ? 0 : 1.25 } }}>
      <div className="voice-stage" ref={stage}>
      <motion.header className="wordmark" aria-label="The Voice" animate={copyAnimation} transition={copyTransition}>
        <span className="wordmark-line" aria-hidden="true" />
        <h1>THE VOICE</h1>
        <span className="wordmark-line" aria-hidden="true" />
      </motion.header>
      <section className="conversation" aria-label="Voice conversation">
        <button
          className="wave-control"
          type="button"
          aria-label={label}
          aria-pressed={active}
          aria-describedby="voice-status voice-hint"
          onClick={beginConversation}
        >
          <Waveform phase={phase} inputAnalyser={inputAnalyser} outputAnalyser={outputAnalyser} />
        </button>
        <motion.div className="conversation-copy" animate={{ opacity: showNotice ? 1 : copyAnimation.opacity }} transition={copyTransition}>
          <p className="voice-status" id="voice-status" role="status" aria-live="polite" aria-atomic="true">{message || (!active && feedMessage) || captions[phase]}</p>
          <p className="voice-hint" id="voice-hint">
            <span className="status-dot" aria-hidden="true" />
            {phase === 'connecting' ? 'TAP THE WAVE TO CANCEL' : active ? 'TAP THE WAVE TO END · ESC TO LEAVE' : 'TAP THE WAVE TO BEGIN'}
          </p>
        </motion.div>
        <motion.p className="ai-note" animate={copyAnimation} transition={copyTransition}>An AI voice. A little room for your thoughts.</motion.p>
      </section>
      </div>
      <motion.div className="dashboard-stage" initial={false} animate={{ opacity: !docked ? 0.55 : 1 }} transition={{ ...revealTransition, duration: reducedMotion ? 0 : 0.8 }}>
        <AnimatePresence initial={false} mode="popLayout">
          {exploring && display
            ? <MotionView key={`exploration-${display.headline?.id ?? 'story'}`} className="dashboard-view">
              <ExplorationPanel display={{ ...display, stories: display.stories ?? headlines }} busy={researchBusy} onAction={(action) => { if (action.type !== 'compare_paths') rememberKeyboardNavigation(); else focusAfterAction.current = false; void act(action); }} />
            </MotionView>
            : <MotionView key="stories" className="dashboard-view">
              <HeadlineGrid spotlightStoryId={active ? display?.spotlightStoryId : null} headlines={visibleHeadlines} selectedHeadlineId={selectedHeadline?.id ?? null} loading={loading && !display?.stories?.length} onSelect={chooseHeadline} />
            </MotionView>}
        </AnimatePresence>
      </motion.div>
      <div className="footer-position"><PersonalFooter /></div>
    </motion.main></InterfaceMotion>
  );
}
