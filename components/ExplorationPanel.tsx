'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Renderer } from './openui-runtime';
import { ArrowLeft } from 'lucide-react';
import type { ExplorationAction, ExplorationDisplay } from '@/lib/visual-contracts';
import { ExplorationBusyContext, ExplorationDirectionContext, ExplorationSpotlightContext, explorationLibrary } from './exploration-library';
import { buildExplorationProgram } from './exploration-program';

type Props = {
  display: ExplorationDisplay;
  busy: boolean;
  onAction: (action: ExplorationAction) => void;
};

export default function ExplorationPanel({ display, busy, onAction }: Props) {
  const depth = display.exploration?.currentNode?.depth ?? 0;
  const [navigation, setNavigation] = useState({ depth, direction: 1 });
  if (navigation.depth !== depth) setNavigation({ depth, direction: depth > navigation.depth ? 1 : -1 });
  const program = useMemo(() => buildExplorationProgram(display), [display]);
  return <section className="exploration-section" aria-label="Story exploration" aria-busy={busy}>
    <div className="exploration-toolbar"><button className="quiet-button" type="button" onClick={() => onAction({ type: 'show_stories' })}><ArrowLeft size={14} aria-hidden="true" /> All stories</button><span>{busy ? 'Gathering context…' : 'Explore by voice or by touch'}</span></div>
    <ExplorationSpotlightContext.Provider value={display.spotlightPathId ?? null}><ExplorationDirectionContext.Provider value={navigation.direction}><ExplorationBusyContext.Provider value={busy}>
      <Renderer library={explorationLibrary} response={program} isStreaming={false} publishObservability={false} onAction={(event) => {
        if (busy) return;
        const args = event.params;
        if (event.type === 'choose_path' && typeof args?.nodeId === 'string') onAction({ type: 'choose_path', nodeId: args.nodeId });
        else if (event.type === 'navigate_path' && (args?.target === 'parent' || args?.target === 'root')) onAction({ type: 'navigate_path', target: args.target });
        else if (event.type === 'navigate_path' && args?.target === 'node' && typeof args.nodeId === 'string') onAction({ type: 'navigate_path', target: 'node', nodeId: args.nodeId });
        else if (event.type === 'compare_paths' && Array.isArray(args?.nodeIds) && args.nodeIds.every((id: unknown) => typeof id === 'string')) onAction({ type: 'compare_paths', nodeIds: args.nodeIds });
      }} />
    </ExplorationBusyContext.Provider></ExplorationDirectionContext.Provider></ExplorationSpotlightContext.Provider>
    <AnimatePresence>{busy && !display.exploration && <motion.div key="research-loading" className="exploration-loading" aria-hidden="true" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}><span /><span /><span /></motion.div>}</AnimatePresence>
  </section>;
}
