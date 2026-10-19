import { EventSnapshotSchema, PossibilityNodeSchema, SourceSchema } from '@/lib/atlas/contracts';
import { CuratedStorySchema } from '@/lib/story-contracts';
import type { ExplorationDisplay } from '@/lib/visual-contracts';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown, max = 1200) => typeof value === 'string' ? value.slice(0, max) : '';
const strings = (value: unknown, max = 8) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, max).map(item => item.slice(0, 500)) : [];
const researchText = (value: unknown) => typeof value === 'string' ? value : '';
const researchStrings = (value: unknown, max: number) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, max) : [];
const sources = (value: unknown) => Array.isArray(value) ? value.flatMap(item => {
  const result = SourceSchema.safeParse(item);
  if (!result.success) return [];
  const url = new URL(result.data.url);
  return url.protocol === 'https:' && !url.username && !url.password ? [result.data] : [];
}).slice(0, 16) : [];
const nodes = (value: unknown) => Array.isArray(value) ? value.flatMap(item => {
  const result = PossibilityNodeSchema.safeParse(item);
  return result.success ? [result.data] : [];
}).slice(0, 5) : [];

// Only this fixed vocabulary becomes OpenUI code. Model text remains escaped data.
function literal(value: unknown) {
  return JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function buildExplorationProgram(display: ExplorationDisplay) {
  const exploration = record(display.exploration);
  const research = record(display.research);
  const snapshotResult = EventSnapshotSchema.safeParse(display.storyResearch?.snapshot ?? exploration.snapshot);
  const snapshot = snapshotResult.success && snapshotResult.data.headline.id === display.headline?.id ? snapshotResult.data : null;
  const nodeResult = PossibilityNodeSchema.safeParse(exploration.currentNode);
  const mapReady = !display.storyResearch && typeof exploration.graphId === 'string';
  const savedChoices = mapReady ? nodes(exploration.choices) : [];
  const savedComparison = mapReady && Array.isArray(exploration.comparison) ? nodes(exploration.comparison.map(item => record(item).node)) : [];
  const pendingNode = [...savedChoices, ...savedComparison].find(node => node.id === display.pendingPathId);
  const currentNode = pendingNode ?? (mapReady && nodeResult.success ? nodeResult.data : null);
  const lineage = [...nodes(exploration.lineage), ...(pendingNode ? [pendingNode] : [])];
  const choices = pendingNode ? [] : savedChoices;
  const comparison = pendingNode ? [] : savedComparison;
  const focused = Boolean(currentNode || comparison.length >= 2 || display.insight);
  const previewResult = CuratedStorySchema.safeParse(display.storyPreview ?? display.stories?.find(story => story.id === display.headline?.id));
  const preview = previewResult.success && previewResult.data.id === display.headline?.id ? previewResult.data : null;
  const definitions: string[] = [];
  const references: string[] = [];
  const add = (name: string, args: unknown[], ref = name) => {
    const statementId = ref[0].toLowerCase() + ref.slice(1);
    references.push(statementId);
    definitions.push(`${statementId} = ${name}(${args.map(literal).join(', ')})`);
  };

  add('StoryOverview', [display.headline?.title || 'An idea worth exploring',
    snapshot?.summary || text(exploration.summary) || preview?.summary || preview?.whyItMatters || '',
    display.headline?.publisher || '', snapshot?.capturedAt || '',
    snapshot ? 'Reported context' : 'Initial reporting',
    display.headline?.id || 'story', focused, display.headline?.publishedAt || '']);

  if (preview?.whyItMatters && preview.whyItMatters !== preview.summary) {
    add('ContextNote', ['Why it matters', preview.whyItMatters, false], 'StorySignificance');
  }

  if (currentNode && !pendingNode) {
    add('PathTrail', [lineage.map(node => ({ id: node.id, title: node.title, depth: node.depth })), currentNode?.depth ?? 0]);
  }

  if (currentNode) {
    add('ScenarioDetail', [currentNode.title, currentNode.summary, currentNode.whyPlausible,
      currentNode.keyAssumption, currentNode.horizon, currentNode.watchFor, currentNode.lessLikelyIf, currentNode.id]);
  }

  if (comparison.length >= 2) {
    add('PathComparison', [comparison.map(node => ({ id: node.id, title: node.title, summary: node.summary,
      assumption: node.keyAssumption, horizon: node.horizon, signals: node.watchFor }))]);
  }

  if (display.insight) {
    const insight = record(display.insight);
    add('ConversationInsight', [text(insight.title, 120), text(insight.summary), strings(insight.points), strings(insight.assumptions), strings(insight.signals)]);
  }

  if (choices.length && comparison.length < 2) {
    add('ChoiceCards', [choices.map(node => ({ id: node.id, title: node.title, summary: node.summary, horizon: node.horizon, context: [node.whyPlausible, node.keyAssumption ? `Assumption: ${node.keyAssumption}` : ''].filter(Boolean).join(' ') })), (currentNode?.depth ?? 0) + 1]);
  }

  const boundary = text(record(exploration.boundary).message) || currentNode?.leafReason;
  if (boundary) add('ContextNote', ['A place to pause', boundary], 'PathBoundary');

  if (display.storyResearch?.phase === 'failed') {
    add('ContextNote', ['The possibility map is unavailable', snapshot
      ? 'The reporting is ready to explore. We couldn’t finish the possibility map; you can keep discussing this context or return to all stories.'
      : 'We couldn’t finish the deeper research. The initial reporting is still available; you can keep discussing it or return to all stories.', false], 'StoryResearchFailure');
  }


  const researchSources = sources(research.sources);
  if (research.kind === 'web_research') {
    const findings = Array.isArray(research.findings) ? research.findings.slice(0, 8).map(item => ({
      text: researchText(record(item).text), sourceIds: strings(record(item).sourceIds, 8),
    })).filter(item => item.text) : [];
    add('ResearchUpdate', [text(research.question), text(research.researchedAt, 80), findings,
      researchStrings(research.implications, 4), researchStrings(research.uncertainties, 6), researchSources]);
  }

  if (snapshot) {
    add('EvidencePanel', [snapshot.facts, snapshot.uncertainties, sources(snapshot.sources)]);
  } else if (preview) {
    const reports = preview.headlines.slice(0, 6).map((headline, index) => ({
      source: { id: `report-${index}`, title: headline.title, url: headline.googleNewsUrl, domain: new URL(headline.googleNewsUrl).hostname },
      text: [headline.publisher, headline.publishedAt ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(headline.publishedAt)) : ''].filter(Boolean).join(' · ') + `: ${headline.title}`,
    }));
    const previewSources = sources([...reports.map(report => report.source), ...preview.contextSources.map((source, index) => ({ ...source, id: `context-${index}`, domain: new URL(source.url).hostname }))]);
    const sourceIds = new Set(previewSources.map(source => source.id));
    add('EvidencePanel', [reports.filter(report => sourceIds.has(report.source.id)).map(report => ({ text: report.text, sourceIds: [report.source.id] })), [], previewSources]);
  } else if (sources(exploration.sources).length) {
    add('EvidencePanel', [[], [], sources(exploration.sources)]);
  }

  return `root = ExplorationCanvas([${references.join(', ')}])\n${definitions.join('\n')}`;
}
