"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, type PropertyNotReady, type PropertyStatus } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";
import { PUBLISH_REQUIREMENT_LABELS, canArchive, canPublish, canUnpublish } from "@/lib/host";
import { archiveFlow, runLifecycle } from "@/lib/property-editor";

type PropertyActionsProps = {
  propertyId: string;
  status: PropertyStatus;
  /** Small buttons on the list, regular ones in the editor. */
  size?: "sm" | "md";
  /**
   * The editor's save. Run before publish and unpublish when there are
   * unsaved changes, because both commands act on the database row —
   * publishing a stale row would publish the previous version of the
   * Listing (`runLifecycle`). Archive never runs it: see `archiveFlow`.
   */
  save?: () => Promise<void>;
  /** The editor has edits not yet saved: publish saves them, archive warns. */
  unsavedChanges?: boolean;
  /**
   * Where to go once archived. The editor leaves, since an archived Listing
   * has nothing left to edit; the list stays and refreshes.
   */
  afterArchiveHref?: string;
  /**
   * `inline` puts archive in the same row (the list); `separate` puts it
   * below a rule, as a secondary action away from save and publish (the
   * editor).
   */
  archivePlacement?: "inline" | "separate";
};

export function PropertyActions({
  propertyId,
  status,
  size = "sm",
  save,
  unsavedChanges = false,
  afterArchiveHref,
  archivePlacement = "inline",
}: PropertyActionsProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function run(action: string, work: () => Promise<unknown>, success: string) {
    setPending(action);
    try {
      await runLifecycle({
        dirty: unsavedChanges && save !== undefined,
        save: save ?? (async () => undefined),
        command: work,
      });
      showToast(success);
      router.refresh();
    } catch (error) {
      showToast(describe(error));
    } finally {
      setPending(null);
    }
  }

  async function archive() {
    setPending("archive");
    try {
      await archiveFlow({
        archive: () => apiClient.archiveProperty(propertyId),
        onArchived: () => {
          setConfirming(false);
          showToast("Oferta została zarchiwizowana.");
          if (afterArchiveHref) router.push(afterArchiveHref);
          else router.refresh();
        },
      });
    } catch (error) {
      showToast(describe(error));
    } finally {
      setPending(null);
    }
  }

  const archiveButton = canArchive(status) ? (
    <Button
      size={size}
      variant="ghost"
      disabled={pending !== null}
      onClick={() => setConfirming(true)}
    >
      {archivePlacement === "separate" ? "Archiwizuj ofertę" : "Archiwizuj"}
    </Button>
  ) : null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canPublish(status) ? (
          <Button
            size={size}
            variant="accent"
            disabled={pending !== null}
            onClick={() =>
              run(
                "publish",
                () => apiClient.publishProperty(propertyId),
                "Obiekt jest opublikowany i widoczny w wyszukiwarce.",
              )
            }
          >
            {pending === "publish" ? "Publikuję…" : "Opublikuj"}
          </Button>
        ) : null}

        {canUnpublish(status) ? (
          <Button
            size={size}
            variant="outline"
            disabled={pending !== null}
            onClick={() =>
              run(
                "unpublish",
                () => apiClient.unpublishProperty(propertyId),
                "Obiekt został wycofany z wyszukiwarki.",
              )
            }
          >
            {pending === "unpublish" ? "Wycofuję…" : "Wycofaj"}
          </Button>
        ) : null}

        {archivePlacement === "inline" ? archiveButton : null}
      </div>

      {archivePlacement === "separate" && archiveButton ? (
        <div className="mt-4 border-t border-line pt-3">{archiveButton}</div>
      ) : null}

      <Dialog open={confirming} onOpenChange={(open) => pending === null && setConfirming(open)}>
        <DialogContent title="Zarchiwizować ofertę?" aria-describedby={undefined}>
          <div className="space-y-3 px-5 py-4 text-[15px] leading-relaxed">
            <p>Oferta zniknie z wyszukiwarki i nie będzie można jej przywrócić.</p>
            <p>
              Zdjęcia oferty zostaną usunięte. Zdjęcie, które goście widzą w historii swoich
              rezerwacji, zostanie zachowane.
            </p>
            {unsavedChanges ? (
              <p className="font-semibold">Niezapisane zmiany w formularzu przepadną.</p>
            ) : null}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
            <DialogClose asChild>
              <Button size="md" variant="outline" disabled={pending !== null}>
                Anuluj
              </Button>
            </DialogClose>
            <Button size="md" disabled={pending !== null} onClick={archive}>
              {pending === "archive" ? "Archiwizuję…" : "Archiwizuj ofertę"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * A 422 from publish carries exactly what is missing, so the Host reads the
 * real reason instead of a generic failure.
 */
function describe(error: unknown): string {
  if (!(error instanceof ApiError)) return "Coś poszło nie tak. Spróbuj ponownie.";

  const body = error.body as PropertyNotReady | undefined;
  if (error.status === 422 && body?.errors?.length) {
    const missing = body.errors
      .map((entry) => PUBLISH_REQUIREMENT_LABELS[toRequirement(entry.code)] ?? entry.field)
      .join(", ");
    return `Nie można opublikować — brakuje: ${missing}.`;
  }

  if (error.status === 409) return "Ta operacja nie jest możliwa w obecnym stanie obiektu.";
  if (error.status === 401 || error.status === 403) return "Zaloguj się ponownie.";
  return "Coś poszło nie tak. Spróbuj ponownie.";
}

/** `MINIMUM_IMAGES_REQUIRED` → `MINIMUM_IMAGES` */
function toRequirement(code: string): string {
  return code.replace(/_REQUIRED$/, "");
}
