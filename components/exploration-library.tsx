'use client';

import { createContext, useContext, useId, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ElementNode } from '@openuidev/react-lang';
import { MotionSection, layoutTransition, revealTransition, useSpotlightScroll, useCardHover } from './motion-primitives';
import { createLibrary, defineComponent, useTriggerAction } from './openui-runtime';
import { ArrowLeft, ArrowUpRight, ChevronRight, Clock3, GitBranch, Globe2 } from 'lucide-react';
import { z } from 'zod/v4';
import { compactResearchText } from '@/lib/research-presentation';
import type { ExplorationDisplay } from '@/lib/visual-contracts';

export const ExplorationBusyContext = createContext(false);
export const ExplorationDirectionContext = createContext(1);
export const ExplorationSpotlightContext = createContext<string | null>(null);
export const ExplorationVoiceContext = createContext<{ active: boolean; walkthrough?: ExplorationDisplay['walkthrough'] }>({ active: false });

const Source = z.object({ id: z.string(), title: z.string(), url: z.string(), domain: z.string() });
const Fact = z.object({ text: z.string(), sourceIds: z.array(z.string()) });

function dateLabel(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function SourceLinks({ sources }: { sources: z.infer<typeof Source>[] }) {
  return sources.length ? <ul className="source-links">{sources.map(source => (
    <li key={source.id}><a href={source.url} target="_blank" rel="noopener noreferrer" title={source.title}>
      {source.domain}<ArrowUpRight aria-hidden="true" size={12} />
    </a></li>
  ))}</ul> : null;
}

function ResearchText({ text, limit = 500, expandLabel = 'Show full fact', as = 'p', inactive = false }: {
  text: string; limit?: number; expandLabel?: string; as?: 'p' | 'span'; inactive?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  const preview = compactResearchText(text, limit);
  const Content = as;
  return <>
    <Content className="fact-text" id={contentId}>{expanded ? text : preview.text}</Content>
    {preview.shortened && <button className="quiet-button fact-text-toggle" type="button" aria-expanded={expanded} aria-controls={contentId} tabIndex={inactive ? -1 : undefined} onClick={() => setExpanded(value => !value)}>
      {expanded ? 'Show less' : expandLabel}
    </button>}
  </>;
}

function FactList({ facts, sources }: { facts: z.infer<typeof Fact>[]; sources: z.infer<typeof Source>[] }) {
  return <ul className="evidence-list">{facts.map((fact, index) => (
    <li key={index}><ResearchText key={fact.text} text={fact.text} /><span className="fact-attribution">{fact.sourceIds.map(id => {
      const source = sources.find(item => item.id === id);
      return source ? <a key={id} href={source.url} target="_blank" rel="noopener noreferrer">{source.domain}<ArrowUpRight aria-hidden="true" size={10} /></a> : null;
    })}</span></li>
  ))}</ul>;
}

function TextList({ items, compact = false }: { items: string[]; compact?: boolean }) {
  return <ul className="detail-list">{items.map((item, index) => <li key={index}>{compact
    ? <ResearchText key={item} text={item} as="span" expandLabel="Show full detail" /> : item}</li>)}</ul>;
}

const StoryOverview = defineComponent({
  name: 'StoryOverview',
  description: 'The selected story and its researched context, with source timing.',
  props: z.object({ title: z.string(), summary: z.string(), publisher: z.string(), capturedAt: z.string(), evidenceLabel: z.string(), storyId: z.string(), compact: z.boolean(), publishedAt: z.string().optional() }),
  component: ({ props }) => <motion.header layout layoutId={`story-${props.storyId}`} className={`story-overview${props.compact ? ' story-overview-compact' : ''}`} style={{ borderRadius: 13 }}>
    <div className="section-eyebrow"><Globe2 size={13} aria-hidden="true" /> THE STORY</div>
    <motion.h2 layout="position" layoutId={`story-title-${props.storyId}`} tabIndex={-1}>{props.title}</motion.h2>
    {props.summary && <motion.p layout="position" className="story-summary" initial={false} animate={{ height: props.compact ? 0 : 'auto', opacity: props.compact ? 0 : 1 }} aria-hidden={props.compact || undefined} style={{ overflow: 'hidden' }}><ResearchText key={props.summary} text={props.summary} as="span" limit={900} expandLabel="Show full context" inactive={props.compact} /></motion.p>}
    <motion.p layout="position" className="story-meta"><span>{props.evidenceLabel}</span>{props.capturedAt && <><span aria-hidden="true">·</span><span>Context from {dateLabel(props.capturedAt)}</span></>}{!props.capturedAt && props.publisher && <><span aria-hidden="true">·</span><span>{props.publisher}</span></>}{!props.capturedAt && props.publishedAt && <><span aria-hidden="true">·</span><span>Published {dateLabel(props.publishedAt)}</span></>}</motion.p>
  </motion.header>,
});

const PathTrail = defineComponent({
  name: 'PathTrail', description: 'Navigate the server-owned lineage of the selected path.',
  props: z.object({ items: z.array(z.object({ id: z.string(), title: z.string(), depth: z.number() })), depth: z.number() }),
  component: function PathTrailView({ props }) {
    const triggerAction = useTriggerAction();
    const busy = useContext(ExplorationBusyContext);
    const navigate = (target: 'parent' | 'root' | 'node', nodeId?: string) => triggerAction('Go to this part of the story', undefined, { type: 'navigate_path', params: { target, ...(nodeId ? { nodeId } : {}) } });
    return <div className="path-trail">
      <nav aria-label="Explored path"><ol>
        <motion.li layout="position"><button type="button" disabled={busy} aria-current={props.depth === 0 ? 'step' : undefined} onClick={() => navigate('root')}>Original story</button></motion.li>
        <AnimatePresence initial={false}>{props.items.map((item, index) => <motion.li layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} key={item.id}><ChevronRight size={12} aria-hidden="true" /><button type="button" disabled={busy} aria-current={index === props.items.length - 1 ? 'step' : undefined} onClick={() => navigate('node', item.id)}>{item.title}</button></motion.li>)}</AnimatePresence>
      </ol></nav>
      <div className="path-position">{props.depth > 0 && <button className="quiet-button" type="button" disabled={busy} onClick={() => navigate('parent')}><ArrowLeft size={13} aria-hidden="true" /> Back one step</button>}<span>Depth {props.depth} / 5</span></div>
    </div>;
  },
});

const ScenarioDetail = defineComponent({
  name: 'ScenarioDetail', description: 'The selected hypothetical outcome, assumptions and signals.',
  props: z.object({ title: z.string(), summary: z.string(), reasoning: z.string(), assumption: z.string(), horizon: z.string(), signals: z.array(z.string()), lessLikely: z.string(), nodeId: z.string() }),
  component: function ScenarioDetailView({ props }) {
    const spotlight = useContext(ExplorationSpotlightContext);
    return <motion.section layout layoutId={`path-${props.nodeId}`} data-path-id={props.nodeId} data-spotlight={spotlight === props.nodeId} data-expanded="true" className="scenario-detail" aria-label="Current possibility" style={{ borderRadius: 13 }}>
    <div className="section-eyebrow"><GitBranch size={13} aria-hidden="true" /> THE POSSIBILITY WE’RE EXPLORING</div>
    <motion.h3 layout="position" layoutId={`path-title-${props.nodeId}`} tabIndex={-1}>{props.title}</motion.h3><p className="scenario-summary">{props.summary}</p>
    <p className="scenario-reasoning">{props.reasoning}</p>
    <div className="scenario-factors">
      <div><h4>What this assumes</h4><p>{props.assumption}</p></div>
      <div><h4>What to watch</h4><TextList items={props.signals} /></div>
      <div><h4>What could change it</h4><p>{props.lessLikely}</p></div>
    </div>
    <p className="scenario-horizon"><Clock3 size={12} aria-hidden="true" /> {props.horizon}<span>Conditional scenario, not a prediction</span></p>
  </motion.section>;
  },
});

const ChoiceCards = defineComponent({
  name: 'ChoiceCards', description: 'Existing possible next paths, selectable by click or spoken name or number.',
  props: z.object({ choices: z.array(z.object({ id: z.string(), title: z.string(), summary: z.string(), horizon: z.string(), context: z.string() })), depth: z.number() }),
  component: function ChoiceCardsView({ props }) {
    const reduced = useReducedMotion();
    const triggerAction = useTriggerAction();
    const busy = useContext(ExplorationBusyContext);
    const spotlight = useContext(ExplorationSpotlightContext);
    const voice = useContext(ExplorationVoiceContext);
    const walking = voice.active && voice.walkthrough && voice.walkthrough.phase !== 'paused';
    const [hovered, setHovered] = useCardHover();
    const [focused, setFocused] = useState<string | null>(null);
    const grid = useRef<HTMLDivElement>(null);
    useSpotlightScroll(grid, spotlight, reduced);
    return <section className="possibilities-section" aria-label="Possible next paths">
      <div className="section-heading"><div><div className="section-eyebrow">WHERE COULD THIS GO?</div><h3>Possible next steps</h3></div>
        {props.choices.length >= 2 && <button className="quiet-button" type="button" disabled={busy} onClick={() => triggerAction('Compare these possibilities', undefined, { type: 'compare_paths', params: { nodeIds: props.choices.map(choice => choice.id) } })}>Compare paths <ArrowUpRight size={13} aria-hidden="true" /></button>}
      </div>
      <p className="interaction-note possibility-voice-hint" role={walking || voice.walkthrough?.phase === 'paused' ? 'status' : undefined}>{walking ? `Option ${voice.walkthrough!.index + 1} of ${voice.walkthrough!.total}. Speak to interrupt or say “stop.”`
        : voice.walkthrough?.phase === 'paused' ? 'Walkthrough paused. Say “talk me through these options” to restart, or ask about this option.'
          : voice.active ? 'Try saying “talk me through these options.” You can interrupt at any time.'
            : 'Tap the wave, then say “talk me through these options.”'}</p>
      <motion.div ref={grid} layout={!reduced} className="possibility-grid" data-spotlighting={Boolean(spotlight)}><AnimatePresence initial={false} mode="popLayout">{props.choices.map((choice, index) => {
        const expanded = spotlight ? spotlight === choice.id : hovered === choice.id || focused === choice.id;
        return <motion.button layout={!reduced} layoutId={reduced ? undefined : `path-${choice.id}`} data-path-id={choice.id} data-spotlight={spotlight === choice.id}
        data-expanded={expanded}
        aria-current={spotlight === choice.id ? true : undefined}
        onHoverStart={() => setHovered(choice.id)} onHoverEnd={() => setHovered(null)} onFocus={() => setFocused(choice.id)} onBlur={() => setFocused(null)} initial={reduced ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0, scale: spotlight === choice.id && !reduced ? 1.025 : 1 }} exit={{ opacity: 0, y: -10 }} transition={{ ...revealTransition, delay: reduced ? 0 : index * 0.035, layout: layoutTransition }} whileHover={reduced ? undefined : { y: -3 }} whileTap={reduced ? undefined : { scale: 0.99 }} style={{ borderRadius: 12 }} className="possibility-card" type="button" key={choice.id} disabled={busy} onClick={() => triggerAction(`Explore ${choice.title}`, undefined, { type: 'choose_path', params: { nodeId: choice.id } })}>
        <span className="possibility-number">0{index + 1}<ArrowUpRight size={16} aria-hidden="true" /></span>
        <motion.strong layout={reduced ? false : 'position'} layoutId={reduced ? undefined : `path-title-${choice.id}`}>{choice.title}</motion.strong>
        <motion.span className="card-copy" aria-hidden={!expanded} initial={false} animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }} transition={{ ...revealTransition, duration: reduced ? 0 : 0.45 }}>
          <span className="possibility-summary">{choice.summary}</span>
          <span className="possibility-context">{choice.context}</span>
        </motion.span>
        <span className="possibility-horizon"><Clock3 size={11} aria-hidden="true" />{choice.horizon}</span>
      </motion.button>; })}</AnimatePresence></motion.div>
      <p className="interaction-note">Ask about an option to discuss it; choose a card to explore further. These are possibilities, not forecasts.</p>
    </section>;
  },
});

