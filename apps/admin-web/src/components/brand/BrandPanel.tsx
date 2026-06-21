import type { ReactNode } from 'react';

const TRACTOR = '/brand/strawboss-tractor.svg';

/**
 * Shared deep-forest brand panel for the public surface (login + request portal).
 * Full-height beside the content on desktop; a compact header band on mobile.
 * Presentational only — callers pass already-translated copy and point icons.
 */
export function BrandPanel({
  eyebrow,
  title,
  headline,
  sub,
  points,
  footer,
}: {
  eyebrow: string;
  title: string;
  headline: string;
  sub: string;
  points: { icon: ReactNode; label: string }[];
  footer: string;
}) {
  return (
    <aside className="relative isolate overflow-hidden bg-gradient-to-b from-forest to-forest-deep text-cream lg:sticky lg:top-0 lg:h-screen">
      {/* field-rows motif + warm straw glow + bottom vignette */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(120% 85% at 88% -12%, rgba(230,201,156,0.22), transparent 55%),' +
            'linear-gradient(to top, rgba(7,40,23,0.55), transparent 45%),' +
            'repeating-linear-gradient(118deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 26px)',
        }}
      />
      {/* oversized tractor watermark */}
      <img
        src={TRACTOR}
        alt=""
        aria-hidden
        className="pointer-events-none absolute -bottom-10 -right-8 hidden w-72 opacity-[0.07] lg:block"
      />

      <div className="relative z-10 flex h-full flex-col justify-between gap-8 p-6 sm:p-10 lg:p-12">
        {/* brand */}
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cream/10 ring-1 ring-cream/20 backdrop-blur-sm">
            <img src={TRACTOR} alt="" width={28} height={28} className="h-7 w-7" aria-hidden />
          </span>
          <div className="leading-tight">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-straw">
              {eyebrow}
            </p>
            <p className="text-base font-semibold text-cream">{title}</p>
          </div>
        </div>

        {/* headline + capability points (rich on desktop, compact on mobile) */}
        <div className="max-w-md">
          <h2 className="text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-4xl lg:text-[2.75rem]">
            {headline}
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-cream/80 sm:text-base">{sub}</p>

          {points.length > 0 && (
            <ul className="mt-8 hidden space-y-3.5 lg:block">
              {points.map((row, i) => (
                <li key={i} className="flex items-center gap-3 text-sm text-cream/90">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-cream/10 text-straw ring-1 ring-cream/15">
                    {row.icon}
                  </span>
                  {row.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="hidden text-[11px] font-medium uppercase tracking-[0.16em] text-cream/40 lg:block">
          {footer}
        </p>
      </div>
    </aside>
  );
}
