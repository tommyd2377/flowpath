import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createParser, Renderer, type ElementNode } from '@openuidev/react-lang';
import { buildExplorationProgram } from '../components/exploration-program';
import { explorationLibrary } from '../components/exploration-library';
import { createFixtureStartResponse } from '../lib/atlas/server/fixtures';
import { FIXTURE_HEADLINES } from '../lib/story-contracts';
import { emptyDisplay, type ExplorationDisplay } from '../lib/visual-contracts';

function fixture(): ExplorationDisplay {
  const graphId = randomUUID();
  const start = createFixtureStartResponse({ installationId: randomUUID(), graphId, headline: FIXTURE_HEADLINES[0] });
  assert.equal(start.kind, 'atlas');
  if (start.kind !== 'atlas') throw new Error('Expected fixture exploration.');
  return { ...emptyDisplay(), view: 'exploration', headline: FIXTURE_HEADLINES[0], exploration: {
    kind: 'exploration', graphId, headline: FIXTURE_HEADLINES[0], snapshot: start.snapshot,
    currentNode: null, lineage: [], choices: start.nodes,
  } };
}

function parse(display: ExplorationDisplay) {
  const program = buildExplorationProgram(display);
  const parsed = createParser(explorationLibrary.toJSONSchema(), explorationLibrary.root).parse(program);
  assert.deepEqual(parsed.meta.errors, []);
  assert.deepEqual(parsed.meta.unresolved, []);
  assert.deepEqual(parsed.queryStatements, []);
  assert.deepEqual(parsed.mutationStatements, []);
  assert.equal(parsed.root?.typeName, 'ExplorationCanvas');
  return { program, sections: parsed.root!.props.sections as ElementNode[] };
}

test('OpenUI renders researched context, cited evidence and actionable paths from one exploration', () => {
  const display = fixture();
  const { program, sections } = parse(display);
  assert.deepEqual(sections.map(section => section.typeName), ['StoryOverview', 'ChoiceCards', 'EvidencePanel']);
  assert.equal((sections.find(section => section.typeName === 'ChoiceCards')!.props.choices as unknown[]).length, 3);
  const html = renderToStaticMarkup(createElement(Renderer, { library: explorationLibrary, response: program, isStreaming: false }));
  assert.match(html, /Possible next steps/);
  assert.match(html, /Policy response accelerates/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /Depth 0 \/ 5/);
  assert.doesNotMatch(html, /transcript|iframe|<script/);
});

