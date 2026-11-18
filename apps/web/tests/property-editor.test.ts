import { describe, expect, it, vi } from "vitest";

import {
  AFTER_ARCHIVE_HREF,
  archiveFlow,
  runLifecycle,
} from "@/lib/property-editor";

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
