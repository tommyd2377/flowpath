"use client";

import { Mic, MicOff } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type ChangeEvent,
  type ChangeEventHandler,
  type HTMLInputTypeAttribute,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-2">
      {eyebrow ? (
        <div className="text-sm font-medium uppercase text-[var(--azure-light)]">
          {eyebrow}
        </div>
      ) : null}
      <h1 className="text-3xl font-semibold tracking-normal text-white sm:text-4xl">
        {title}
      </h1>
      {children ? <div className="max-w-3xl text-slate-300">{children}</div> : null}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-slate-800 bg-slate-950 p-4 shadow-[0_18px_60px_rgba(0,0,0,0.22)] sm:p-5 ${className}`}
    >
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string | null;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-slate-200">
      <span>{label}</span>
      {children}
      {hint ? <span className="text-xs font-normal text-slate-400">{hint}</span> : null}
      {error ? <span className="text-xs font-normal text-red-200">{error}</span> : null}
    </label>
  );
}

export function CharacterCount({
  value,
  max,
}: {
  value: string;
  max: number;
}) {
  const overLimit = value.length > max;
  return (
    <div
      className={`text-xs ${overLimit ? "text-red-200" : "text-slate-500"}`}
      aria-live="polite"
    >
      {value.length}/{max}
    </div>
  );
}

const inputClass =
  "min-h-11 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-[var(--azure)] focus:ring-2 focus:ring-[rgba(0,120,212,0.28)]";

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onstart: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type WindowWithSpeechRecognition = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

type DictatableElement = HTMLInputElement | HTMLTextAreaElement;

type DictationOptions<T extends DictatableElement> = {
  controlRef: RefObject<T | null>;
  disabled: boolean;
  onChange?: ChangeEventHandler<T>;
};

type DictationProps = {
  dictation?: boolean;
};

type DictationMode = "idle" | "native" | "recording" | "transcribing";

const dictationOffStatus = "Dictation is off.";
const nativeSpeechFallbackErrors = new Set(["network", "service-not-allowed"]);

function getSpeechRecognitionConstructor() {
  if (typeof window === "undefined") return null;
  const typedWindow = window as WindowWithSpeechRecognition;
  return typedWindow.SpeechRecognition ?? typedWindow.webkitSpeechRecognition ?? null;
}

function hasMediaRecorderSupport() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return Boolean(
    navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function" &&
      typeof MediaRecorder !== "undefined",
  );
}

function subscribeDictationSupport() {
  return () => {};
}

function getDictationSupportSnapshot() {
  return Boolean(getSpeechRecognitionConstructor() || hasMediaRecorderSupport());
}

function getDictationServerSnapshot() {
  return false;
}

function dictationErrorStatus(error?: string) {
  switch (error) {
    case "audio-capture":
      return "No microphone input was detected. Check Brave and macOS microphone access.";
    case "network":
      return "Speech recognition could not reach the browser speech service. Brave may not support this reliably.";
    case "no-speech":
      return "No speech was detected. Click the mic again and start speaking right away.";
    case "not-allowed":
      return "Microphone access was not allowed.";
    case "service-not-allowed":
      return "Brave blocked the speech recognition service. Try Chrome or macOS Dictation.";
    case "aborted":
      return "Dictation was cancelled.";
    default:
      return error
        ? `Dictation stopped: ${error}.`
        : "Dictation stopped before speech was recognized.";
  }
}

function dictationRecordingErrorStatus(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Microphone access was not allowed.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No microphone was found.";
    case "NotReadableError":
      return "The microphone is unavailable or already in use.";
    case "SecurityError":
      return "This browser blocked microphone access for this page.";
    default:
      return "Dictation recording could not start.";
  }
}

function getSupportedDictationMimeType() {
  if (typeof MediaRecorder === "undefined") return "";

  const mimeTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/mpeg",
  ];

  return mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function dictationAudioFileName(mimeType: string) {
  if (mimeType.includes("mp4")) return "dictation.m4a";
  if (mimeType.includes("mpeg")) return "dictation.mp3";
  return "dictation.webm";
}

async function transcribeDictationAudio(audio: Blob) {
  const formData = new FormData();
  const mimeType = audio.type || "audio/webm";
  formData.append("audio", audio, dictationAudioFileName(mimeType));

  const response = await fetch("/api/dictation/transcribe", {
    method: "POST",
    credentials: "same-origin",
    body: formData,
  });

  const payload = await response
    .json()
    .catch(() => ({ error: "The server returned an empty response." }));

  if (!response.ok) {
    throw new Error(payload.error || "Dictation could not be transcribed.");
  }

  return String(payload.data?.text ?? "").trim();
}

function appendDictationText<T extends DictatableElement>(
  element: T,
  transcript: string,
  onChange?: ChangeEventHandler<T>,
) {
  const cleanTranscript = transcript.trim();
  if (!cleanTranscript) return;

  const currentValue = element.value;
  const selectionStart = element.selectionStart ?? currentValue.length;
  const selectionEnd = element.selectionEnd ?? currentValue.length;
  const before = currentValue.slice(0, selectionStart);
  const after = currentValue.slice(selectionEnd);
  const leadingSpace = before && !/\s$/.test(before) ? " " : "";
  const trailingSpace = after && !/^[\s.,!?;:)]/.test(after) ? " " : "";
  const insertion = `${leadingSpace}${cleanTranscript}${trailingSpace}`;
  const nextValue = `${before}${insertion}${after}`;
  const nextCursor = before.length + insertion.length;

  element.value = nextValue;
  onChange?.({ target: element, currentTarget: element } as ChangeEvent<T>);
  element.dispatchEvent(new Event("input", { bubbles: true }));

  requestAnimationFrame(() => {
    try {
      element.selectionStart = nextCursor;
      element.selectionEnd = nextCursor;
    } catch {
      // Some input types do not expose text selection. The dictated text still lands.
    }
  });
}

function useDictation<T extends DictatableElement>({
  controlRef,
  disabled,
  onChange,
}: DictationOptions<T>) {
  const isSupported = useSyncExternalStore(
    subscribeDictationSupport,
    getDictationSupportSnapshot,
    getDictationServerSnapshot,
  );
  const [mode, setMode] = useState<DictationMode>("idle");
  const [status, setStatus] = useState(dictationOffStatus);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const lastErrorRef = useRef<string | null>(null);
  const manualStopRef = useRef(false);
  const nativeFallbackInProgressRef = useRef(false);
  const modeRef = useRef<DictationMode>("idle");
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      manualStopRef.current = true;
      recognitionRef.current?.abort();
      discardRecordingRef.current = true;
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const setDictationMode = useCallback((nextMode: DictationMode) => {
    modeRef.current = nextMode;
    setMode(nextMode);
  }, []);

  const stopMediaStream = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }, []);

  const transcribeRecording = useCallback(
    async (control: T, audio: Blob) => {
      if (!audio.size) {
        setDictationMode("idle");
        setStatus("No speech was recorded.");
        return;
      }

      setDictationMode("transcribing");
      setStatus("Transcribing dictation...");

      try {
        const transcript = await transcribeDictationAudio(audio);
        if (!isMountedRef.current) return;
        appendDictationText(control, transcript, onChange);
        setStatus(transcript ? "Added dictation." : "No speech was transcribed.");
      } catch (error) {
        if (!isMountedRef.current) return;
        setStatus(
          error instanceof Error
            ? error.message
            : "Dictation could not be transcribed.",
        );
      } finally {
        if (isMountedRef.current) setDictationMode("idle");
      }
    },
    [onChange, setDictationMode],
  );

  const startRecordingFallback = useCallback(
    async (control: T) => {
      if (!hasMediaRecorderSupport() || disabled) {
        setDictationMode("idle");
        setStatus("Dictation recording is not available in this browser.");
        return;
      }

      let stream: MediaStream | null = null;
      try {
        setStatus("Starting microphone recording...");
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (disabled || !isMountedRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const mimeType = getSupportedDictationMimeType();
        const recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined,
        );

        audioChunksRef.current = [];
        discardRecordingRef.current = false;
        mediaStreamRef.current = stream;
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) audioChunksRef.current.push(event.data);
        };

        recorder.onerror = () => {
          discardRecordingRef.current = true;
          setDictationMode("idle");
          setStatus("Dictation recording failed.");
          stopMediaStream();
        };

        recorder.onstop = () => {
          const chunks = audioChunksRef.current;
          const shouldDiscard = discardRecordingRef.current;
          audioChunksRef.current = [];
          discardRecordingRef.current = false;
          mediaRecorderRef.current = null;
          stopMediaStream();

          if (shouldDiscard || !isMountedRef.current) return;

          const audio = new Blob(chunks, {
            type: recorder.mimeType || mimeType || "audio/webm",
          });
          void transcribeRecording(control, audio);
        };

        recorder.start();
        control.focus();
        setDictationMode("recording");
        setStatus("Recording. Click the microphone again to transcribe.");
      } catch (error) {
        stream?.getTracks().forEach((track) => track.stop());
        setDictationMode("idle");
        setStatus(dictationRecordingErrorStatus(error));
      }
    },
    [disabled, setDictationMode, stopMediaStream, transcribeRecording],
  );

  const stopRecording = useCallback(
    (shouldTranscribe = true) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") return;

      discardRecordingRef.current = !shouldTranscribe;
      recorder.stop();
      if (shouldTranscribe) {
        setDictationMode("transcribing");
        setStatus("Transcribing dictation...");
      } else {
        setDictationMode("idle");
        setStatus(dictationOffStatus);
      }
    },
    [setDictationMode],
  );

  const stopDictation = useCallback(() => {
    if (modeRef.current === "recording") {
      stopRecording(true);
      return;
    }

    if (modeRef.current === "transcribing") return;

    manualStopRef.current = true;
    recognitionRef.current?.stop();
    setDictationMode("idle");
    setStatus("Dictation stopped.");
  }, [setDictationMode, stopRecording]);

  const startDictation = useCallback(() => {
    const Recognition = getSpeechRecognitionConstructor();
    const control = controlRef.current;
    if (!control || disabled) return;

    if (!Recognition) {
      void startRecordingFallback(control);
      return;
    }

    manualStopRef.current = true;
    recognitionRef.current?.abort();
    manualStopRef.current = false;
    lastErrorRef.current = null;

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-US";
    recognition.onstart = () => {
      setDictationMode("native");
      setStatus("Listening. Start speaking, then click the microphone to stop.");
    };
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal) transcript += ` ${result[0].transcript}`;
      }
      appendDictationText(control, transcript, onChange);
    };
    recognition.onerror = (event) => {
      lastErrorRef.current = event.error ?? "unknown";
      if (
        event.error &&
        nativeSpeechFallbackErrors.has(event.error) &&
        hasMediaRecorderSupport()
      ) {
        nativeFallbackInProgressRef.current = true;
        setStatus("Browser speech service failed. Recording audio instead...");
        void startRecordingFallback(control);
        return;
      }
      setDictationMode("idle");
      setStatus(dictationErrorStatus(event.error));
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      if (nativeFallbackInProgressRef.current) {
        nativeFallbackInProgressRef.current = false;
        return;
      }
      setDictationMode("idle");
      if (manualStopRef.current) {
        manualStopRef.current = false;
        setStatus("Dictation stopped.");
        return;
      }
      if (!lastErrorRef.current) {
        setStatus("Dictation ended. Click the mic to start again.");
      }
    };

    recognitionRef.current = recognition;
    control.focus();
    setStatus("Starting dictation...");

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      void startRecordingFallback(control);
    }
  }, [controlRef, disabled, onChange, setDictationMode, startRecordingFallback]);

  const isListening = mode !== "idle";

  return {
    canDictate: isSupported && !disabled,
    isListening,
    isTranscribing: mode === "transcribing",
    status,
    toggleDictation: isListening ? stopDictation : startDictation,
  };
}

function isTextLikeInputType(type: HTMLInputTypeAttribute | undefined) {
  return (
    !type ||
    [
      "email",
      "search",
      "tel",
      "text",
      "url",
    ].includes(type)
  );
}

function DictationButton({
  isListening,
  isTranscribing,
  onClick,
}: {
  isListening: boolean;
  isTranscribing: boolean;
  onClick: () => void;
}) {
  const label = isTranscribing
    ? "Transcribing dictation"
    : isListening
      ? "Stop and transcribe dictation"
      : "Dictate into this field";

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={label}
        disabled={isTranscribing}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
        className={`absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md border text-slate-300 transition focus:outline-none focus:ring-2 focus:ring-[rgba(0,120,212,0.38)] disabled:cursor-not-allowed disabled:opacity-70 ${
          isListening
            ? "border-[var(--azure)] bg-[rgba(0,120,212,0.22)] text-white"
            : "border-slate-700 bg-slate-950/90 hover:border-[var(--azure)] hover:text-white"
        }`}
      >
        {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </button>
    </>
  );
}

function DictationStatus({
  isListening,
  status,
}: {
  isListening: boolean;
  status: string;
}) {
  if (status === dictationOffStatus) return null;

  return (
    <div
      aria-live="polite"
      className={`mt-1 text-xs ${
        isListening ? "text-blue-100" : "text-amber-200"
      }`}
    >
      {status}
    </div>
  );
}

export function TextInput({
  className = "",
  dictation = true,
  disabled,
  readOnly,
  onChange,
  type,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & DictationProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const shouldOfferDictation =
    dictation && isTextLikeInputType(type) && !disabled && !readOnly;
  const { canDictate, isListening, isTranscribing, status, toggleDictation } =
    useDictation<HTMLInputElement>({
      controlRef: inputRef,
      disabled: !shouldOfferDictation,
      onChange,
    });

  return (
    <div className="relative">
      <input
        {...props}
        ref={inputRef}
        type={type}
        disabled={disabled}
        readOnly={readOnly}
        onChange={onChange}
        className={`${inputClass} ${shouldOfferDictation ? "pr-11" : ""} ${className}`}
      />
      {canDictate ? (
        <DictationButton
          isListening={isListening}
          isTranscribing={isTranscribing}
          onClick={toggleDictation}
        />
      ) : null}
      {canDictate ? (
        <DictationStatus isListening={isListening} status={status} />
      ) : null}
    </div>
  );
}

export function TextArea({
  className = "",
  dictation = true,
  disabled,
  readOnly,
  onChange,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & DictationProps) {
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const shouldOfferDictation = dictation && !disabled && !readOnly;
  const { canDictate, isListening, isTranscribing, status, toggleDictation } =
    useDictation<HTMLTextAreaElement>({
      controlRef: textAreaRef,
      disabled: !shouldOfferDictation,
      onChange,
    });

  return (
    <div className="relative">
      <textarea
        {...props}
        ref={textAreaRef}
        disabled={disabled}
        readOnly={readOnly}
        onChange={onChange}
        className={`${inputClass} min-h-28 resize-y ${shouldOfferDictation ? "pr-11" : ""} leading-6 ${className}`}
      />
      {canDictate ? (
        <DictationButton
          isListening={isListening}
          isTranscribing={isTranscribing}
          onClick={toggleDictation}
        />
      ) : null}
      {canDictate ? (
        <DictationStatus isListening={isListening} status={status} />
      ) : null}
    </div>
  );
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  const variants = {
    primary: "bg-[var(--azure)] text-white hover:bg-[#106ebe] disabled:bg-slate-700 disabled:text-slate-400",
    secondary:
      "border border-slate-700 bg-slate-900 text-slate-200 hover:border-[var(--azure)] hover:bg-slate-800 disabled:text-slate-500",
    danger:
      "border border-red-900/70 bg-red-950/45 text-red-200 hover:bg-red-900/55 disabled:text-red-800",
    ghost: "text-slate-300 hover:bg-slate-900 hover:text-white disabled:text-slate-600",
  };

  return (
    <button
      {...props}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "error" | "success" | "warning";
}) {
  const tones = {
    info: "border-slate-800 bg-slate-950 text-slate-300",
    error: "border-red-900/70 bg-red-950/45 text-red-100",
    success: "border-[rgba(0,120,212,0.55)] bg-[rgba(0,120,212,0.14)] text-blue-100",
    warning: "border-amber-900/70 bg-amber-950/45 text-amber-100",
  };

  return <div className={`rounded-lg border p-3 text-sm ${tones[tone]}`}>{children}</div>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/70 p-6 text-sm text-slate-400">
      {children}
    </div>
  );
}
