"use client";

import { useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { MAX_TEMPO, MIN_TEMPO, normalizeTempo } from "./tempo";

export { MAX_TEMPO, MIN_TEMPO, normalizeTempo } from "./tempo";

type TempoInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "max" | "step"> & {
  value: number | null;
  onCommit: (value: number | null) => void;
  allowEmpty?: boolean;
};

export default function TempoInput({ value, onCommit, allowEmpty = false, onBlur, onFocus, onKeyDown, ...props }: TempoInputProps) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value === null ? "" : String(value));
  }, [value]);

  const restore = () => setDraft(value === null ? "" : String(value));
  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      if (allowEmpty) onCommit(null);
      else restore();
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      restore();
      return;
    }
    const next = normalizeTempo(parsed);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  return <input
    {...props}
    type="number"
    inputMode="numeric"
    min={MIN_TEMPO}
    max={MAX_TEMPO}
    step="1"
    value={draft}
    onChange={event => setDraft(event.currentTarget.value)}
    onFocus={event => { focused.current = true; onFocus?.(event); }}
    onBlur={event => { focused.current = false; commit(); onBlur?.(event); }}
    onKeyDown={event => {
      if (event.key === "Enter") event.currentTarget.blur();
      onKeyDown?.(event);
    }}
  />;
}
