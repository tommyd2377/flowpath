'use client';

import { forwardRef, type ReactNode } from 'react';
import { LayoutGroup, MotionConfig, motion, useIsPresent, useReducedMotion } from 'motion/react';

export const layoutTransition = { type: 'spring', stiffness: 240, damping: 30, mass: 0.85 } as const;
export const revealTransition = { duration: 0.38, ease: [0.22, 1, 0.36, 1] } as const;

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
