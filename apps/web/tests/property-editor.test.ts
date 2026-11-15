import { describe, expect, it, vi } from "vitest";

import {
  AFTER_ARCHIVE_HREF,
  archiveFlow,
  runLifecycle,
  saveState,
} from "@/lib/property-editor";

const base = { dirty: false, saving: false, failed: false, savedRecently: false };

describe("the save button", () => {
  it("is disabled when nothing has changed", () => {
    expect(saveState(base)).toMatchObject({
      status: "idle",
      label: "Zapisz zmiany",
      disabled: true,
      message: null,
    });
  });

  it("comes alive with the first edit, and says so", () => {
    expect(saveState({ ...base, dirty: true })).toMatchObject({
      status: "dirty",
      disabled: false,
      message: "Niezapisane zmiany",
    });
  });

  it("shows that it is saving, and cannot be pressed twice", () => {
    expect(saveState({ ...base, dirty: true, saving: true })).toMatchObject({
      status: "saving",
      label: "Zapisywanie…",
      disabled: true,
    });
  });

  it("confirms a save quietly, then goes back to idle", () => {
    expect(saveState({ ...base, savedRecently: true })).toMatchObject({
      status: "saved",
      disabled: true,
      message: "Zapisano",
    });
  });

  it("says a save failed, and keeps the edits savable", () => {
    expect(saveState({ ...base, dirty: true, failed: true })).toMatchObject({
      status: "error",
      disabled: false,
      message: "Nie udało się zapisać — zmiany są nadal w formularzu.",
    });
  });

  it("lets a new edit replace the confirmation at once", () => {
    expect(saveState({ ...base, dirty: true, savedRecently: true }).status).toBe("dirty");
  });
});

describe("publishing from the editor", () => {
  it("saves unsaved edits first, so the current form is what gets published", async () => {
    const calls: string[] = [];

    await runLifecycle({
      dirty: true,
      save: async () => {
        calls.push("save");
      },
      command: async () => {
        calls.push("publish");
      },
    });

    expect(calls).toEqual(["save", "publish"]);
  });

  it("does not publish when the save fails", async () => {
    const publish = vi.fn();

    await expect(
      runLifecycle({
        dirty: true,
        save: async () => {
          throw new Error("400");
        },
        command: publish,
      }),
    ).rejects.toThrow("400");
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes straight away when there is nothing to save", async () => {
    const save = vi.fn();
    const publish = vi.fn();

    await runLifecycle({ dirty: false, save, command: publish });

    expect(save).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledOnce();
  });
});

describe("archiving from the editor", () => {
  it("leaves the editor for the list once archived", async () => {
    const navigate = vi.fn();

    await archiveFlow({ archive: async () => undefined, onArchived: navigate });

    expect(navigate).toHaveBeenCalledOnce();
    expect(AFTER_ARCHIVE_HREF).toBe("/host/properties");
  });

  it("stays put when the archive fails", async () => {
    const navigate = vi.fn();

    await expect(
      archiveFlow({
        archive: async () => {
          throw new Error("409");
        },
        onArchived: navigate,
      }),
    ).rejects.toThrow("409");
    expect(navigate).not.toHaveBeenCalled();
  });
});
