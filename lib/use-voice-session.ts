'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoicePhase } from '@/components/Waveform';
import { IDLE_SECONDS, SESSION_SECONDS, HOSTED_SESSION_SECONDS } from './session-config';
import { getInstallationId, loadSelectedHeadline } from './news-storage';
import { emptyDisplay, ExplorationDisplaySchema, type ExplorationAction, type ExplorationDisplay } from './visual-contracts';
import { toStoryHeadline } from './story-contracts';
import { ScreenRequestSchema } from './screen-contracts';
import { handleScreenRequest, observeScreen } from './screen-client';
import { createSessionTransport, type SessionTransport } from './session-transport';

type ResearchStatus = { busy: boolean; message: string; revision: number };

type LiveSession = {
  id: string;
  controller: AbortController;
  transport: SessionTransport;
  context?: AudioContext;
  stream?: MediaStream;
  peer?: RTCPeerConnection;
  channel?: RTCDataChannel;
  audio?: HTMLAudioElement;
  setupTimer?: ReturnType<typeof setTimeout>;
  sessionTimer?: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setTimeout>;
  disconnectTimer?: ReturnType<typeof setTimeout>;
  requested: boolean;
  speaking: boolean;
  userSpeaking: boolean;
  responseId?: string;
  playingId?: string;
  sdpReady: boolean;
  channelReady: boolean;
  researchBusy: boolean;
  researchRevision: number;
  acceptedStoryRevision?: number;
  selectionFloorRevision: number;
  bufferedResearch?: ResearchStatus;
  bufferedDisplay?: ExplorationDisplay;
  selectionPending: boolean;
  desiredHeadlineId?: string;
  selectedHeadlineId?: string;
  sendSelection?: () => void;
  briefingRequested?: boolean;
};

async function responseError(response: Response) {
  try {
    const body = await response.json();
    if (typeof body.error === 'string') return body.error;
    if (typeof body.error?.message === 'string') return body.error.message;
  } catch { /* A gateway may return a non-JSON response. */ }
  return 'The voice connection is unavailable. Please try again.';
}

