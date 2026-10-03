"use client";

import { GripVertical, Star, Trash2, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { ApiError, type HostPropertyImage } from "@rezervio/api-client";

import { ImageWithFallback } from "@/components/ui/ImageWithFallback";
import { useToast } from "@/components/ui/Toast";
import { apiClient } from "@/lib/api";

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES = 30;

type Upload = { id: string; name: string; progress: number };

/**
 * Photos never pass through the API: it mints a presigned URL, the browser PUTs
 * straight to object storage, then the API records the PropertyImage. Progress
 * needs XMLHttpRequest — fetch cannot report upload progress.
 */
export function ImageManager({
  propertyId,
  images,
  onChange,
}: {
  propertyId: string;
  images: HostPropertyImage[];
  onChange: (images: HostPropertyImage[]) => void;
}) {
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);

  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const upload = useCallback(
    async (files: File[]) => {
      const room = MAX_IMAGES - images.length - uploads.length;
      if (room <= 0) {
        showToast(`Obiekt może mieć maksymalnie ${MAX_IMAGES} zdjęć.`);
        return;
      }

      for (const file of files.slice(0, room)) {
        if (!ACCEPTED.includes(file.type)) {
          showToast(`${file.name}: dozwolone są JPEG, PNG i WebP.`);
          continue;
        }
        if (file.size > MAX_BYTES) {
          showToast(`${file.name}: maksymalny rozmiar to 10 MB.`);
          continue;
        }

        const uploadId = `${file.name}-${Date.now()}-${Math.random()}`;
        setUploads((current) => [...current, { id: uploadId, name: file.name, progress: 0 }]);

        try {
          const ticket = await apiClient.createImageUploadUrl(propertyId, {
            fileName: file.name,
            contentType: file.type as "image/jpeg",
            sizeBytes: file.size,
          });

          await putWithProgress(ticket.uploadUrl, file, (progress) => {
            setUploads((current) =>
              current.map((item) => (item.id === uploadId ? { ...item, progress } : item)),
            );
          });

          const next = await apiClient.confirmImage(propertyId, {
            objectKey: ticket.objectKey,
            altText: file.name.replace(/\.[^.]+$/, ""),
          });
          onChange(next);
        } catch (error) {
          showToast(
            error instanceof ApiError && error.status === 409
              ? `Obiekt może mieć maksymalnie ${MAX_IMAGES} zdjęć.`
              : `Nie udało się wgrać ${file.name}.`,
          );
        } finally {
          setUploads((current) => current.filter((item) => item.id !== uploadId));
        }
      }
    },
    [images.length, uploads.length, onChange, propertyId, showToast],
  );

  async function remove(imageId: string) {
    try {
      onChange(await apiClient.deleteImage(propertyId, imageId));
    } catch {
      showToast("Nie udało się usunąć zdjęcia.");
    }
  }

  async function commitOrder(orderedIds: string[]) {
    try {
      onChange(await apiClient.reorderImages(propertyId, orderedIds));
    } catch {
      showToast("Nie udało się zmienić kolejności.");
    }
  }

  function handleDrop(targetId: string) {
    if (!draggedId || draggedId === targetId) return;

    const ids = images.map((image) => image.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;

    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setDraggedId(null);
    void commitOrder(ids);
  }

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          void upload([...event.dataTransfer.files]);
        }}
        className={`flex flex-col items-center justify-center rounded-[14px] border-2 border-dashed px-4 py-8 text-center transition-colors ${
          dragOver ? "border-accent bg-accent/8" : "border-line bg-surface/60"
        }`}
      >
        <Upload size={22} strokeWidth={2.2} className="text-muted" />
        <p className="mt-2 text-[15px] font-bold">Przeciągnij zdjęcia tutaj</p>
        <p className="mt-1 text-[13px] text-muted">
          JPEG, PNG lub WebP · do 10 MB · maksymalnie {MAX_IMAGES} zdjęć
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-3 text-[14px] font-bold text-brand underline underline-offset-2"
        >
          albo wybierz z dysku
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED.join(",")}
          multiple
          className="sr-only"
          onChange={(event) => {
            void upload([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
      </div>

      {uploads.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {uploads.map((item) => (
            <li key={item.id} className="rounded-[10px] border border-line bg-surface px-3 py-2">
              <div className="flex items-center justify-between gap-3 text-[13px] font-semibold">
                <span className="truncate">{item.name}</span>
                <span className="tabular-nums text-muted">{item.progress}%</span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={item.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Postęp wysyłania ${item.name}`}
                className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-placeholder"
              >
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-150"
                  style={{ width: `${item.progress}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {images.length > 0 ? (
        <>
          <p className="mt-5 text-[13px] text-muted">
            Przeciągnij, aby zmienić kolejność. Pierwsze zdjęcie jest zdjęciem głównym.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {images.map((image) => (
              <li
                key={image.id}
                draggable
                onDragStart={() => setDraggedId(image.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => handleDrop(image.id)}
                onDragEnd={() => setDraggedId(null)}
                className={`group relative aspect-[4/3] overflow-hidden rounded-[10px] border bg-placeholder ${
                  draggedId === image.id ? "border-accent opacity-60" : "border-line"
                }`}
              >
                <ImageWithFallback
                  src={image.url}
                  alt={image.altText ?? "Zdjęcie obiektu"}
                  fill
                  sizes="(max-width: 640px) 50vw, 240px"
                  className="object-cover"
                />

                {image.position === 0 ? (
                  <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-highlight px-2 py-1 text-[11px] font-extrabold text-ink">
                    <Star size={11} strokeWidth={2.8} />
                    Główne
                  </span>
                ) : null}

                <span
                  aria-hidden="true"
                  className="absolute bottom-2 left-2 rounded-md bg-surface/85 p-1 text-ink"
                >
                  <GripVertical size={14} strokeWidth={2.4} />
                </span>

                <button
                  type="button"
                  onClick={() => void remove(image.id)}
                  aria-label="Usuń zdjęcie"
                  className="absolute top-2 right-2 rounded-md bg-surface/85 p-1.5 text-ink transition-colors hover:bg-accent hover:text-ink"
                >
                  <Trash2 size={14} strokeWidth={2.4} />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function putWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    request.setRequestHeader("Content-Type", file.type);

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    request.addEventListener("load", () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`Upload failed with status ${request.status}`)),
    );
    request.addEventListener("error", () => reject(new Error("Upload failed")));
    request.send(file);
  });
}
