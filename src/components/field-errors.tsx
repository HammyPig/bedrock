"use client";

import { createContext, useCallback, useContext, useEffect, useId, useState } from "react";

type ReportFieldError = (id: string, error: string | null) => void;

/**
 * Where an input reports text it refused to commit. Null outside any
 * collector, where an input has nowhere to show a refusal.
 */
export const FieldErrorsContext = createContext<ReportFieldError | null>(null);

/**
 * Collects the errors reported through the context it's provided to, passing
 * each on to any collector further out — so a section can list its own errors
 * while the form counts them all.
 */
export function useFieldErrors() {
  const parent = useContext(FieldErrorsContext);
  const [errors, setErrors] = useState(() => new Map<string, string>());
  const report = useCallback<ReportFieldError>(
    (id, error) => {
      setErrors((prev) => {
        const next = new Map(prev);
        if (error === null) next.delete(id);
        else next.set(id, error);
        return next;
      });
      parent?.(id, error);
    },
    [parent],
  );
  return [errors, report] as const;
}

/** Lists the errors of the inputs inside it, after them. */
export function FieldErrors({ children }: { children: React.ReactNode }) {
  const [errors, report] = useFieldErrors();
  return (
    <FieldErrorsContext value={report}>
      {children}
      {[...errors].map(([id, error]) => (
        <p key={id} className="text-destructive text-sm">
          {error}
        </p>
      ))}
    </FieldErrorsContext>
  );
}

/**
 * Registers an input's error with the nearest collector for as long as the
 * input holds it. Returns whether there is a collector to register with.
 */
export function useFieldError(error: string | undefined): boolean {
  const report = useContext(FieldErrorsContext);
  const id = useId();
  useEffect(() => {
    if (report === null || error === undefined) return;
    report(id, error);
    return () => report(id, null);
  }, [report, id, error]);
  return report !== null;
}
