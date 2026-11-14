"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";

import type { ImageVariants } from "@rezervio/api-client";

import { cn } from "@/lib/cn";
import { variantLoader } from "@/lib/image-variants";

type ImageWithFallbackProps = Omit<ImageProps, "onError" | "loader"> & {
  /** Shown instead of the photo when the remote image fails. */
  fallbackLabel?: string;
  /**
   * Ready-made widths of this photo on the CDN. When present they are used
   * directly and the photo never passes through `/_next/image`; when absent —
   * not generated yet, or a photo Rezervio does not store — it is optimised
   * exactly as before.
   */
  variants?: ImageVariants | null;
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
  variants,
  ...props
}: ImageWithFallbackProps) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={cn(
          "flex size-full items-center justify-center bg-placeholder",
          className,
        )}
        style={{
          backgroundImage:
            "repeating-linear-gradient(135deg, rgba(16,24,20,0.05) 0 1px, transparent 1px 11px)",
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
      loader={variants ? variantLoader(variants) : undefined}
      {...props}
    />
  );
}
