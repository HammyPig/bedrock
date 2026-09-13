import { useState } from "react";
import { type z } from "zod";

import { useFieldError } from "~/components/field-errors";
import { parseAmountInput, roundAmountInput } from "~/lib/amount-input";

interface AmountInputOptions {
  /** The committed value, as a count of the stored unit. */
  value: number;
  /** The text editing starts from; a zero starts blank instead. */
  editText: string;
  /** Stored units per typed unit: 100 cents to the dollar. */
  scale: number;
  /** The rule the stored value is held to — the same one the server validates with. */
  schema: z.ZodNumber;
  /** Names the field in the error its collector lists. */
  label?: string;
  onCommit: (value: number) => void;
}

/**
 * The editing session behind an amount input: raw text while it's typed,
 * committed on blur. Under a FieldErrors collector, text the schema refuses
 * stays in the field and is reported until it's fixed. With no collector to
 * show a refusal, it's rounded into range the forgiving way instead.
 */
export function useAmountInput({
  value,
  editText,
  scale,
  schema,
  label,
  onCommit,
}: AmountInputOptions) {
  const [text, setText] = useState<string | null>(null);
  // Set by a blur that refused the text; from then on the error follows each keystroke.
  const [refused, setRefused] = useState(false);

  const parsed = refused && text !== null ? parseAmountInput(text, scale, schema) : undefined;
  const refusal = parsed && "error" in parsed ? parsed.error : undefined;
  const collected = useFieldError(
    refusal !== undefined && label !== undefined ? `${label}: ${refusal}` : refusal,
  );

  return {
    text,
    setText,
    invalid: refusal !== undefined,
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      setText(text ?? (value === 0 ? "" : editText));
      e.currentTarget.select();
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setText(e.currentTarget.value),
    onBlur: () => {
      if (text === null) return;
      const result = parseAmountInput(text, scale, schema);
      if ("value" in result) {
        onCommit(result.value);
      } else if (collected) {
        setRefused(true);
        return;
      } else {
        const rounded = roundAmountInput(text, scale, schema);
        if (rounded !== null) onCommit(rounded);
      }
      setText(null);
      setRefused(false);
    },
  };
}
