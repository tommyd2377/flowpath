'use client';

import { forwardRef, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { LayoutGroup, MotionConfig, motion, useIsPresent, useReducedMotion } from 'motion/react';

export const layoutTransition = { type: 'spring', stiffness: 240, damping: 30, mass: 0.85 } as const;
export const revealTransition = { duration: 0.38, ease: [0.22, 1, 0.36, 1] } as const;

/** Scrolling beneath a stationary pointer must not keep expanding new cards. */
export function useCardHover() {
  const [hovered, setHovered] = useState<string | null>(null);
  const scrolling = useRef(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const pause = (event: Event) => {
      scrolling.current = true;
      setHovered(null);
      clearTimeout(timer);
      timer = setTimeout(() => { scrolling.current = false; }, event.type === 'voice-scroll' ? 1000 : 250);
    };
    const events = ['voice-scroll', 'scroll', 'wheel', 'touchstart'] as const;
    events.forEach(event => window.addEventListener(event, pause, { passive: true }));
    return () => { clearTimeout(timer); events.forEach(event => window.removeEventListener(event, pause)); };
  }, []);
  const hover = (id: string | null) => {
    if (!id || (!scrolling.current && window.matchMedia('(min-width: 960px) and (hover: hover)').matches)) setHovered(id);
  };
  return [hovered, hover] as const;
}

/** Follow the finished card geometry; a fixed delay can scroll mid-expansion. */
export function useSpotlightScroll(grid: RefObject<HTMLDivElement | null>, spotlight: string | null | undefined, reduced: boolean | null) {
  useEffect(() => {
    const card = Array.from(grid.current?.querySelectorAll<HTMLElement>('[data-story-id], [data-path-id]') ?? [])
      .filter(element => !element.closest('[aria-hidden="true"], [inert]'))
      .find(element => (element.dataset.storyId ?? element.dataset.pathId) === spotlight);
    if (!card) return;
    let frame = 0;
    let previous = '';
    let stable = 0;
    const started = performance.now();
    const follow = () => {
      const bounds = card.getBoundingClientRect();
      const dockBottom = document.querySelector('.voice-stage')?.getBoundingClientRect().bottom ?? 0;
      const geometry = [bounds.top, bounds.bottom, dockBottom].map(value => Math.round(value * 10)).join(':');
      stable = geometry === previous ? stable + 1 : 0;
      previous = geometry;
      if (!reduced && ((stable < 3 || performance.now() - started < 100) && performance.now() - started < 1800)) {
        frame = requestAnimationFrame(follow);
        return;
      }
      if (bounds.top < dockBottom + 16 || bounds.bottom > window.innerHeight - 20) {
        window.scrollBy({ top: bounds.top - dockBottom - 24, behavior: reduced ? 'instant' : 'smooth' });
      }
      window.dispatchEvent(new Event('voice-layout'));
    };
    frame = requestAnimationFrame(follow);
    const cancel = () => cancelAnimationFrame(frame);
    const events = ['voice-scroll', 'touchstart', 'wheel', 'pointerdown', 'keydown'] as const;
    events.forEach(event => window.addEventListener(event, cancel, { passive: true }));
    return () => { cancel(); events.forEach(event => window.removeEventListener(event, cancel)); };
  }, [grid, spotlight, reduced]);
}

/** Shared motion rules belong to the components, not to generated model text. */
export function InterfaceMotion({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user" transition={{ ...revealTransition, layout: layoutTransition }}>
    <LayoutGroup id="the-voice">{children}</LayoutGroup>
  </MotionConfig>;
}

/** Exiting views remain visible for their transition, but cannot receive input. */
export const MotionView = forwardRef<HTMLDivElement, { children: ReactNode; className?: string }>(function MotionView({ children, className }, ref) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  return <motion.div ref={ref} className={className} inert={!present} aria-hidden={!present || undefined}
    initial={reduced ? false : { opacity: 0 }}
    animate={{ opacity: 1, transition: { duration: reduced ? 0 : 0.28, delay: reduced ? 0 : 0.1 } }}
    exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.1 } }}>
    {children}
  </motion.div>;
});

export const sectionVariants = {
  enter: (direction: number) => ({ opacity: 0, x: direction * 18, y: direction === 0 ? 14 : 0 }),
  visible: { opacity: 1, x: 0, y: 0 },
  exit: (direction: number) => ({ opacity: 0, x: direction * -12, y: 0 }),
};

/** Stable semantic keys keep focus and local component state through new AI results. */
export const MotionSection = forwardRef<HTMLDivElement, {
  children: ReactNode; name: string; direction?: number;
}>(function MotionSection({ children, name, direction = 0 }, ref) {
  const present = useIsPresent();
  const reduced = useReducedMotion();
  return <motion.div ref={ref} layout="position" data-motion-section={name} className="motion-section"
    inert={!present} aria-hidden={!present || undefined}
    custom={reduced ? 0 : direction} variants={sectionVariants}
    initial={reduced ? false : 'enter'} animate="visible" exit="exit"
    transition={{ ...revealTransition, duration: reduced ? 0 : revealTransition.duration, layout: layoutTransition }}>
    {children}
  </motion.div>;
});