const PathComparison = defineComponent({
  name: 'PathComparison', description: 'Compare existing hypothetical paths and their assumptions.',
  props: z.object({ paths: z.array(z.object({ id: z.string(), title: z.string(), summary: z.string(), assumption: z.string(), horizon: z.string(), signals: z.array(z.string()) })) }),
  component: function PathComparisonView({ props }) {
    const reduced = useReducedMotion();
    const triggerAction = useTriggerAction();
    const busy = useContext(ExplorationBusyContext);
    return <section className="comparison-section" aria-label="Path comparison"><div className="section-eyebrow">SIDE BY SIDE</div><h3>How the possibilities differ</h3>
      <motion.div layout className="comparison-grid"><AnimatePresence initial={false}>{props.paths.map((path, index) => <motion.article layout className="comparison-card" key={path.id} initial={reduced ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ ...revealTransition, delay: reduced ? 0 : index * 0.055, layout: layoutTransition }} style={{ borderRadius: 11 }}>
        <h4>{path.title}</h4><p>{path.summary}</p><dl><dt>Depends on</dt><dd>{path.assumption}</dd><dt>Time horizon</dt><dd>{path.horizon}</dd><dt>Signals to watch</dt><dd><TextList items={path.signals} /></dd></dl>
        <button className="quiet-button" type="button" disabled={busy} onClick={() => triggerAction(`Explore ${path.title}`, undefined, { type: 'choose_path', params: { nodeId: path.id } })}>Explore this path <ArrowUpRight size={13} aria-hidden="true" /></button>
      </motion.article>)}</AnimatePresence></motion.div>
    </section>;
  },
});

