import { SCREEN_SECTIONS, screenContextKey, type ScreenReport, type ScreenRequest } from './screen-contracts';
import type { ExplorationDisplay } from './visual-contracts';

type Section = typeof SCREEN_SECTIONS[number];
function pageGeometry() {
  const viewport = window.visualViewport;
  const top = viewport?.offsetTop ?? 0;
  const bottom = top + (viewport?.height ?? window.innerHeight);
  const dock = document.querySelector('.voice-stage')?.getBoundingClientRect().bottom ?? top;
  return { top: Math.max(top, dock) + 16, bottom: bottom - 20, visibleTop: Math.max(top, dock), visibleBottom: bottom,
    width: Math.round(viewport?.width ?? window.innerWidth), height: Math.round(viewport?.height ?? window.innerHeight) };
}
function contentElements() {
  const root = document.querySelector('.dashboard-view:not([aria-hidden="true"])');
  const sections = Array.from(root?.querySelectorAll<HTMLElement>('.news-section, [data-motion-section]') ?? [])
    .filter(element => !element.closest('[aria-hidden="true"], [inert]') && element.getBoundingClientRect().height > 0)
    .map(element => ({ element, name: (element.matches('.news-section') ? 'stories' : element.dataset.motionSection) as Section }))
    .filter(item => SCREEN_SECTIONS.includes(item.name));
  const cards = Array.from(root?.querySelectorAll<HTMLElement>('[data-story-id]') ?? [])
    .filter(element => !element.closest('[aria-hidden="true"], [inert]') && element.getBoundingClientRect().height > 0);
  const paths = Array.from(root?.querySelectorAll<HTMLElement>('.possibility-card[data-path-id], .scenario-detail[data-path-id]') ?? [])
    .filter(element => !element.closest('[aria-hidden="true"], [inert]') && element.getBoundingClientRect().height > 0);
  return { sections, cards, paths };
}
export function readScreen(display: ExplorationDisplay | null): ScreenReport['screen'] {
  const area = pageGeometry();
  const { sections, cards, paths } = contentElements();
  const visible = (element: HTMLElement, fully = false) => {
    const box = element.getBoundingClientRect();
    return box.right > 0 && box.left < area.width && (fully
      ? box.top >= area.visibleTop - 1 && box.bottom <= area.visibleBottom + 1
      : Math.min(box.bottom, area.visibleBottom) - Math.max(box.top, area.visibleTop) >= Math.min(32, box.height));
  };
  const visibleCards = cards.filter(card => visible(card));
  const visiblePaths = paths.filter(path => visible(path));
  const focused = (elements: HTMLElement[]) => elements.find(element => element.contains(document.activeElement))
    ?? elements.find(element => element.dataset.spotlight === 'true')
    ?? elements.find(element => element.dataset.expanded === 'true');
  const primary = sections.filter(item => visible(item.element)).sort((a, b) => {
    const overlap = (element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      return Math.min(box.bottom, area.visibleBottom) - Math.max(box.top, area.visibleTop);
    };
    return overlap(b.element) - overlap(a.element);
  })[0];
  return {
    contextKey: screenContextKey(display), view: display?.view ?? 'stories', width: area.width, height: area.height,
    scrollY: Math.max(0, Math.round(window.scrollY)), atTop: window.scrollY <= 2,
    atBottom: window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2,
    hidden: document.visibilityState === 'hidden',
    visibleStoryIds: cards.filter(card => visible(card)).map(card => card.dataset.storyId!).slice(0, 20),
    fullyVisibleStoryIds: cards.filter(card => visible(card, true)).map(card => card.dataset.storyId!).slice(0, 20),
    visiblePathIds: paths.filter(path => visible(path)).map(path => path.dataset.pathId!).slice(0, 6),
    fullyVisiblePathIds: paths.filter(path => visible(path, true)).map(path => path.dataset.pathId!).slice(0, 6),
    focusedStoryId: focused(visibleCards)?.dataset.storyId ?? null,
    focusedPathId: focused(visiblePaths)?.dataset.pathId ?? null,
    primarySection: primary?.name ?? null,
    busy: document.querySelector('.exploration-section')?.getAttribute('aria-busy') === 'true',
    expandedPathIds: visiblePaths.filter(path => path.dataset.expanded === 'true').map(path => path.dataset.pathId!).slice(0, 6),
    visibleSections: sections.filter(item => visible(item.element)).map(item => item.name),
    availableSections: sections.map(item => item.name),
  };
}

