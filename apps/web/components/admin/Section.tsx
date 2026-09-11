/** A titled card. The panel is a stack of these — plain, and consistent. */
export function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-bold tracking-tightest">{title}</h2>
          {description ? <p className="mt-1 text-[14px] text-muted">{description}</p> : null}
        </div>
        {action}
      </div>

      <div className="mt-3 rounded-card border border-line bg-surface">{children}</div>
    </section>
  );
}

/** A label/value pair, the panel's unit of detail. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[12px] font-bold tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-[15px]">{children}</dd>
    </div>
  );
}