const ConversationInsight = defineComponent({
  name: 'ConversationInsight', description: 'A concise visual synthesis of the ongoing conversation, with explicit assumptions.',
  props: z.object({ title: z.string(), summary: z.string(), points: z.array(z.string()), assumptions: z.array(z.string()), signals: z.array(z.string()) }),
  component: ({ props }) => <section className="conversation-insight" aria-label="Conversation insight"><div className="section-eyebrow">CONVERSATION ANALYSIS</div><h3>{props.title || 'Thinking it through'}</h3>{props.summary && <p className="insight-summary">{props.summary}</p>}{props.points.length > 0 && <TextList items={props.points} />}
    {(props.assumptions.length > 0 || props.signals.length > 0) && <div className="insight-details">{props.assumptions.length > 0 && <div><h4>Assumptions</h4><TextList items={props.assumptions} /></div>}{props.signals.length > 0 && <div><h4>Signals to watch</h4><TextList items={props.signals} /></div>}</div>}
  </section>,
});

const ResearchUpdate = defineComponent({
  name: 'ResearchUpdate', description: 'Fresh web findings and sources, distinct from the story snapshot.',
  props: z.object({ question: z.string(), researchedAt: z.string(), findings: z.array(Fact), implications: z.array(z.string()), uncertainties: z.array(z.string()), sources: z.array(Source) }),
  component: ({ props }) => <section className="research-update" aria-label="Latest web research"><div className="section-eyebrow"><Globe2 size={13} aria-hidden="true" /> FRESH CONTEXT{props.researchedAt && <span>{dateLabel(props.researchedAt)}</span>}</div><h3>{props.question || 'What the latest reporting adds'}</h3>
    <FactList facts={props.findings} sources={props.sources} />
    {props.implications.length > 0 && <div className="research-implications"><h4>What this could mean</h4><TextList items={props.implications} compact /></div>}
    {props.uncertainties.length > 0 && <div className="uncertainty-note"><h4>Still open</h4><TextList items={props.uncertainties} compact /></div>}
    <SourceLinks sources={props.sources} />
  </section>,
});

