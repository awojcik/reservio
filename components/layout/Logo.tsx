import Link from "next/link";

import { cn } from "@/lib/cn";

type LogoProps = {
  /** Font size in px — the degree sign scales with it. */
  size?: number;
  className?: string;
  asLink?: boolean;
};

export function Logo({ size = 22, className, asLink = true }: LogoProps) {
  const wordmark = (
    <span
      className={cn("inline-flex items-baseline leading-none", className)}
      style={{ fontSize: size, fontWeight: 800, letterSpacing: "-0.035em" }}
    >
      <span className="text-brand">rezervio</span>
      <span className="text-accent" aria-hidden="true">
        °
      </span>
    </span>
  );

  if (!asLink) return wordmark;

  return (
    <Link href="/" aria-label="rezervio — strona główna" className="rounded-sm">
      {wordmark}
    </Link>
  );
}
