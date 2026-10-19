import type { PossibilityNode } from './atlas/contracts';
import type { LiveAudioState, LiveTranscript } from './gpt-live/protocol';

export type WalkthroughState = { nodeId: string; index: number; total: number; phase: 'waiting' | 'speaking' | 'paused' };
const numbers = ['one', 'two', 'three', 'four', 'five'];
const normalize = (value: string) => (value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
  .map(word => /^[1-5]$/.test(word) ? numbers[Number(word) - 1] : word).join(' ');
const sentence = (value: string) => `${value.trim().replace(/[.!?]+$/u, '')}.`;

export function walkthroughScript(node: PossibilityNode, index: number) {
  return `Option ${numbers[index]}. ${sentence(node.title)} ${sentence(node.summary)} Key assumption: ${sentence(node.keyAssumption)} Watch for ${sentence(node.watchFor[0])}`;
}

/** One bounded, cancellable queue. Neither transcript arrival nor quiet alone advances it. */
export function createPossibilityWalkthrough(options: {
  snapshot(): { key: string; choices: PossibilityNode[] } | undefined;
  busy(): boolean;
  focus(nodeId: string, signal: AbortSignal): Promise<boolean>;
  speak(script: string): void;
  publish(state: WalkthroughState | undefined): void;
}) {
  let audio: LiveAudioState = { inputActive: false, outputActive: false };
  let queue: { key: string; choices: PossibilityNode[]; index: number; controller: AbortController;
    phase: 'waiting' | 'focusing' | 'speaking'; heard: boolean; transcript: string; script: string } | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let advance: ReturnType<typeof setTimeout> | undefined;
  const state = (phase: WalkthroughState['phase']): WalkthroughState | undefined => queue && ({
    nodeId: queue.choices[queue.index].id, index: queue.index, total: queue.choices.length, phase,
  });
  function stop(paused = false) {
    const prior = paused ? state('paused') : undefined;
    queue?.controller.abort(); queue = undefined;
    clearTimeout(deadline); clearTimeout(advance); deadline = undefined; advance = undefined;
    options.publish(prior);
  }
  function armDeadline() {
    clearTimeout(deadline);
    deadline = setTimeout(() => stop(true), 45_000);
    deadline.unref?.();
  }
  function tick() {
    const current = queue;
    if (!current) return;
    if (options.snapshot()?.key !== current.key) { stop(); return; }
    if (audio.inputActive || audio.outputActive || options.busy()) return;
    if (current.phase === 'waiting') {
      current.phase = 'focusing';
      void options.focus(current.choices[current.index].id, current.controller.signal).then(ready => {
        if (queue !== current || current.controller.signal.aborted) return;
        if (!ready || options.snapshot()?.key !== current.key || audio.inputActive) { stop(true); return; }
        // Old playback or another task starting during the DOM acknowledgment
        // must settle before the queued explanation can be spoken.
        current.phase = 'waiting';
        if (audio.outputActive || options.busy()) return;
        current.phase = 'speaking'; current.heard = false; current.transcript = '';
        current.script = walkthroughScript(current.choices[current.index], current.index);
        armDeadline(); options.publish(state('speaking')); options.speak(current.script);
      }).catch(() => { if (queue === current) stop(true); });
      return;
    }
    if (current.phase !== 'speaking' || !current.heard || advance) return;
    const transcript = normalize(current.transcript);
    const script = normalize(current.script);
    const opening = normalize(`Option ${numbers[current.index]}. ${current.choices[current.index].title}`);
    const ending = script.split(' ').slice(-10).join(' ');
    if (!transcript.includes(opening) || !transcript.includes(ending)) return;
    // The browser already observes 1.2 seconds of quiet. Add a short cancellable
    // gap, and recheck playback before committing the next card.
    advance = setTimeout(() => {
      advance = undefined;
      if (queue !== current || audio.inputActive || audio.outputActive || options.busy()) return;
      if (options.snapshot()?.key !== current.key) { stop(); return; }
      current.index++;
      if (current.index >= current.choices.length) { stop(); return; }
      current.phase = 'waiting'; current.heard = false; current.transcript = ''; current.script = '';
      armDeadline(); options.publish(state('waiting')); tick();
    }, 400);
    advance.unref?.();
  }
  return {
    start() {
      const snapshot = options.snapshot();
      if (!snapshot?.choices.length || snapshot.choices.length > 5) return false;
      stop();
      queue = { key: snapshot.key, choices: snapshot.choices, index: 0, controller: new AbortController(), phase: 'waiting', heard: false, transcript: '', script: '' };
      armDeadline(); options.publish(state('waiting')); tick(); return true;
    },
    stop,
    tick,
    observeAudio(next: LiveAudioState) {
      const previous = audio;
      audio = next;
      if (next.inputActive) { if (queue && !previous.inputActive) stop(); return; }
      if (next.outputActive) {
        clearTimeout(advance); advance = undefined;
        if (queue?.phase === 'speaking') queue.heard = true;
      }
      tick();
    },
    observeTranscript(fragment: LiveTranscript) {
      if (fragment.role !== 'assistant' || queue?.phase !== 'speaking') return;
      queue.transcript = (queue.transcript + fragment.delta).slice(-8_000);
      tick();
    },
    get active() { return Boolean(queue); },
  };
}
