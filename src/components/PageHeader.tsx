export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6 md:mb-8">
      <div className="min-w-0">
        <h1 className="font-display text-[1.65rem] md:text-[2rem] font-semibold tracking-tight leading-tight">
          {title}
        </h1>
        {subtitle && (
          <div className="text-sm mt-1.5" style={{ color: "var(--ink-muted)" }}>
            {subtitle}
          </div>
        )}
      </div>
      {action && <div className="shrink-0 pt-1">{action}</div>}
    </div>
  );
}
