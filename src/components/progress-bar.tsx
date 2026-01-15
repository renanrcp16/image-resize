/**
 * A small, reusable progress bar component.
 * - value: current completed count
 * - max: total count
 * - label: optional message above the bar
 */
export default function ProgressBar({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label?: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
      {label ? <p className="text-sm text-zinc-300">{label}</p> : null}

      <div className="mt-3 h-3 w-full overflow-hidden rounded-full border border-zinc-800 bg-zinc-950">
        <div
          className="h-full bg-zinc-100 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
        <span>
          {value}/{max}
        </span>
        <span>{pct}%</span>
      </div>
    </div>
  );
}