export function useVoiceSession() {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [message, setMessage] = useState('');
  const [inputAnalyser, setInputAnalyser] = useState<AnalyserNode | null>(null);
  const [outputAnalyser, setOutputAnalyser] = useState<AnalyserNode | null>(null);
  const [display, setDisplay] = useState<ExplorationDisplay | null>(null);
  const displayRef = useRef<ExplorationDisplay | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [researchBusy, setResearchBusy] = useState(false);
  const offline = useRef<AbortController | null>(null);
  const current = useRef<LiveSession | null>(null);
  const mounted = useRef(true);
  const revision = useRef(0);

  const showDisplay = useCallback((value: ExplorationDisplay) => {
    displayRef.current = value;
    if (mounted.current) setDisplay(value);
  }, []);

  const dispose = useCallback((session: LiveSession) => {
    session.controller.abort();
    clearTimeout(session.setupTimer);
    clearTimeout(session.sessionTimer);
    clearTimeout(session.idleTimer);
    clearTimeout(session.disconnectTimer);
    session.channel?.close();
    session.peer?.close();
    session.stream?.getTracks().forEach((track) => track.stop());
    if (session.audio) {
      session.audio.pause();
      session.audio.srcObject = null;
    }
    if (session.context?.state !== 'closed') void session.context?.close().catch(() => {});
    if (session.requested) {
      // keepalive lets the local server close the call when the page is leaving.
      return session.transport.fetch('/api/session', {
        method: 'DELETE',
        headers: { 'X-Voice-Session': session.id },
        keepalive: true,
      }).then((response) => response.ok).catch(() => false).finally(() => session.transport.close());
    }
    session.transport.close();
    return Promise.resolve(true);
  }, []);

  const stop = useCallback((notice = '') => {
    offline.current?.abort();
    offline.current = null;
    const session = current.current;
    current.current = null;
    const stoppedRevision = ++revision.current;
    if (session) {
      void dispose(session).then((closed) => {
        if (!closed && mounted.current && !current.current && revision.current === stoppedRevision) {
          setPhase('error');
          setMessage('Your microphone is off, but disconnection could not be confirmed. Wait for the session limit before reconnecting.');
        }
      });
    }
    if (mounted.current) {
      setSessionActive(false);
      setResearchBusy(false);
      setPhase('idle');
      setMessage(notice);
      setInputAnalyser(null);
      setOutputAnalyser(null);
    }
  }, [dispose]);

  const fail = useCallback((session: LiveSession, notice: string) => {
    if (current.current !== session) return;
    stop();
    if (mounted.current) {
      setPhase('error');
      setMessage(notice);
    }
  }, [stop]);

  const start = useCallback(async (headlineId?: string, briefHeadlines = false) => {
    if (current.current) {
      if (headlineId) {
        const session = current.current;
        if (session.desiredHeadlineId !== headlineId) {
          const saved = loadSelectedHeadline();
          const chosen = displayRef.current?.stories?.find(story => story.id === headlineId);
          showDisplay({ ...emptyDisplay(), headline: chosen ? toStoryHeadline(chosen) : saved?.id === headlineId ? saved : null, view: 'exploration', stories: displayRef.current?.stories });
          session.desiredHeadlineId = headlineId;
          session.acceptedStoryRevision = undefined;
          session.selectionFloorRevision = Math.max(1, session.researchRevision + 1);
          session.bufferedResearch = undefined;
          session.bufferedDisplay = undefined;
          session.researchBusy = true;
          setResearchBusy(true);
          clearTimeout(session.idleTimer);
          if (session.channelReady) {
            setMessage('Looking into this story…');
            setPhase(session.speaking ? 'speaking' : session.userSpeaking ? 'listening' : 'thinking');
          }
        }
        session.sendSelection?.();
      }
      return;
    }
    offline.current?.abort();
    offline.current = null;
    setResearchBusy(false);
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection || !window.AudioContext) {
      setPhase('error');
      setMessage('This browser cannot start a voice conversation. Try a current browser on localhost or HTTPS.');
      return;
    }
    const sessionId = crypto.randomUUID();
    const session: LiveSession = {
      id: sessionId,
      transport: createSessionTransport({
        sessionId, installationId: getInstallationId(),
        onDisconnect: () => fail(session, 'The hosted connection ended. Tap the wave to reconnect.'),
      }),
      controller: new AbortController(),
      requested: false,
      speaking: false,
      userSpeaking: false,
      sdpReady: false,
      channelReady: false,
      researchBusy: false,
      researchRevision: -1,
      selectionFloorRevision: 1,
      selectionPending: false,
      desiredHeadlineId: headlineId,
    };
    current.current = session;
    setSessionActive(true);
    revision.current++;
    const alive = () => current.current === session;
    setPhase('connecting');
    setMessage('');

    const idle = () => {
      clearTimeout(session.idleTimer);
      if (session.researchBusy || session.selectionPending || session.speaking || session.userSpeaking) return;
      session.idleTimer = setTimeout(() => {
        if (alive()) stop('Taking a pause. Tap the wave when you’re ready.');
      }, IDLE_SECONDS * 1000);
    };

    const restingPhase = () => {
      if (!alive()) return;
      if (!session.sdpReady || !session.channelReady) {
        setPhase('connecting');
        return;
      }
      setPhase(session.speaking ? 'speaking' : session.userSpeaking ? 'listening' : session.researchBusy ? 'thinking' : 'listening');
      idle();
    };

    const showResearch = (status: ResearchStatus) => {
      session.researchRevision = status.revision;
      session.researchBusy = status.busy;
      setResearchBusy(status.busy);
      setMessage(status.message);
      restingPhase();
    };

    const acknowledgeStory = (selectedId: string, storyRevision: unknown, fromServer = false) => {
      if (!alive() || typeof storyRevision !== 'number'
        || !Number.isSafeInteger(storyRevision) || storyRevision < session.selectionFloorRevision
        || storyRevision < session.researchRevision) return;
      if (selectedId !== session.desiredHeadlineId) {
        // An outstanding click takes priority over a prior voice command.
        if (!fromServer || session.selectionPending || session.desiredHeadlineId !== session.selectedHeadlineId) return;
        session.desiredHeadlineId = selectedId;
        session.selectedHeadlineId = selectedId;
      }
      session.acceptedStoryRevision = storyRevision;
      session.researchRevision = storyRevision;
      const buffered = session.bufferedResearch;
      session.bufferedResearch = undefined;
      if (buffered?.revision === storyRevision) showResearch(buffered);
      const bufferedDisplay = session.bufferedDisplay;
      session.bufferedDisplay = undefined;
      if (bufferedDisplay?.revision === storyRevision) showDisplay(bufferedDisplay);
    };

    session.sendSelection = () => {
      if (!alive() || !session.sdpReady || !session.channelReady || session.selectionPending) return;
      if (!session.desiredHeadlineId && briefHeadlines && !session.briefingRequested) {
        session.briefingRequested = true;
        session.researchBusy = true;
        setResearchBusy(true);
        clearTimeout(session.idleTimer);
        void session.transport.fetch('/api/session/action', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Voice-Session': session.id },
          body: JSON.stringify({ action: { type: 'start_briefing' } }), signal: session.controller.signal,
        }).then(async (response) => {
          if (!response.ok) throw new Error(await responseError(response));
        }).catch((error) => {
          if (!alive() || session.desiredHeadlineId) return;
          session.researchBusy = false;
          setResearchBusy(false);
          setMessage(error instanceof Error ? error.message : 'The briefing could not start. You can still ask about the news.');
          restingPhase();
        });
      }
      if (!session.desiredHeadlineId || session.desiredHeadlineId === session.selectedHeadlineId) return;
      session.selectionPending = true;
      session.researchBusy = true;
      setResearchBusy(true);
      clearTimeout(session.idleTimer);
      setMessage('Looking into this story…');
      restingPhase();
      void (async () => {
        while (alive() && session.desiredHeadlineId && session.desiredHeadlineId !== session.selectedHeadlineId) {
          const selectedId = session.desiredHeadlineId;
          try {
            const response = await session.transport.fetch('/api/session/story', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Voice-Session': session.id, 'X-Voice-Installation': getInstallationId() },
              body: JSON.stringify({ headlineId: selectedId }),
              signal: session.controller.signal,
            });
            if (!response.ok) throw new Error(await responseError(response));
            const selection = await response.json().catch(() => null);
            if (!alive()) return;
            session.selectedHeadlineId = selectedId;
            acknowledgeStory(selectedId, selection?.revision);
          } catch (error) {
            if (!alive()) return;
            // A newer click owns the UI even if the preceding request failed.
            if (session.desiredHeadlineId !== selectedId) continue;
            session.researchBusy = false;
            setResearchBusy(false);
            setMessage(error instanceof Error ? error.message : 'This story could not be opened. Choose it again to retry.');
            break;
          }
        }
        session.selectionPending = false;
        restingPhase();
      })();
    };

    const seenScreenRequests = new Set<string>();
    let screenQueue = Promise.resolve();
    const readEvents = async () => {
      try {
        const response = await session.transport.fetch('/api/session/events', {
          headers: { 'X-Voice-Session': session.id },
          cache: 'no-store', signal: session.controller.signal,
        });
        if (!response.ok || !response.body) throw new Error('The story connection was interrupted. Tap the wave to reconnect.');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (alive()) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer = (buffer + decoder.decode(chunk.value, { stream: true })).replace(/\r\n/g, '\n');
          if (buffer.length > 524_288) throw new Error('The story connection was interrupted. Tap the wave to reconnect.');
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
            if (!data) continue;
            let event: { type?: string; busy?: boolean; message?: string; revision?: number; headlineId?: string; display?: unknown };
            try { event = JSON.parse(data); } catch { continue; }
            if (!event || typeof event !== 'object' || !alive()) continue;
            if (event.type === 'ended') {
              stop(typeof event.message === 'string' ? event.message : 'Conversation ended. Tap the wave when you’re ready.');
              return;
            }
            if (typeof event.revision !== 'number' || !Number.isSafeInteger(event.revision) || event.revision < session.researchRevision) continue;
            if (event.type === 'screen_request') {
              const parsed = ScreenRequestSchema.safeParse(event);
              if (!parsed.success || seenScreenRequests.has(parsed.data.requestId) || seenScreenRequests.size >= 64) continue;
              seenScreenRequests.add(parsed.data.requestId);
              screenQueue = screenQueue.then(async () => {
                if (!alive()) return;
                const report = await handleScreenRequest(parsed.data, () => displayRef.current, session.controller.signal);
                if (!report || !alive()) return;
                await session.transport.fetch('/api/session/screen', {
                  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Voice-Session': session.id },
                  body: JSON.stringify(report), signal: session.controller.signal,
                });
              }).catch(() => { /* The server reports an unconfirmed action; keep audio connected. */ });
              continue;
            }
            if (event.type === 'story' && typeof event.headlineId === 'string') {
              acknowledgeStory(event.headlineId, event.revision, true);
              continue;
            }
            if (event.type === 'display') {
              const parsed = ExplorationDisplaySchema.safeParse(event.display);
              if (!parsed.success || parsed.data.revision !== event.revision) continue;
              if (session.desiredHeadlineId && event.revision !== session.acceptedStoryRevision) {
                if (event.revision >= session.selectionFloorRevision) session.bufferedDisplay = parsed.data;
                continue;
              }
              const saved = loadSelectedHeadline();
              const headline = parsed.data.headline ?? (saved?.id === session.desiredHeadlineId ? saved : null);
              showDisplay({ ...parsed.data, headline });
              continue;
            }
            if (event.type !== 'research' || typeof event.busy !== 'boolean') continue;
            const status = { busy: event.busy, message: typeof event.message === 'string' ? event.message : '', revision: event.revision };
            if (session.desiredHeadlineId && event.revision !== session.acceptedStoryRevision) {
              // The initial snapshot and a preceding story must not overwrite a
              // new click while its selection acknowledgement is still in flight.
              if (event.revision >= session.selectionFloorRevision
                && (!session.bufferedResearch || event.revision >= session.bufferedResearch.revision)) session.bufferedResearch = status;
              continue;
            }
            showResearch(status);
          }
        }
        if (alive()) throw new Error('The story connection was interrupted. Tap the wave to reconnect.');
      } catch (error) {
        if (alive()) fail(session, error instanceof Error ? error.message : 'The story connection was interrupted. Tap the wave to reconnect.');
      }
    };

    try {
      // Resume in the tap/keypress handler, before any network await, for autoplay rules.
      session.context = new AudioContext();
      await session.context.resume();
      if (!alive()) return;
      session.setupTimer = setTimeout(() => fail(session, 'The connection took too long. Tap the wave to try again.'), 30_000);
      const readiness = await session.transport.fetch('/api/session', { signal: session.controller.signal, cache: 'no-store' });
      if (!readiness.ok) throw new Error(await responseError(readiness));
      const config = await readiness.json();
      if (!config.ready) {
        throw new Error(config.reason === 'cleanup_failed'
          ? 'The previous connection could not be closed. Check the local server before trying again.'
          : config.reason === 'fixture'
            ? 'Fixture preview: voice is disabled. The automated tests simulate audio.'
            : 'Your voice connection isn’t set up yet. Add your test key locally, then try again.');
      }
      if (!alive()) return;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (!alive()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      session.stream = stream;
      for (const track of stream.getAudioTracks()) {
        track.onended = () => fail(session, 'Microphone access ended. Tap the wave to reconnect.');
      }
      const input = session.context.createAnalyser();
      input.fftSize = 2048;
      session.context.createMediaStreamSource(stream).connect(input);
      setInputAnalyser(input);

      const peer = new RTCPeerConnection();
      session.peer = peer;
      session.audio = new Audio();
      session.audio.autoplay = true;
      session.audio.setAttribute('playsinline', '');
      peer.ontrack = (event) => {
        if (!alive() || !session.audio || !session.context) return;
        const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
        session.audio.srcObject = remoteStream;
        const output = session.context.createAnalyser();
        output.fftSize = 2048;
        const silent = session.context.createGain();
        silent.gain.value = 0;
        session.context.createMediaStreamSource(remoteStream).connect(output);
        output.connect(silent).connect(session.context.destination);
        setOutputAnalyser(output);
        void session.audio.play().catch(() => fail(session, 'Audio playback was blocked. Tap the wave to try again.'));
      };
      peer.onconnectionstatechange = () => {
        if (!alive()) return;
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
          fail(session, 'The conversation disconnected. Tap the wave to reconnect.');
        } else if (peer.connectionState === 'disconnected') {
          clearTimeout(session.disconnectTimer);
          session.disconnectTimer = setTimeout(() => fail(session, 'The connection was lost. Tap the wave to reconnect.'), 5_000);
        } else if (peer.connectionState === 'connected') {
          clearTimeout(session.disconnectTimer);
        }
      };
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      const channel = peer.createDataChannel('oai-events');
      session.channel = channel;
      channel.onopen = () => {
        if (!alive()) return;
        session.channelReady = true;
        clearTimeout(session.setupTimer);
        restingPhase();
        session.sendSelection?.();
      };
      channel.onclose = () => {
        if (alive()) fail(session, 'The conversation ended. Tap the wave to start again.');
      };
      channel.onerror = () => fail(session, 'The voice connection was interrupted. Tap the wave to reconnect.');
      channel.onmessage = (messageEvent) => {
        if (!alive()) return;
        let event: { type: string; response_id?: string; response?: { id?: string; status?: string }; error?: { code?: string; event_id?: string } };
        try { event = JSON.parse(messageEvent.data); } catch { return; }
        if (!event || typeof event !== 'object' || typeof event.type !== 'string') return;
        switch (event.type) {
          case 'input_audio_buffer.speech_started':
            session.userSpeaking = true;
            session.speaking = false;
            clearTimeout(session.idleTimer);
            setPhase('listening');
            break;
          case 'input_audio_buffer.speech_stopped':
            session.userSpeaking = false;
            setPhase('thinking');
            idle();
            break;
          case 'response.created':
            session.responseId = event.response?.id;
            if (!session.speaking && !session.userSpeaking) {
              setPhase('thinking');
              idle();
            }
            break;
          case 'output_audio_buffer.started':
            session.speaking = true;
            session.playingId = event.response_id;
            clearTimeout(session.idleTimer);
            setPhase('speaking');
            break;
          case 'output_audio_buffer.stopped':
          case 'output_audio_buffer.cleared':
            if (event.response_id && session.playingId && event.response_id !== session.playingId) break;
            session.speaking = false;
            session.playingId = undefined;
            restingPhase();
            if (!session.userSpeaking) idle();
            break;
          case 'response.done':
            if (event.response?.id && session.responseId && event.response.id !== session.responseId) break;
            if (event.response?.status === 'failed') {
              fail(session, 'The voice service could not respond. Tap the wave to try again.');
            } else if (!session.speaking && !session.userSpeaking) {
              // Generation completion may precede playback completion.
              restingPhase();
              idle();
            }
            break;
          case 'error':
            if ((typeof event.error?.event_id === 'string' && event.error.event_id.startsWith('voice_cleanup_'))
              || event.error?.code === 'conversation_already_has_active_response') break;
            fail(session, 'The voice service reported a problem. Tap the wave to try again.');
            break;
        }
      };
      const offer = await peer.createOffer();
      if (!alive()) return;
      await peer.setLocalDescription(offer);
      if (!alive()) return;
      session.requested = true;
      const response = await session.transport.fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp', 'X-Voice-Session': session.id, 'X-Voice-Installation': getInstallationId() },
        body: offer.sdp,
        signal: session.controller.signal,
      });
      if (!response.ok) {
        // An explicit client-error rejection never opened this call. Preserve the
        // original failure instead of issuing a DELETE that can hide it.
        if (response.status >= 400 && response.status < 500) session.requested = false;
        throw new Error(await responseError(response));
      }
      const sdp = await response.text();
      if (!alive()) return;
      session.sdpReady = true;
      observeScreen(() => displayRef.current, (screen, sequence) => session.transport.fetch('/api/session/screen', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Voice-Session': session.id },
        body: JSON.stringify({ type: 'observation', screen, sequence }), signal: session.controller.signal,
      }), session.controller.signal);
      void readEvents();
      await peer.setRemoteDescription({ type: 'answer', sdp });
      if (!alive()) return;
      session.sendSelection?.();
      session.sessionTimer = setTimeout(() => {
        if (alive()) stop('A little breather. Tap the wave to start a fresh conversation.');
      }, (process.env.NEXT_PUBLIC_VOICE_HOSTED === '1' ? HOSTED_SESSION_SECONDS : SESSION_SECONDS) * 1000);
    } catch (error) {
      if (!alive()) return;
      const name = error instanceof DOMException ? error.name : '';
      const notice = name === 'NotAllowedError'
        ? 'Microphone access is off. Allow it in your browser, then tap the wave.'
        : name === 'NotFoundError'
          ? 'No microphone was found. Connect one, then tap the wave.'
          : name === 'NotReadableError'
            ? 'Your microphone is unavailable. Check whether another app is using it.'
            : error instanceof Error && error.name !== 'TypeError'
              ? error.message
              : 'Couldn’t reach the voice service. Check your connection and try again.';
      fail(session, notice);
    }
  }, [fail, stop, showDisplay]);

  const act = useCallback(async (action: ExplorationAction) => {
    const session = current.current;
    if (session && action.type === 'select_story') {
      if (session.desiredHeadlineId !== action.storyId || session.selectedHeadlineId !== action.storyId) {
        await start(action.storyId);
        return;
      }
      showDisplay({ ...(displayRef.current ?? emptyDisplay()), view: 'exploration' });
      // Reopening the selected card still updates the shared view, without
      // selecting or researching its already-loaded graph a second time.
    }
    if (action.type === 'show_stories') {
      showDisplay({ ...(displayRef.current ?? emptyDisplay()), view: 'stories' });
      if (!session) return;
    }
    if (session) {
      if (!session.sdpReady || !session.channelReady) return;
      try {
        const response = await session.transport.fetch('/api/session/action', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Voice-Session': session.id },
          body: JSON.stringify({ action, headlineId: session.desiredHeadlineId }), signal: session.controller.signal,
        });
        if (!response.ok) throw new Error(await responseError(response));
      } catch (error) {
        if (current.current === session) setMessage(error instanceof Error ? error.message : 'That action could not be completed.');
      }
      return;
    }
    if (action.type === 'start_briefing') return;
    offline.current?.abort();
    const controller = new AbortController();
    offline.current = controller;
    const actionRevision = ++revision.current;
    if (action.type === 'select_story') {
      const story = displayRef.current?.stories?.find((story) => story.id === action.storyId);
      const headline = story ? toStoryHeadline(story) : (loadSelectedHeadline()?.id === action.storyId ? loadSelectedHeadline() : null);
      showDisplay({ ...emptyDisplay(), headline, view: 'exploration', stories: displayRef.current?.stories });
    }
    setResearchBusy(true);
    setPhase('thinking');
    setMessage('Looking into this story…');
    try {
      const response = await fetch('/api/exploration', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Voice-Installation': getInstallationId() },
        body: JSON.stringify({ action, headlineId: displayRef.current?.headline?.id }), signal: controller.signal,
      });
      if (!response.ok) throw new Error(await responseError(response));
      const parsed = ExplorationDisplaySchema.safeParse((await response.json()).display);
      if (!parsed.success) throw new Error('The story returned an incomplete display. Try again.');
      if (controller.signal.aborted || current.current || revision.current !== actionRevision) return;
      showDisplay({ ...parsed.data, view: displayRef.current?.view ?? parsed.data.view, stories: displayRef.current?.stories });
      setMessage('');
      setPhase('idle');
    } catch (error) {
      if (controller.signal.aborted || current.current || revision.current !== actionRevision) return;
      setPhase('error');
      setMessage(error instanceof Error ? error.message : 'This story could not be opened. Try again.');
    } finally {
      if (offline.current === controller) {
        offline.current = null;
        if (mounted.current) setResearchBusy(false);
      }
    }
  }, [start, showDisplay]);

  const selectStory = useCallback((headlineId: string) => { void act({ type: 'select_story', storyId: headlineId }); }, [act]);

  useEffect(() => {
    const controller = new AbortController();
    const restoreRevision = revision.current;
    void fetch('/api/exploration', {
      headers: { 'X-Voice-Installation': getInstallationId() }, cache: 'no-store', signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return;
      const value = await response.json();
      const parsed = ExplorationDisplaySchema.safeParse(value.display);
      if (!controller.signal.aborted && !current.current && revision.current === restoreRevision && parsed.success) {
        // Restore saved research without navigating away from the landing grid.
        showDisplay({ ...parsed.data, view: 'stories' });
      }
    }).catch(() => {});
    return () => controller.abort();
  }, [showDisplay]);

  useEffect(() => {
    mounted.current = true;
    const pagehide = () => stop();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && current.current) stop('Conversation ended. See you in a moment.');
    };
    window.addEventListener('pagehide', pagehide);
    // Ending microphone capture takes priority over embedded UI keyboard handlers.
    window.addEventListener('keydown', keydown, true);
    return () => {
      mounted.current = false;
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('keydown', keydown, true);
      stop();
    };
  }, [stop]);

  return { phase, message, inputAnalyser, outputAnalyser, start, stop, selectStory, display, act, sessionActive, researchBusy };
}
