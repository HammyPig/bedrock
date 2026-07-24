"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BackLink } from "~/components/back-link";
import { cn } from "~/lib/utils";

const SECTIONS = [
  { href: "/settings/business", label: "Business details" },
  { href: "/settings/appearance", label: "Invoice appearance" },
  { href: "/settings/email", label: "Invoice email" },
  { href: "/settings/users", label: "Users" },
];

/** The settings section links, current one highlighted; layout comes from className. */
export function SettingsNav({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav className={className}>
      {SECTIONS.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors",
              active
                ? "bg-muted text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Floating section switcher beside the settings pages, like the invoice sidebar. */
export function SettingsSidebar() {
  return (
    <aside className="sticky top-10 mt-10 w-52 self-start">
      {/* h-8 + mb-6 mirror the page title's 2rem line and mb-6, so the card tops align. */}
      <div className="mb-6 flex h-8 items-center">
        <BackLink href="/">Home</BackLink>
      </div>
      <SettingsNav className="bg-card flex flex-col gap-1 rounded-xl border p-2 shadow-sm" />
    </aside>
  );
}
