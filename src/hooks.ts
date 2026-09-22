import { useEffect, useRef, useState } from "react";
import { save } from "./lib/storage";

/** Persist a piece of state to localStorage whenever it changes. */
export function usePersisted<T>(key: string, value: T): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    save(key, value);
  }, [key, value]);
}

/** Screen Wake Lock, re-acquired when the tab becomes visible again. */
export function useWakeLock(active: boolean): "on" | "off" | "unsupported" {
  const [state, setState] = useState<"on" | "off" | "unsupported">(() =>
    wakeLockApi() ? "off" : "unsupported",
  );
  useEffect(() => {
    const api = wakeLockApi();
    if (!active || !api) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        sentinel = await api.request("screen");
        if (cancelled) {
          await sentinel.release();
          return;
        }
        setState("on");
        sentinel.addEventListener("release", () => setState("off"));
      } catch {
        setState("off");
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release();
    };
  }, [active]);
  return active ? state : "off";
}

function wakeLockApi(): { request(type: "screen"): Promise<WakeLockSentinel> } | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (
    navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinel> } }
  ).wakeLock;
}
