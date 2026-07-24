import { BackLink } from "~/components/back-link";
import { api, HydrateClient } from "~/trpc/server";
import { SettingsNav, SettingsSidebar } from "./_components/settings-nav";

/**
 * Shared shell for the settings sub-pages: page chrome plus the section
 * switcher — a sidebar on wide screens, a horizontal nav row elsewhere.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  void api.settings.get.prefetch();
  void api.business.users.prefetch();

  return (
    <HydrateClient>
      <main className="bg-background flex min-h-screen justify-center">
        {/* Equal flex-1 gutters keep the content viewport-centred; the sidebar floats centred in the left one. */}
        <div className="hidden min-w-0 flex-1 justify-center xl:flex">
          <SettingsSidebar />
        </div>
        <div className="w-full max-w-3xl px-4 py-10">
          <div className="xl:hidden">
            <div className="mb-4">
              <BackLink href="/">Home</BackLink>
            </div>
            {/* -mx-3 offsets the links' own padding so their labels align with the title. */}
            <SettingsNav className="-mx-3 mb-4 flex overflow-x-auto" />
          </div>
          <h1 className="mb-6 text-2xl font-semibold tracking-tight">Settings</h1>
          {children}
        </div>
        <div className="hidden flex-1 xl:block" />
      </main>
    </HydrateClient>
  );
}
