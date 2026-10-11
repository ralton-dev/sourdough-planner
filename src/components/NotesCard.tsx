import { useEffect, useId, useLayoutEffect, useRef } from "react";
import type { Plan } from "../lib/types";

interface Props {
  plan: Plan;
  onChange: (next: Plan) => void;
}

/**
 * Grows the box to its text where the browser cannot (no `field-sizing: content`), so the whole
 * note shows on screen and in print rather than behind a scrollbar.
 */
function fitToText(el: HTMLTextAreaElement | null) {
  if (!el || CSS.supports?.("field-sizing", "content")) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}

/** This bake (decision 18): what was planned, changed or learned. Prints with the plan. */
export function NotesCard({ plan, onChange }: Props) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const notes = plan.notes ?? "";

  useLayoutEffect(() => fitToText(ref.current), [notes]);
  useEffect(() => {
    const refit = () => fitToText(ref.current);
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, []);

  // A plan without notes carries no `notes` key, as before notes existed.
  const set = (text: string) => {
    const next: Plan = { ...plan };
    if (text === "") delete next.notes;
    else next.notes = text;
    onChange(next);
  };

  return (
    <section className="card">
      <header>
        <h2 id={id}>Notes</h2>
      </header>
      <textarea
        ref={ref}
        value={notes}
        onChange={(e) => set(e.target.value)}
        aria-labelledby={id}
        rows={3}
        placeholder="What you planned, changed or learned this bake"
        style={{ fieldSizing: "content" }}
      />
    </section>
  );
}
