import { redirect } from "next/navigation";

/** The settings sections live on their own sub-pages; business details is the first. */
export default function SettingsPage() {
  redirect("/settings/business");
}
