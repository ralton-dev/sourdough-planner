import { useId, useState } from "react";

interface Props {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  /** Displayed value = stored value × scale (100 for percentages). */
  scale?: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  integer?: boolean;
}

/** Numeric input that opens the decimal keypad and tolerates half-typed values. */
export function NumberField({
  label,
  value,
  onChange,
  scale = 1,
  unit,
  min,
  max,
  step,
  hint,
  placeholder,
  allowEmpty,
  integer,
}: Props) {
  const id = useId();
  const toText = (v: number | undefined) =>
    v === undefined || Number.isNaN(v) ? "" : String(round(v * scale));
  const [text, setText] = useState(toText(value));
  const [seen, setSeen] = useState(value);

  // Re-sync the text when the prop changes from outside (a preset load, a
  // reset) but leave a half-typed value alone when it already parses to it.
  if (value !== seen) {
    setSeen(value);
    const parsed = Number.parseFloat(text);
    const current = value === undefined ? undefined : round(value * scale);
    const same =
      (text === "" && value === undefined) ||
      (!Number.isNaN(parsed) && current !== undefined && Math.abs(parsed - current) < 1e-9);
    if (!same) setText(toText(value));
  }

  const commit = (t: string) => {
    setText(t);
    if (t.trim() === "") {
      if (allowEmpty) onChange(undefined);
      return;
    }
    let n = Number.parseFloat(t.replace(",", "."));
    if (Number.isNaN(n)) return;
    if (integer) n = Math.round(n);
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    onChange(n / scale);
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="unitwrap">
        <input
          id={id}
          type="text"
          inputMode={integer ? "numeric" : "decimal"}
          value={text}
          placeholder={placeholder}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => setText(toText(value))}
          aria-describedby={hint ? `${id}-hint` : undefined}
          data-min={min}
          data-max={max}
          data-step={step}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
      {hint && (
        <div className="hint" id={`${id}-hint`}>
          {hint}
        </div>
      )}
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
