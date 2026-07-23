export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayIsoDate(): string {
  return toIsoDate(new Date());
}

/** Parsed as local time — a bare new Date("YYYY-MM-DD") would be UTC, off by one near midnight. */
export function parseIsoDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`);
}

export function addDaysIso(isoDate: string, days: number): string {
  const date = parseIsoDate(isoDate);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

const dateFormatter = new Intl.DateTimeFormat("en-AU", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatIsoDate(isoDate: string): string {
  return dateFormatter.format(parseIsoDate(isoDate));
}
