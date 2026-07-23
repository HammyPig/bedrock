import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

/** Muted uppercase back link shown above page titles. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs font-medium tracking-wide uppercase transition-colors"
    >
      <ArrowLeftIcon className="size-3.5" />
      {children}
    </Link>
  );
}
