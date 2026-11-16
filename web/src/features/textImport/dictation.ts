import { useCallback, useEffect, useRef, useState } from "react";

// The Web Speech API (Chrome on Android ships it as webkitSpeechRecognition).
// Typed by hand: TypeScript's DOM lib does not include it.
interface SpeechResultList {
  length: number;
  [i: number]: { isFinal: boolean; 0: { transcript: string } };
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: SpeechResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

export function recognitionCtor(): RecognitionCtor | null {
  const w = globalThis as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Chrome on Android repeats earlier text in each new result ("add", "add
// the", "add the beef"). Keep only the longest of a run that grows like that.
export function transcriptOf(results: SpeechResultList): string {
  const parts: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const t = results[i][0].transcript.trim();
    if (!t) continue;
    const last = parts[parts.length - 1];
    if (last !== undefined && t.toLowerCase().startsWith(last.toLowerCase())) parts[parts.length - 1] = t;
    else parts.push(t);
  }
  return parts.join(" ");
}

export const joinText = (base: string, spoken: string) =>
  !spoken ? base : !base.trim() ? spoken : `${base}${/\s$/.test(base) ? "" : " "}${spoken}`;

// Dictation that appends to `text`. Listening continues until stop() (the
// browser ends a session after a pause, so it is restarted).
export function useDictation(text: string, setText: (t: string) => void) {
  const supported = recognitionCtor() !== null;
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const latest = useRef(text);
  latest.current = text;

  const begin = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const base = latest.current;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onresult = (e) => setText(joinText(base, transcriptOf(e.results)));
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      wanted.current = false;
      setError(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "Chef can't use the microphone. Allow it in the browser's site settings, or use the mic on your keyboard."
          : "Listening stopped. Tap the mic to carry on.",
      );
    };
    r.onend = () => {
      if (wanted.current) begin();
      else {
        rec.current = null;
        setListening(false);
      }
    };
    rec.current = r;
    try {
      r.start();
    } catch {
      wanted.current = false;
      setListening(false);
    }
  }, [setText]);

  const start = useCallback(() => {
    setError(null);
    wanted.current = true;
    setListening(true);
    begin();
  }, [begin]);

  const stop = useCallback(() => {
    wanted.current = false;
    rec.current?.stop();
  }, []);

  useEffect(
    () => () => {
      wanted.current = false;
      rec.current?.abort();
    },
    [],
  );

  return { supported, listening, error, start, stop };
}
