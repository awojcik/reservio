/**
 * Which photo the gallery is showing, as plain data.
 *
 * The rules live here rather than inside the component because they are the
 * part worth pinning down: which frame opens, what a click selects, which
 * thumbnail reads as current. A component can be re-styled freely as long as
 * these hold, and they can be tested without a renderer.
 */

/** The cover is the frame the page opens on — never a random or last one. */
export const INITIAL_FRAME = 0;

/**
 * The photos the gallery will show, in the order the Host arranged them.
 *
 * Blanks and repeats are dropped: a duplicated URL would produce two
 * thumbnails that look identical and fight over the active state, and an empty
 * src renders as a broken frame.
 */
export function galleryFrames(images: readonly string[]): string[] {
  const seen = new Set<string>();

  return images.filter((image) => {
    const url = image?.trim();
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

/**
 * Keeps a selection inside the gallery.
 *
 * The photo set can change under an open page — a Host adds or removes one —
 * and a selection left pointing past the end would blank the main frame.
 */
export function clampFrame(index: number, total: number): number {
  if (total <= 0) return INITIAL_FRAME;
  if (!Number.isFinite(index)) return INITIAL_FRAME;

  return Math.min(Math.max(Math.trunc(index), 0), total - 1);
}

/**
 * Moves the selection by `delta`, wrapping at both ends.
 *
 * This is what any next/previous control uses, so stepping and clicking a
 * thumbnail are the same act on the same state — they cannot disagree about
 * which photo is current.
 */
export function stepFrame(current: number, delta: number, total: number): number {
  if (total <= 0) return INITIAL_FRAME;

  const from = clampFrame(current, total);
  return (((from + delta) % total) + total) % total;
}

/** The photo the large frame shows for a given selection. */
export function activeImage(
  frames: readonly string[],
  selected: number,
): string | undefined {
  return frames[clampFrame(selected, frames.length)];
}

/**
 * The state a thumbnail renders in. Exactly one is ever `"active"`, which is
 * what makes "you are looking at this one" readable at a glance.
 */
export function thumbnailState(index: number, selected: number): "active" | "default" {
  return index === selected ? "active" : "default";
}
