import { explorationService } from './exploration-server';
import { displayResult, emptyDisplay, type ExplorationAction } from './visual-contracts';

export async function runExplorationAction(installationId: string, action: ExplorationAction, signal?: AbortSignal, headlineId?: string) {
  if (action.type === 'show_stories') return { ...await explorationService.getDisplay(installationId), view: 'stories' as const };
  const result = action.type === 'select_story'
    ? await explorationService.selectStory(installationId, action.storyId, signal)
    : await explorationService.execute(installationId, action.type, Object.fromEntries(Object.entries(action).filter(([key]) => key !== 'type')), signal, headlineId);
  return displayResult({ ...emptyDisplay(), view: 'exploration' }, result);
}
