import { redirect } from "next/navigation";

import { auth, signOut } from "~/server/auth";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4">
      <p className="text-xl">Hello, {session.user.name ?? session.user.email}</p>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button type="submit" className="text-sm text-gray-500 underline">
          Sign out
        </button>
      </form>
    </main>
  );
}
