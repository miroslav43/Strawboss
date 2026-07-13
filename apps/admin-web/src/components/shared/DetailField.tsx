'use client';

/** A label + value pair for the detail grids. Renders nothing when empty. */
export function DetailField({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="min-w-0">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="truncate text-sm font-medium text-neutral-800">{value}</p>
    </div>
  );
}
