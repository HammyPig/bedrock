import { BackLink } from "~/components/back-link";
import { cn } from "~/lib/utils";

/**
 * Floating switcher shell for card-style editor pages: sticky beside the
 * content column, with a back link where the page title sits.
 */
export function Sidebar({
  backHref,
  backLabel,
  children,
}: {
  backHref: string;
  backLabel: string;
  children: React.ReactNode;
}) {
  return (
    <aside className="sticky top-10 mt-10 w-52 self-start">
      {/* h-8 + mb-6 mirror the page title's 2rem line and mb-6, so the card tops align. */}
      <div className="mb-6 flex h-8 items-center">
        <BackLink href={backHref}>{backLabel}</BackLink>
      </div>
      {children}
    </aside>
  );
}

/** Shared sidebar row look: quiet text that brightens on hover, filled and bold when current. */
export function sidebarItemClass(active: boolean) {
  return cn(
    "rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors",
    active ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground",
  );
}
