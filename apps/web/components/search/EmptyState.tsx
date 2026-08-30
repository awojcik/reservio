import { Button } from "@/components/ui/Button";

export function EmptyState({ onReset }: { onReset: () => void }) {
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
