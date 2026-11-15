/**
 * The Property editor's save and lifecycle rules, as plain functions.
 *
 * Saving is manual: nothing is written until the Host presses "Zapisz
 * zmiany". These rules are what make that visible — the button is only live
 * when there is something to save, and the state next to it always says
 * which of the four situations the form is in. Kept out of the component so
 * they can be pinned down without a renderer.
 */

export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export type SaveState = {
  status: SaveStatus;
  /** The button's label. */
  label: string;
  disabled: boolean;
  /** The quiet line next to the button, or null when there is nothing to say. */
  message: string | null;
};

export function saveState({
  dirty,
  saving,
  failed,
  savedRecently,
}: {
  dirty: boolean;
  saving: boolean;
  /** The last save failed and nothing has been saved since. */
  failed: boolean;
  /** A save succeeded a moment ago — long enough to be noticed, not longer. */
  savedRecently: boolean;
}): SaveState {
  if (saving) {
    return { status: "saving", label: "Zapisywanie…", disabled: true, message: null };
  }
  if (failed && dirty) {
    return {
      status: "error",
      label: "Zapisz zmiany",
      disabled: false,
      message: "Nie udało się zapisać — zmiany są nadal w formularzu.",
    };
  }
  if (dirty) {
    return {
      status: "dirty",
      label: "Zapisz zmiany",
      disabled: false,
      message: "Niezapisane zmiany",
    };
  }
  if (savedRecently) {
    return { status: "saved", label: "Zapisz zmiany", disabled: true, message: "Zapisano" };
  }
  return { status: "idle", label: "Zapisz zmiany", disabled: true, message: null };
}

/**
 * Publish and unpublish act on what is in the database, so unsaved edits are
 * saved first — otherwise publishing would publish the previous version of
 * the Listing, or reject fields the Host can see filled in. A save that fails
 * stops the command: nothing is published on data that did not land.
 */
export async function runLifecycle({
  dirty,
  save,
  command,
}: {
  dirty: boolean;
  save: () => Promise<void>;
  command: () => Promise<unknown>;
}): Promise<void> {
  if (dirty) await save();
  await command();
}

/**
 * Archiving is final, so the UI confirms it first (a dialog), and it leaves
 * nothing to edit, so a successful archive moves on. It never saves the form:
 * an archived Listing has no use for the edit, and an invalid field must not
 * be able to block it. A failed archive moves nowhere — the error propagates
 * and the Host stays where they were.
 */
export async function archiveFlow({
  archive,
  onArchived,
}: {
  archive: () => Promise<unknown>;
  onArchived: () => void;
}): Promise<void> {
  await archive();
  onArchived();
}

/** Where a Host lands after archiving from the editor. */
export const AFTER_ARCHIVE_HREF = "/host/properties";