const EvidencePanel = defineComponent({
  name: 'EvidencePanel', description: 'The established reporting behind the exploration, with clickable source attribution.',
  props: z.object({ facts: z.array(Fact), uncertainties: z.array(z.string()), sources: z.array(Source) }),
  component: ({ props }) => <details className="evidence-panel"><summary><span>Reporting &amp; sources</span><span>{props.sources.length} {props.sources.length === 1 ? 'source' : 'sources'}<ChevronRight size={14} aria-hidden="true" /></span></summary>
    <div className="evidence-content"><FactList facts={props.facts} sources={props.sources} />
      {props.uncertainties.length > 0 && <div className="uncertainty-note"><h4>What remains uncertain</h4><TextList items={props.uncertainties} compact /></div>}
      <SourceLinks sources={props.sources} />
    </div>
  </details>,
});

const ContextNote = defineComponent({
  name: 'ContextNote', description: 'An explanation of incomplete evidence or the boundary of a saved path.',
  props: z.object({ title: z.string(), message: z.string(), continuation: z.boolean().optional() }),
  component: ({ props }) => <aside className="context-note"><h3>{props.title}</h3><p>{props.message}</p>{props.continuation !== false && <p className="interaction-note">We can keep talking about the wider implications.</p>}</aside>,
});

const ExplorationCanvas = defineComponent({
  name: 'ExplorationCanvas', description: 'A focused, accessible space for the current story exploration.',
  props: z.object({ sections: z.array(z.union([StoryOverview.ref, PathTrail.ref, ScenarioDetail.ref, ChoiceCards.ref, PathComparison.ref, ConversationInsight.ref, ResearchUpdate.ref, EvidencePanel.ref, ContextNote.ref])) }),
  component: function ExplorationCanvasView({ props, renderNode }) {
    const direction = useContext(ExplorationDirectionContext);
    return <div className="exploration-canvas">
      <AnimatePresence initial={false} mode="popLayout" custom={direction}>
        {props.sections.map(section => {
          // OpenUI's array renderer uses positional keys. Render each statement separately
          // so a new insight never remounts existing disclosures or focused controls.
          const node = section as ElementNode;
          const key = node.typeName === 'ScenarioDetail'
            ? `${node.statementId}-${node.props.nodeId}` : node.statementId;
          return <MotionSection key={key} name={section.typeName} direction={section.typeName === 'ScenarioDetail' ? direction : 0}>
            {renderNode(section)}
          </MotionSection>;
        })}
      </AnimatePresence>
    </div>;
  },
});

export const explorationLibrary = createLibrary({
  root: 'ExplorationCanvas',
  components: [ExplorationCanvas, StoryOverview, PathTrail, ScenarioDetail, ChoiceCards, PathComparison, ConversationInsight, ResearchUpdate, EvidencePanel, ContextNote],
});
