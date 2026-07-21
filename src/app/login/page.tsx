import { redirect } from "next/navigation";

import { auth, signIn } from "~/server/auth";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <h1 className="text-2xl font-semibold">Log in to Bedrock</h1>
      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}
      >
        <button
          type="submit"
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
