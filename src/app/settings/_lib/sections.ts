/**
 * The settings sections in display order. Lives outside the client nav
 * component so server code can read it: the first entry is the "default"
 * section that /settings redirects to and the home card links to.
 */
export const SETTINGS_SECTIONS = [
  { href: "/settings/business", label: "Business details" },
  { href: "/settings/appearance", label: "Invoice appearance" },
  { href: "/settings/email", label: "Invoice email" },
  { href: "/settings/users", label: "Users" },
  { href: "/settings/modules", label: "Modules" },
  { href: "/settings/data", label: "Import & export" },
] as const;

export const DEFAULT_SETTINGS_PAGE = SETTINGS_SECTIONS[0].href;
