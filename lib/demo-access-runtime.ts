import { createNewsDemoAccess } from './demo-access';
import { getGenerationCacheRepository } from './atlas/server/generation-cache';

export const newsDemoAccess = createNewsDemoAccess(getGenerationCacheRepository);
