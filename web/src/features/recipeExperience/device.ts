import { useEffect, useState } from "react";

// Browser features cooking mode leans on. Each one is a quiet no-op where
// the browser doesn't support it.

// ---------------------------------------------------------------------------
// Screen Wake Lock: keep the screen on while cooking mode is open. The lock is
// dropped whenever the page is hidden, so it is taken again on return.

export function useWakeLock(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    const acquire = async () => {
      if (document.visibilityState !== "visible" || (lock && !lock.released)) return;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (!alive) {
          void next.release();
          return;
        }
        lock = next;
        setOn(true);
        next.addEventListener("release", () => setOn(false));
      } catch {
        // Battery saver or a denied permission: the screen may dim.
        setOn(false);
      }
    };
    const onVisible = () => void acquire();
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);
  return on;
}

// ---------------------------------------------------------------------------
// Timer alerts: a vibration, a beep and, when allowed, a notification.

let audio: AudioContext | null = null;

// Call from a tap (starting a timer): browsers only let audio start after a
// user gesture, so the context is created then and reused when a timer ends.
export function primeAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null;
  }
}

function beep() {
  if (!audio) return;
  const t0 = audio.currentTime;
  for (let i = 0; i < 3; i++) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    const t = t0 + i * 0.45;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(gain).connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.32);
  }
}

async function notify(title: string, body: string, tag: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    // Android Chrome only shows notifications through the service worker.
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, tag, icon: "/icons/icon-192.png" });
    else new Notification(title, { body, tag });
  } catch {
    // Not allowed here; the beep and vibration still happened.
  }
}

export function ringTimer(title: string, body: string, tag: string) {
  try {
    navigator.vibrate?.([400, 200, 400, 200, 800]);
  } catch {
    // Some browsers throw without a recent user gesture.
  }
  try {
    beep();
  } catch {
    // Audio unavailable.
  }
  void notify(title, body, tag);
}

export const prefersReducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