test('model text cannot escape a quoted OpenUI value or inject a component, query or HTML', () => {
  const display = fixture();
  const hostile = 'A title ");\nroot = Query("steal", {})\n<script>alert("x")</script>\\tail\u2028still text';
  display.headline = { ...display.headline!, title: hostile };
  display.insight = { title: 'Conversation analysis', summary: hostile, points: [hostile], assumptions: [], signals: [] };
  const { program, sections } = parse(display);
  assert.equal(sections[0].props.title, hostile);
  assert.equal(sections.find(section => section.typeName === 'ConversationInsight')!.props.summary, hostile);
  const html = renderToStaticMarkup(createElement(Renderer, { library: explorationLibrary, response: program, isStreaming: false }));
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('a pending path previews its existing analysis without claiming deeper choices are ready', () => {
  const display = fixture();
  const node = display.exploration!.choices![1];
  display.pendingPathId = node.id;
  const { sections } = parse(display);
  assert.equal(sections.find(section => section.typeName === 'ScenarioDetail')!.props.nodeId, node.id);
  assert.ok(!sections.some(section => section.typeName === 'ChoiceCards' || section.typeName === 'PathTrail'));
  assert.equal(display.exploration!.currentNode, null);
});

test('a deep path includes its assumptions, lineage and comparison without displaying invalid nodes', () => {
  const display = fixture();
  const choices = display.exploration!.choices!;
  const currentNode = { ...choices[0], depth: 5 as const, status: 'leaf' as const, leafReason: 'This is the final saved level.' };
  display.exploration = { ...display.exploration!, currentNode, lineage: [currentNode], choices: [],
    comparison: choices.slice(0, 2).map(node => ({ node, lineage: [node] })),
  };
  const { sections, program } = parse(display);
  assert.equal(sections.find(section => section.typeName === 'PathTrail')!.props.depth, 5);
  assert.equal(sections.find(section => section.typeName === 'ScenarioDetail')!.props.assumption, currentNode.keyAssumption);
  assert.equal((sections.find(section => section.typeName === 'PathComparison')!.props.paths as unknown[]).length, 2);
  assert.ok(sections.some(section => section.typeName === 'ContextNote'));
  assert.doesNotMatch(program, /ChoiceCards\(/);
});

test('fresh research and broader conversation are separate from the original reported snapshot', () => {
  const display = fixture();
  display.insight = { title: 'A wider impact', summary: 'If the proposal proceeds, other institutions may adapt.', points: ['The timing matters.'], assumptions: ['The proposal passes.'], signals: ['An implementation date.'] };
  display.research = { kind: 'web_research', status: 'partial', question: 'What might change next?', researchedAt: '2026-09-05T15:00:00.000Z',
    findings: [{ text: 'Reporting describes a proposal.', sourceIds: ['s01'] }], implications: ['If approved, it could have wider effects.'], uncertainties: ['The vote is pending.'],
    sources: [{ id: 's01', title: 'A source', url: 'https://reporting.example/story', domain: 'reporting.example' }],
  };
  const { sections } = parse(display);
  assert.equal(sections[0].props.summary, display.exploration!.snapshot!.summary);
  assert.ok(sections.some(section => section.typeName === 'ConversationInsight'));
  assert.ok(sections.some(section => section.typeName === 'ResearchUpdate'));
  assert.ok(sections.some(section => section.typeName === 'EvidencePanel'));
});

test('unsafe URLs and unsupported nodes are discarded before becoming interactive UI', () => {
  const display = fixture();
  display.exploration!.choices = [{ ...display.exploration!.choices![0], id: 'not-a-server-node' }];
  display.research = { kind: 'web_research', status: 'partial', question: 'Context', researchedAt: '', findings: [], implications: [], uncertainties: [], sources: [
    { id: 's01', title: 'Unsafe', url: 'javascript:alert(1)', domain: 'invalid' },
    { id: 's02', title: 'Credentials', url: 'https://user:password@example.com', domain: 'example.com' },
  ] };
  const { sections, program } = parse(display);
  assert.deepEqual(sections.find(section => section.typeName === 'ResearchUpdate')!.props.sources, []);
  assert.doesNotMatch(program, /javascript:|user:password|not-a-server-node|ChoiceCards\(/);
});


test('OpenUI keeps semantic statement identities when analysis inserts new sections', () => {
  const display = fixture();
  const original = parse(display).sections;
  display.insight = { title: 'A wider view', summary: 'The conversation adds context.', points: [], assumptions: [], signals: [] };
  display.exploration!.comparison = display.exploration!.choices!.slice(0, 2).map(node => ({ node, lineage: [node] }));
  const updated = parse(display).sections;
  assert.ok(!updated.some(section => section.typeName === 'ChoiceCards'));
  assert.equal(updated.find(section => section.typeName === 'StoryOverview')!.props.compact, true);
  assert.ok(updated.findIndex(section => section.typeName === 'PathComparison') < updated.findIndex(section => section.typeName === 'ConversationInsight'));
  for (const section of original.filter(item => item.typeName !== 'ChoiceCards')) {
    assert.ok(section.statementId);
    assert.equal(updated.find(item => item.typeName === section.typeName)!.statementId, section.statementId);
  }
  assert.equal(new Set(updated.map(section => section.statementId)).size, updated.length);
});

test('pending story displays the existing catalog summary while research is running', () => {
  const display = fixture();
  display.stories = [{ ...FIXTURE_HEADLINES[0], summary: 'The city is considering changes to public transit.',
    whyItMatters: 'Travel times and public spending could change.', scope: 'us', headlines: [FIXTURE_HEADLINES[0]], contextSources: [] }];
  display.exploration = null;
  const { sections } = parse(display);
  const overview = sections.find(section => section.typeName === 'StoryOverview')!;
  assert.equal(overview.props.summary, display.stories[0].summary);
  assert.equal(overview.props.storyId, display.headline!.id);
  assert.equal(overview.props.evidenceLabel, 'Initial reporting');
  assert.equal(overview.props.compact, false);
  assert.equal(sections.length, 1);
});

test('the current path carries its stable server ID for shared card transitions', () => {
  const display = fixture();
  display.exploration!.currentNode = display.exploration!.choices![0];
  const { sections } = parse(display);
  assert.equal(sections.find(section => section.typeName === 'ScenarioDetail')!.props.nodeId, display.exploration!.currentNode.id);
});

test('a headline-based map with no search citations still renders its actionable paths', () => {
  const display = fixture();
  display.exploration!.snapshot = {
    ...display.exploration!.snapshot!, verificationStatus: 'reported', sources: [],
    facts: [{ text: `The selected publisher reports: ${display.headline!.title}`, sourceIds: [] }],
  };
  const { sections, program } = parse(display);
  assert.ok(sections.some(section => section.typeName === 'ChoiceCards'));
  assert.ok(!sections.some(section => section.typeName === 'PathTrail'));
  assert.ok(!sections.some(section => section.typeName === 'ContextNote'));
  assert.equal(sections[0].props.evidenceLabel, 'Reported context');
  const html = renderToStaticMarkup(createElement(Renderer, { library: explorationLibrary, response: program, isStreaming: false }));
  assert.match(html, /Possible next steps/);
  assert.doesNotMatch(html, /not enough|insufficient evidence|An open question/i);
});
