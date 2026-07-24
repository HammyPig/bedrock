"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Sidebar, sidebarItemClass } from "~/components/sidebar";

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
            className={sidebarItemClass(active)}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Floating section switcher beside the settings pages. */
export function SettingsSidebar() {
  return (
    <Sidebar backHref="/" backLabel="Home">
      <SettingsNav className="bg-card flex flex-col gap-1 rounded-xl border p-2 shadow-sm" />
    </Sidebar>
  );
}
