import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { BackLink } from "~/components/back-link";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/**
 * Floating switcher shell for card-style editor pages: sticky beside the
 * content column, with a back link (and optional new link) where the page title sits.
 */
export function Sidebar({
  backHref,
  backLabel,
  newLink,
  children,
}: {
  backHref: string;
  backLabel: string;
  newLink?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <aside className="sticky top-10 mt-10 w-52 self-start">
      {/* h-8 + mb-6 mirror the page title's 2rem line and mb-6, so the card tops align. */}
      <div className="mb-6 flex h-8 items-center justify-between gap-2">
        <BackLink href={backHref}>{backLabel}</BackLink>
        {/* The row only fits "New"; the full label names what it creates for screen readers. */}
        {newLink && (
          <Button asChild variant="outline" size="sm">
            <Link href={newLink.href} aria-label={newLink.label}>
              <PlusIcon />
              New
            </Link>
          </Button>
        )}
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
