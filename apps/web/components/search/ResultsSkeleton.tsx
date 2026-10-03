/**
 * Mirrors the real card's geometry so the switch from loading to results does
 * not shift the layout.
 */
export function ResultsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <ul aria-hidden="true" className="mt-4 flex flex-col gap-3">
      {Array.from({ length: count }, (_, index) => (
        <li key={index}>
          <div className="animate-pulse rounded-[14px] border border-line bg-surface p-3 sm:grid sm:grid-cols-[minmax(0,232px)_minmax(0,1fr)] sm:gap-4">
            <div className="aspect-[4/3] rounded-[10px] bg-placeholder" />
            <div className="flex min-w-0 flex-col pt-3 sm:pt-1">
              <div className="h-5 w-1/2 rounded bg-placeholder" />
              <div className="mt-2 h-4 w-2/5 rounded bg-placeholder" />
              <div className="mt-3 h-4 w-1/3 rounded bg-placeholder" />
              <div className="mt-1 h-4 w-3/5 rounded bg-placeholder" />
              <div className="mt-auto flex justify-end pt-4">
                <div className="h-8 w-28 rounded bg-placeholder" />
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