export async function handleScreenRequest(request: ScreenRequest, getDisplay: () => ExplorationDisplay | null, signal: AbortSignal): Promise<ScreenReport | null> {
  // Let React commit any display update immediately preceding the command.
  await new Promise(resolve => window.setTimeout(resolve, 40));
  if (signal.aborted) return null;
  const report = (outcome: ScreenReport['outcome']): ScreenReport => ({ requestId: request.requestId, outcome, screen: readScreen(getDisplay()) });
  if (screenContextKey(getDisplay()) !== request.contextKey) return report('view_changed');
  if (document.visibilityState === 'hidden') return report('hidden');
  if (!request.scroll) return report('ok');
  // Cancel a delayed automatic spotlight scroll before honoring manual navigation.
  window.dispatchEvent(new Event('voice-scroll'));
  // Hover/spotlight collapse changes the document height. Let it settle before
  // native smooth scrolling, which browsers can cancel during a size change.
  let lastHeight = document.documentElement.scrollHeight;
  let stableHeight = 0;
  let movedManually = false;
  const cancelPreparation = () => { movedManually = true; };
  const preparationInputs = ['touchstart', 'wheel', 'pointerdown', 'keydown'] as const;
  preparationInputs.forEach(event => window.addEventListener(event, cancelPreparation, { passive: true }));
  try {
    for (let frame = 0; frame < 14 && stableHeight < 3; frame++) {
      await new Promise(resolve => window.setTimeout(resolve, 50));
      if (signal.aborted) return null;
      if (movedManually) return report('interrupted');
      if (document.hidden) return report('hidden');
      if (screenContextKey(getDisplay()) !== request.contextKey) return report('view_changed');
      const height = document.documentElement.scrollHeight;
      stableHeight = height === lastHeight ? stableHeight + 1 : 0;
      lastHeight = height;
    }
  } finally {
    preparationInputs.forEach(event => window.removeEventListener(event, cancelPreparation));
  }
  const { direction, section } = request.scroll;
  const area = pageGeometry();
  const { sections, cards } = contentElements();
  const step = Math.max(80, (area.bottom - area.top) * 0.85);
  const start = window.scrollY;
  let target = start;
  if (direction === 'top') target = 0;
  else if (direction === 'bottom') target = document.documentElement.scrollHeight;
  else if (direction === 'down' || direction === 'up') target += direction === 'down' ? step : -step;
  else {
    // A grid's next section is its next row. Other views use their semantic sections.
    const elements = getDisplay()?.view === 'exploration' ? sections.map(item => item.element) : cards;
    let destination: HTMLElement | undefined;
    if (direction === 'section') destination = sections.find(item => item.name === section)?.element;
    else if (direction === 'next_section') {
      const firstVisible = elements.find(element => element.getBoundingClientRect().bottom > area.top + 24);
      const currentTop = Math.max(area.top, firstVisible?.getBoundingClientRect().top ?? area.top);
      destination = elements.find(element => element.getBoundingClientRect().top > currentTop + 24);
    }
    else destination = elements.findLast(element => element.getBoundingClientRect().top < area.top - 24);
    if (direction === 'section' && !destination) return report('section_unavailable');
    target = destination ? start + destination.getBoundingClientRect().top - area.top : start + (direction === 'previous_section' ? -step : step);
  }
  target = Math.max(0, Math.min(target, document.documentElement.scrollHeight - window.innerHeight));
  if (Math.abs(target - start) < 2) return report('boundary');
  let interrupted = false;
  const interrupt = () => { interrupted = true; window.scrollTo({ top: window.scrollY, behavior: 'instant' }); };
  const inputEvents = ['touchstart', 'wheel', 'pointerdown', 'keydown'] as const;
  for (const event of inputEvents) window.addEventListener(event, interrupt, { passive: true, once: true });
  signal.addEventListener('abort', interrupt, { once: true });
  window.scrollTo({ top: target, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  try {
    const began = performance.now();
    let stable = 0;
    let adjustments = 0;
    let previous = start;
    // Wait for the actual scroll before telling the model which cards are visible.
    while (!signal.aborted && !interrupted && performance.now() - began < 2500) {
      await new Promise(resolve => window.setTimeout(resolve, 50));
      if (screenContextKey(getDisplay()) !== request.contextKey) { interrupt(); return report('view_changed'); }
      if (document.hidden) { interrupt(); return report('hidden'); }
      stable = Math.abs(window.scrollY - previous) < 1 ? stable + 1 : 0;
      previous = window.scrollY;
      if (stable >= 3) {
        // Expanding cards can change document height during the glide. Recheck
        // explicit page boundaries after layout settles, with bounded corrections.
        const boundary = direction === 'bottom' ? document.documentElement.scrollHeight - window.innerHeight : direction === 'top' ? 0 : undefined;
        if (boundary !== undefined && Math.abs(window.scrollY - boundary) > 2 && adjustments < 2) {
          target = Math.max(0, boundary);
          window.scrollTo({ top: target, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
          adjustments++;
          stable = 0;
          continue;
        }
        break;
      }
    }
    if (signal.aborted) return null;
    return report(interrupted || Math.abs(window.scrollY - target) > 3 ? 'interrupted' : 'ok');
  } finally {
    for (const event of inputEvents) window.removeEventListener(event, interrupt);
    signal.removeEventListener('abort', interrupt);
  }
}


// Local observations keep the sideband aware after touch, scroll, resize and focus
// changes. They do not request model responses or persist screen history.
export function observeScreen(getDisplay: () => ExplorationDisplay | null, publish: (screen: ScreenReport['screen'], sequence: number) => Promise<unknown>, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = '';
  let sequence = 0;
  let publishing = false;
  const send = async () => {
    timer = undefined;
    if (signal.aborted) return;
    if (publishing) { schedule(); return; }
    const screen = readScreen(getDisplay());
    const serialized = JSON.stringify(screen);
    if (serialized === last) return;
    last = serialized;
    publishing = true;
    try { await publish(screen, ++sequence); } catch { /* A later changed snapshot can refresh context. */ }
    finally { publishing = false; }
  };
  const schedule = () => { if (!signal.aborted && !timer) timer = setTimeout(() => { void send(); }, 200); };
  const mutations = new MutationObserver(schedule);
  const resize = new ResizeObserver(schedule);
  const main = document.querySelector('main');
  if (main) {
    mutations.observe(main, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-spotlight', 'data-expanded', 'aria-hidden', 'data-view', 'aria-busy', 'open'] });
    resize.observe(main);
    const dock = main.querySelector('.voice-stage');
    if (dock) resize.observe(dock);
    const dashboard = main.querySelector('.dashboard-stage');
    if (dashboard) resize.observe(dashboard);
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  document.addEventListener('toggle', schedule, true);
  window.addEventListener('scrollend', schedule);
  window.addEventListener('voice-layout', schedule);
  const stop = () => {
    clearTimeout(timer); mutations.disconnect(); resize.disconnect();
    window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
    document.removeEventListener('visibilitychange', schedule);
    document.removeEventListener('focusin', schedule); document.removeEventListener('focusout', schedule);
    document.removeEventListener('toggle', schedule, true); window.removeEventListener('scrollend', schedule);
    window.removeEventListener('voice-layout', schedule);
    signal.removeEventListener('abort', stop);
  };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop(); else schedule();
}
