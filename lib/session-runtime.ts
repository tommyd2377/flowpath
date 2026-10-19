import { createLocalSessionRouter } from './session-server';
import { createRealtimeControl } from './realtime-control';
import { explorationService } from './exploration-server';
import { VOICE_INSTRUCTIONS, type VoiceControlOptions } from './voice-tools';
import { getGenerationCacheRepository } from './atlas/server/generation-cache';

const localProcess = globalThis as typeof globalThis & {
  voiceSessions?: ReturnType<typeof createLocalSessionRouter>;
};

const controlFactory = (options: VoiceControlOptions) => createRealtimeControl({ ...options, exploration: explorationService });

export const voiceSessions = localProcess.voiceSessions ??= createLocalSessionRouter({
  fixtureMode: process.env.VOICE_FIXTURE_MODE === '1',
  // Fixture previews must never open paid Realtime sessions, even with a local key.
  apiKey: () => process.env.VOICE_FIXTURE_MODE === '1' ? undefined : process.env.OPENAI_API_KEY,
  controlFactory,
});

// A process started before this hook existed must retain its legacy service until
// restarted, so an in-progress call and its cleanup state are never discarded.
voiceSessions.updateConversation?.({ instructions: VOICE_INSTRUCTIONS, controlFactory });

export async function hasActiveVoiceSession(installationId: string) {
  return process.env.VERCEL === '1'
    ? getGenerationCacheRepository().hasHostedSession(installationId)
    : voiceSessions.hasActiveSession(installationId);
}
