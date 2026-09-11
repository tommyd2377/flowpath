export { LIVE_MODEL as MODEL } from './gpt-live/protocol';
export const SESSION_SECONDS = 600;
// The existing Vercel Hobby project allows 300 seconds including setup/cleanup.
export const HOSTED_SESSION_SECONDS = 270;
export const IDLE_SECONDS = 45;
