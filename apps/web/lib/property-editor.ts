/**
 * The Property editor's lifecycle rules, as plain functions — kept out of the
 * component so they can be pinned down without a renderer.
 */

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
