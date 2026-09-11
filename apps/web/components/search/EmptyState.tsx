import { Button } from "@/components/ui/Button";

/**
 * Two situations that look the same on screen and are not the same at all: a
 * search that found nothing, and no search yet. Telling a first-time visitor
 * to "clear the filters" they never set would be nonsense (§5).
 */
export function EmptyState({
  onReset,
  blank = false,
}: {
  onReset: () => void;
  blank?: boolean;
}) {
  if (blank) {
    return (
      <div className="rounded-[14px] border border-dashed border-line bg-surface px-6 py-14 text-center">
        <p className="text-[22px] font-bold tracking-tight">Gdzie się wybierasz?</p>
        <p className="mx-auto mt-2 max-w-[38ch] text-[15px] text-muted">
          Wpisz miasto albo dzielnicę, żeby zobaczyć dostępne miejsca. Termin możesz
          wybrać teraz albo później.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border border-dashed border-line bg-surface px-6 py-14 text-center">
      <p className="text-[22px] font-bold tracking-tight">
        Nie znaleźliśmy takich miejsc.
      </p>
      <p className="mx-auto mt-2 max-w-[34ch] text-[15px] text-muted">
        Spróbuj zmienić termin albo usunąć część filtrów.
      </p>
      <Button className="mt-6" onClick={onReset}>
        Wyczyść filtry
      </Button>
    </div>
  );
}
