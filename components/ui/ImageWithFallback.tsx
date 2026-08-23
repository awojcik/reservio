"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

import { cn } from "@/lib/cn";

type ImageWithFallbackProps = Omit<ImageProps, "onError"> & {
  /** Shown instead of the photo when the remote image fails. */
  fallbackLabel?: string;
};

/**
 * Photos come from a remote CDN in the demo, so every image needs a graceful
 * failure: the layout is reserved by the aspect-ratio wrapper, and the
 * fallback keeps the card looking intentional rather than broken.
 */
export function ImageWithFallback({
  fallbackLabel = "rezervio",
  className,
  alt,
  ...props
}: ImageWithFallbackProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={cn(
          "flex size-full items-center justify-center bg-[#EDE7DA]",
          className,
        )}
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, rgba(24,34,29,0.045) 0 1px, transparent 1px 11px)",
        }}
      >
        <span className="text-[13px] font-extrabold tracking-tight text-ink/45">
          {fallbackLabel}
          <span className="text-accent/70">°</span>
        </span>
      </div>
    );
  }

  return (
    <Image
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
      {...props}
    />
  );
}
