"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

/** Sent ahead of a guarded push; a mounted LeaveGuard cancels it to hold the push. */
const PUSH_EVENT = "leave-guard:push";

/** router.push for navigation that isn't a link, which a LeaveGuard can't otherwise see coming. */
export function useGuardedPush() {
  const router = useRouter();
  return (href: string) => {
    const event = new CustomEvent(PUSH_EVENT, { cancelable: true, detail: href });
    if (window.dispatchEvent(event)) router.push(href);
  };
}

/**
 * While `when` holds, leaving the page asks first: the browser's own prompt for a
 * reload, a closed tab or another site, and a dialog for links and guarded pushes
 * within the app. The browser's Back button gets neither — the App Router has no
 * way to hold it.
 */
export function LeaveGuard({ when }: { when: boolean }) {
  const router = useRouter();
  const [heldHref, setHeldHref] = useState<string | null>(null);

  useEffect(() => {
    if (!when) return;

    // Holds `url` if it's another page in the app. Another site unloads this one,
    // where the browser's prompt takes over, and this same page isn't being left.
    const hold = (url: URL) => {
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) {
        return false;
      }
      setHeldHref(url.pathname + url.search + url.hash);
      return true;
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    // Captured on window so the App Router's link handling never sees a held click.
    const onClick = (event: MouseEvent) => {
      // A modified click opens a new tab, leaving this one where it is.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        !hold(new URL(anchor.href))
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    const onPush = (event: Event) => {
      if (hold(new URL((event as CustomEvent<string>).detail, window.location.href))) {
        event.preventDefault();
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("click", onClick, true);
    window.addEventListener(PUSH_EVENT, onPush);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener(PUSH_EVENT, onPush);
    };
  }, [when]);

  const discard = () => {
    if (heldHref !== null) router.push(heldHref);
    setHeldHref(null);
  };

  return (
    <Dialog
      open={heldHref !== null}
      onOpenChange={(open) => {
        if (!open) setHeldHref(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard unsaved changes?</DialogTitle>
          <DialogDescription>Anything changed since the last save will be lost.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setHeldHref(null)}>
            Stay
          </Button>
          <Button variant="destructive" onClick={discard}>
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
