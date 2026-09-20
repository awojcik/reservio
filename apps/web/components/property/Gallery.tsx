"use client";

import { useState } from "react";

import { ImageWithFallback } from "@/components/ui/ImageWithFallback";
import { cn } from "@/lib/cn";
import {
  INITIAL_FRAME,
  clampFrame,
  galleryFrames,
  stepFrame,
  thumbnailState,
} from "@/lib/gallery";

type GalleryProps = {
  images: string[];
  title: string;
};

/**
 * One large frame plus a thumbnail rail, all reserved at 4:3.
 *
 * Interactive rather than static: picking a thumbnail swaps the large frame in
 * place. That is state, so this is a Client Component — but only this one. The
 * property page around it stays on the server and hands the photo URLs down as
 * props.
 *
 * A frame is mounted the first time it is chosen and then kept mounted. The
 * page therefore still loads exactly one large photo, and going back to one
 * already seen is instant instead of a second download — which a single
 * element with a swapped `src` could not manage, because the large and
 * thumbnail sizes are different URLs.
 */
export function Gallery({ images, title }: GalleryProps) {
  const frames = galleryFrames(images);

  const [selected, setSelected] = useState(INITIAL_FRAME);
  const [mounted, setMounted] = useState<number[]>([INITIAL_FRAME]);

  /*
   * Clamped on the way out rather than stored clamped: a Host removing a photo
   * while the page is open would otherwise leave the selection pointing past
   * the end and blank the large frame. Deriving it here means there is no
   * second copy of the truth to keep in step.
   */
  const active = clampFrame(selected, frames.length);

  function show(index: number) {
    setSelected(index);
    setMounted((current) =>
      current.includes(index) ? current : [...current, index],
    );
  }

  if (!frames.length) return null;

  return (
    <div className="grid gap-2 sm:grid-cols-[1.6fr_1fr]">
      <div className="relative aspect-[4/3] overflow-hidden rounded-[14px] bg-placeholder">
        {frames.map((image, index) =>
          mounted.includes(index) ? (
            <ImageWithFallback
              key={image}
              src={image}
              alt={index === active ? `${title} — zdjęcie ${index + 1}` : ""}
              fill
              // The cover is this page's largest contentful paint.
              preload={index === INITIAL_FRAME}
              sizes="(max-width: 640px) 100vw, 60vw"
              className={cn(
                "object-cover transition-opacity duration-200",
                index === active ? "opacity-100" : "opacity-0",
              )}
              // A frame nobody is looking at is decoration, not content.
              aria-hidden={index === active ? undefined : true}
            />
          ) : null,
        )}
      </div>

      {frames.length > 1 ? (
        <div
          role="group"
          aria-label={`Zdjęcia — ${title}`}
          onKeyDown={(event) => {
            const delta =
              event.key === "ArrowRight" || event.key === "ArrowDown"
                ? 1
                : event.key === "ArrowLeft" || event.key === "ArrowUp"
                  ? -1
                  : 0;
            if (delta === 0) return;

            // Stepping and clicking move the same state, so a next/previous
            // control and the rail can never disagree about what is current.
            event.preventDefault();
            show(stepFrame(active, delta, frames.length));
          }}
          /*
           * Two columns, as before. Past four photos the rail scrolls rather
           * than stretching the row, so the large frame keeps the proportions
           * the page was designed around.
           */
          className="scroll-quiet grid auto-rows-[1fr] grid-cols-2 gap-2 sm:max-h-full sm:overflow-y-auto"
        >
          {frames.map((image, index) => (
            <button
              key={image}
              type="button"
              data-state={thumbnailState(index, active)}
              aria-pressed={index === active}
              aria-label={`Pokaż zdjęcie ${index + 1} z ${frames.length}`}
              onClick={() => show(index)}
              className={cn(
                "relative aspect-[4/3] cursor-pointer overflow-hidden rounded-[10px] bg-placeholder",
                "transition-[box-shadow,opacity] duration-150",
                index === active
                  ? "opacity-100 shadow-[0_0_0_3px_var(--brand)]"
                  : "opacity-70 hover:opacity-100",
              )}
            >
              <ImageWithFallback
                src={image}
                alt=""
                fill
                loading="lazy"
                sizes="(max-width: 640px) 50vw, 20vw"
                className="object-cover"
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
