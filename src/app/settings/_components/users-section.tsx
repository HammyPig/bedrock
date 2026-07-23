"use client";

import { useState } from "react";
import { XIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { api } from "~/trpc/react";

/** Who has access to the business: current users, pending invites, invite form. */
export function UsersSection() {
  const [{ users, invites }] = api.business.users.useSuspenseQuery();
  const [email, setEmail] = useState("");

  const utils = api.useUtils();
  const invite = api.business.invite.useMutation({
    onSuccess: async () => {
      setEmail("");
      await utils.business.users.invalidate();
    },
  });
  const uninvite = api.business.uninvite.useMutation({
    onSuccess: () => utils.business.users.invalidate(),
  });

  const handleInvite = () => {
    if (!email.trim()) return;
    invite.mutate({ email });
  };

  return (
    <div className="bg-card mt-6 rounded-xl border p-8 shadow-sm sm:p-10">
      <h2 className="mb-1 font-medium">Users</h2>
      <p className="text-muted-foreground mb-4 text-sm">
        People with access to this business. Invited people join automatically the first time they
        sign in with that email.
      </p>
      <ul className="divide-y">
        {users.map((user) => (
          <li key={user.id} className="flex items-center justify-between gap-4 py-3">
            <div>
              <p className="text-sm font-medium">{user.name ?? user.email}</p>
              <p className="text-muted-foreground text-sm">{user.email}</p>
            </div>
            {user.isOwner && (
              <span className="bg-muted text-muted-foreground rounded-full px-2.5 py-0.5 text-xs font-medium">
                Owner
              </span>
            )}
          </li>
        ))}
        {invites.map((pending) => (
          <li key={pending.id} className="flex items-center justify-between gap-4 py-3">
            <div>
              <p className="text-sm font-medium">{pending.email}</p>
              <p className="text-muted-foreground text-sm">Invited — hasn&apos;t joined yet</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove invite for ${pending.email}`}
              disabled={uninvite.isPending}
              onClick={() => uninvite.mutate({ id: pending.id })}
            >
              <XIcon />
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-end gap-2">
        <div className="flex-1 space-y-2">
          <Label htmlFor="invite-email">Invite by email</Label>
          <Input
            id="invite-email"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleInvite();
            }}
          />
        </div>
        <Button disabled={!email.trim() || invite.isPending} onClick={handleInvite}>
          Invite
        </Button>
      </div>
      {invite.error && <p className="text-destructive mt-2 text-sm">{invite.error.message}</p>}
    </div>
  );
}
