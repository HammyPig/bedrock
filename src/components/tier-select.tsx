"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { api } from "~/trpc/react";

/** Radix Select items can't have an empty value, so "no tier" gets a sentinel. */
const NO_TIER = "__no_tier__";

/** Dropdown of the business's pricing tiers plus a "No tier" option. */
export function TierSelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string | null;
  onChange: (tierId: string | null) => void;
}) {
  const tiers = api.tier.list.useQuery();

  return (
    <Select
      value={value ?? NO_TIER}
      onValueChange={(next) => onChange(next === NO_TIER ? null : next)}
    >
      <SelectTrigger id={id} className="w-full" disabled={!tiers.data}>
        <SelectValue placeholder="Select tier" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_TIER}>No tier</SelectItem>
        {(tiers.data ?? []).map((tier) => (
          <SelectItem key={tier.id} value={tier.id}>
            {tier.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
