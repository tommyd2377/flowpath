export type VoiceAudioEvent = {
  type: string;
  response_id?: string;
  response?: { id?: string; status?: string; output?: Array<{ content?: Array<{ type?: string }> }> };
  error?: { code?: string; event_id?: string };
};

export function needsStartupAudioGuard(device: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>) {
  return /iPhone|iPad|iPod/.test(device.userAgent) || (device.platform === 'MacIntel' && device.maxTouchPoints > 1);
}

// Keep capture and its echo canceller running, but send silence during the opening
// request and the first two seconds of playback. Arm BEFORE requesting speech: audio
// and data-channel events arrive independently; speech_started is already too late.
export function createStartupAudioGuard(options: {
  stream: Pick<MediaStream, 'getAudioTracks'>;
  enabled: boolean;
  debug: boolean;
  protectionMs?: number;
}) {
  // The original track stays enabled for the waveform/capture pipeline. Disabling
  // every track can release the device and restart iOS audio processing on unmute.
  const tracks = options.stream.getAudioTracks().map(track => options.enabled ? track.clone() : track);
  let state: 'ready' | 'waiting' | 'playing' | 'released' | 'disposed' = 'ready';
  let responseId: string | undefined;
  let userHasSpoken = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const startedAt = Date.now();
  // Keep the shorter comparison settings; two seconds is the default.
  const protectionMs = options.protectionMs === 500 || options.protectionMs === 1000 ? options.protectionMs : 2000;
  let traceCount = 0;
  const trace = (event: string, status?: string) => {
    // Opt-in, bounded event metadata only: no audio, transcripts, or provider payloads.
    if (options.debug && traceCount < 80 && Date.now() - startedAt < 30_000) {
      traceCount++;
      console.debug('[voice startup]', { ms: Date.now() - startedAt, event, state,
        ...(status && ['completed', 'cancelled', 'failed', 'incomplete'].includes(status) ? { status } : {}),
        microphoneEnabled: tracks.some(track => track.enabled) });
    }
  };
  const release = (reason: string) => {
    if (state === 'released' || state === 'disposed') return;
    const wasMuted = state !== 'ready';
    clearTimeout(timer);
    state = 'released';
    if (wasMuted) tracks.forEach(track => { track.enabled = true; });
    trace(reason);
  };
  return {
    tracks,
    start() {
      if (!options.enabled || state !== 'ready' || userHasSpoken) return;
      state = 'waiting';
      tracks.forEach(track => { track.enabled = false; });
      trace('opening_protected');
      // A failed/empty/slow opening must never leave the user unable to speak.
      timer = setTimeout(() => release('no_playback_timeout'), 10_000);
    },
    release,
    handle(event: VoiceAudioEvent) {
      if (state === 'disposed') return;
      if (['input_audio_buffer.speech_started', 'input_audio_buffer.speech_stopped', 'response.created',
        'response.done', 'output_audio_buffer.started', 'output_audio_buffer.stopped', 'output_audio_buffer.cleared'].includes(event.type)) trace(event.type, event.response?.status);
      if (event.type === 'input_audio_buffer.speech_started') userHasSpoken = true;
      if (state !== 'waiting' && state !== 'playing') return;
      if (event.type === 'response.created' && !responseId) responseId = event.response?.id;
      if (event.response_id && responseId && event.response_id !== responseId) return;
      if (event.type === 'output_audio_buffer.started' && state === 'waiting') {
        responseId = event.response_id ?? responseId;
        state = 'playing';
        clearTimeout(timer);
        // Restore input mid-sentence. Duplicate/later playback events must never
        // extend this window, and response.done must not start it prematurely.
        timer = setTimeout(() => release('microphone_restored'), protectionMs);
      } else if (state === 'waiting' && (event.type === 'output_audio_buffer.stopped' || event.type === 'output_audio_buffer.cleared')) {
        release('opening_ended_before_playback');
      } else if (event.type === 'response.done' && (!responseId || event.response?.id === responseId)) {
        const response = event.response;
        if (response?.status === 'cancelled' || response?.status === 'failed') {
          if (state === 'waiting') release('opening_cancelled');
        } else if (state === 'waiting' && response?.output && !response.output.some(item =>
          item.content?.some(content => content.type === 'audio' || content.type === 'output_audio'))) {
          release('response_without_audio');
        }
      }
    },
    dispose() {
      if (state === 'disposed') return;
      clearTimeout(timer);
      state = 'disposed';
      if (options.enabled) tracks.forEach(track => track.stop());
    },
  };
}
