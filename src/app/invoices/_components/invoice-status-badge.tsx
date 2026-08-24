import { cn } from "~/lib/utils";
import { STATUS_LABELS, type ListStatus } from "../_lib/invoices";

const STATUS_BADGE: Record<ListStatus, string> = {
  unpaid: "bg-muted text-muted-foreground",
  overdue: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
  paid: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
  quote: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400",
};

/** The pill shown in the status column of invoice tables. */
export function InvoiceStatusBadge({ status }: { status: ListStatus }) {
  return (
    <span
      className={cn(
        "inline-block rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_BADGE[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
