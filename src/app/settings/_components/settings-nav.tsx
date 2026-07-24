"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Sidebar, sidebarItemClass } from "~/components/sidebar";
import { SETTINGS_SECTIONS } from "../_lib/sections";

/** The settings section links, current one highlighted; layout comes from className. */
export function SettingsNav({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav className={className}>
      {SETTINGS_SECTIONS.map(({ href, label }) => {
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
