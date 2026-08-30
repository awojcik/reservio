"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiError, type PropertyNotReady, type PropertyStatus } from "@rezervio/api-client";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";
import { PUBLISH_REQUIREMENT_LABELS, canArchive, canPublish, canUnpublish } from "@/lib/host";

type PropertyActionsProps = {
  propertyId: string;
  status: PropertyStatus;
  /** Small buttons on the list, regular ones in the editor. */
  size?: "sm" | "md";
  /**
   * Runs before the command. The editor passes its save here, because publish
   * validates what is in the database — acting on a stale row would reject
   * fields the Host can see filled in on screen.
   */
  onBeforeAction?: () => Promise<void>;
};

export function PropertyActions({
  propertyId,
  status,
  size = "sm",
  onBeforeAction,
}: PropertyActionsProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, setPending] = useState<string | null>(null);

  async function run(action: string, work: () => Promise<unknown>, success: string) {
    setPending(action);
    try {
      await onBeforeAction?.();
      await work();
      showToast(success);
      router.refresh();
    } catch (error) {
      showToast(describe(error));
    } finally {
      setPending(null);
    }
  }

  return (
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

      {canArchive(status) ? (
        <Button
          size={size}
          variant="ghost"
          disabled={pending !== null}
          onClick={() =>
            run(
              "archive",
              () => apiClient.archiveProperty(propertyId),
              "Obiekt został zarchiwizowany.",
            )
          }
        >
          {pending === "archive" ? "Archiwizuję…" : "Archiwizuj"}
        </Button>
      ) : null}
    </div>
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
