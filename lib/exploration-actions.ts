import { explorationService } from './exploration-server';
import { displayResult, emptyDisplay, type ExplorationAction, type ExplorationDisplay } from './visual-contracts';
import { storyCatalogMetadata, toStoryHeadline } from './story-contracts';

export async function runExplorationAction(installationId: string, action: ExplorationAction, signal?: AbortSignal, headlineId?: string, onDisplay?: (display: ExplorationDisplay) => void) {
  if (action.type === 'refresh_stories') {
    const catalog = await explorationService.listStories();
    signal?.throwIfAborted();
    return { ...await explorationService.getDisplay(installationId), view: 'stories' as const, stories: catalog.items, storyCatalog: storyCatalogMetadata(catalog) };
  }
  if (action.type === 'show_stories') return { ...await explorationService.getDisplay(installationId), view: 'stories' as const };
  if (action.type === 'select_story') {
    const preview = await explorationService.getStoryPreview(action.storyId, signal);
    let display: ExplorationDisplay = { ...emptyDisplay(), view: 'exploration', headline: preview ? toStoryHeadline(preview) : null,
      ...(preview ? { storyPreview: preview } : {}), storyResearch: { phase: 'gathering' } };
    if (preview) onDisplay?.(display);
    const result = await explorationService.selectStory(installationId, action.storyId, signal, snapshot => {
      display = { ...display, headline: snapshot.headline, storyResearch: { phase: 'mapping', snapshot } };
      onDisplay?.(display);
    });
    return displayResult(display, result);
  }
  const result = await explorationService.execute(installationId, action.type, Object.fromEntries(Object.entries(action).filter(([key]) => key !== 'type')), signal, headlineId);
  return displayResult({ ...emptyDisplay(), view: 'exploration' }, result);
}
