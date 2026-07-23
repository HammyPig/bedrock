import Link from "next/link";
import { redirect } from "next/navigation";
import { FileTextIcon, PackageIcon, PlusIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { auth, signOut } from "~/server/auth";

const sections = [
  {
    href: "/invoices",
    title: "Invoices",
    description: "Everything you've billed, and what's still owing.",
    icon: FileTextIcon,
  },
  {
    href: "/items",
    title: "Items",
    description: "The products and services you add to invoices.",
    icon: PackageIcon,
  },
];

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main className="bg-background min-h-screen">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="mb-1 text-2xl font-semibold tracking-tight">Bedrock</h1>
            <p className="text-muted-foreground text-sm">
              Welcome back, {session.user.name ?? session.user.email}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <Button type="submit" variant="ghost">
                Sign out
              </Button>
            </form>
            <Button asChild>
              <Link href="/invoices/new">
                <PlusIcon />
                New invoice
              </Link>
            </Button>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {sections.map(({ href, title, description, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="bg-card hover:bg-muted/50 rounded-xl border p-6 shadow-sm transition-colors"
            >
              <Icon className="text-muted-foreground mb-3 size-5" />
              <h2 className="font-medium">{title}</h2>
              <p className="text-muted-foreground mt-1 text-sm">{description}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
