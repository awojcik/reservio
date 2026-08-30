import { ImageWithFallback } from "@/components/ui/ImageWithFallback";

type GalleryProps = {
  images: string[];
  title: string;
};

/** One large frame plus up to four thumbnails, all reserved at 4:3. */
export function Gallery({ images, title }: GalleryProps) {
  const [lead, ...rest] = images;
  const thumbnails = rest.slice(0, 4);

  return (
    <div className="grid gap-2 sm:grid-cols-[1.6fr_1fr]">
      <div className="relative aspect-[4/3] overflow-hidden rounded-[14px] bg-placeholder">
        <ImageWithFallback
          src={lead}
          alt={`${title} — zdjęcie główne`}
          fill
          priority
          sizes="(max-width: 640px) 100vw, 60vw"
          className="object-cover"
        />
      </div>

      {thumbnails.length ? (
        <div className="grid grid-cols-2 gap-2">
          {thumbnails.map((image, index) => (
            <div
              key={image}
              className="relative aspect-[4/3] overflow-hidden rounded-[10px] bg-placeholder"
            >
              <ImageWithFallback
                src={image}
                alt={`${title} — zdjęcie ${index + 2}`}
                fill
                loading="lazy"
                sizes="(max-width: 640px) 50vw, 20vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
