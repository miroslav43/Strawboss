'use client';

import {
  CloudLightning,
  Droplets,
  Snowflake,
  SprayCan,
  ThermometerSun,
  Tractor,
  type LucideIcon,
} from 'lucide-react';
import type { MeteoAccessLevel, MeteoAgroIndicators, MeteoRiskLevel } from '@strawboss/types';
import { useI18n } from '@/lib/i18n';
import { useMeteoFormat } from './format';
import { useWeatherFormat } from './weather-format';

type Tone = 'green' | 'amber' | 'red' | 'grey';

const TONE: Record<Tone, { badge: string; ring: string; icon: string }> = {
  green: { badge: 'bg-green-100 text-green-800', ring: 'border-green-200', icon: 'bg-green-50 text-green-600' },
  amber: { badge: 'bg-amber-100 text-amber-800', ring: 'border-amber-200', icon: 'bg-amber-50 text-amber-600' },
  red: { badge: 'bg-red-100 text-red-800', ring: 'border-red-200', icon: 'bg-red-50 text-red-600' },
  grey: { badge: 'bg-neutral-200 text-neutral-700', ring: 'border-neutral-200', icon: 'bg-neutral-100 text-neutral-500' },
};

const RISK_TONE: Record<MeteoRiskLevel, Tone> = { none: 'green', low: 'amber', moderate: 'amber', high: 'red' };
const ACCESS_TONE: Record<MeteoAccessLevel, Tone> = { ok: 'green', marginal: 'amber', no_go: 'red', unknown: 'grey' };

function IndicatorCard({
  icon: Icon,
  title,
  tone,
  badge,
  line,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  tone: Tone;
  badge: string;
  line: string;
  detail?: string;
}) {
  const s = TONE[tone];
  return (
    <div className={`flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm ${s.ring}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${s.icon}`}>
          <Icon className="h-5 w-5" />
        </span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.badge}`}>{badge}</span>
      </div>
      <div>
        <p className="text-sm font-semibold text-neutral-800">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">{line}</p>
        {detail && <p className="mt-1 text-xs text-neutral-400">{detail}</p>}
      </div>
    </div>
  );
}

/** Six agronomic indicators with a traffic-light badge and a one-line reason. */
export function AgroIndicatorCards({ agro }: { agro: MeteoAgroIndicators | null }) {
  const { t } = useI18n();
  const f = useWeatherFormat();
  const mf = useMeteoFormat();

  if (!agro) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5 text-sm text-neutral-400">
        {t('meteo.wx.unavailable')}
      </div>
    );
  }

  const reasons = (keys: string[]) => keys.map((k) => t(`meteo.agro.reason.${k}`)).join(' · ');
  const { spray, workability: wk, frost, heat, storm, waterBalance: wb } = agro;

  const sprayTone: Tone = spray.nowOk === null ? 'grey' : spray.nowOk ? 'green' : 'amber';
  const sprayBadge =
    spray.nowOk === null ? t('meteo.agro.spray.unknown') : spray.nowOk ? t('meteo.agro.spray.ok') : t('meteo.agro.spray.no');
  const sprayLine = spray.nowReasons.length > 0 && spray.nowOk !== true ? reasons(spray.nowReasons) : '';
  const sprayNext = spray.next
    ? t('meteo.agro.spray.next', {
        from: mf.time(spray.next.start),
        to: mf.time(spray.next.end),
        hours: spray.next.hours,
      })
    : t('meteo.agro.spray.noWindow');

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <IndicatorCard
        icon={SprayCan}
        title={t('meteo.agro.spray.title')}
        tone={sprayTone}
        badge={sprayBadge}
        line={sprayLine || sprayNext}
        detail={sprayLine ? sprayNext : undefined}
      />
      <IndicatorCard
        icon={Tractor}
        title={t('meteo.agro.workability.title')}
        tone={ACCESS_TONE[wk.level]}
        badge={t(`meteo.agro.workability.${wk.level}`)}
        line={wk.reasons.length > 0 ? reasons(wk.reasons) : t('meteo.agro.workability.hint')}
        detail={t('meteo.agro.workability.detail', {
          soil: wk.soilMoist === null ? '—' : f.pct(wk.soilMoist),
          rain48: f.mm(wk.rainPast48hMm),
          rain24: f.mm(wk.rainNext24hMm),
        })}
      />
      <IndicatorCard
        icon={Snowflake}
        title={t('meteo.agro.frost.title')}
        tone={RISK_TONE[frost.level]}
        badge={t(`meteo.agro.risk.${frost.level}`)}
        line={t('meteo.agro.frost.line', { air: f.temp(frost.minAirC, 1), soil: f.temp(frost.minSoilC, 1) })}
        detail={frost.at && frost.level !== 'none' ? mf.time(frost.at) : undefined}
      />
      <IndicatorCard
        icon={ThermometerSun}
        title={t('meteo.agro.heat.title')}
        tone={RISK_TONE[heat.level]}
        badge={t(`meteo.agro.risk.${heat.level}`)}
        line={t('meteo.agro.heat.line', { max: f.temp(heat.tMaxC, 1) })}
        detail={heat.date && heat.level !== 'none' ? f.dayMonth(heat.date) : undefined}
      />
      <IndicatorCard
        icon={CloudLightning}
        title={t('meteo.agro.storm.title')}
        tone={RISK_TONE[storm.level]}
        badge={t(`meteo.agro.risk.${storm.level}`)}
        line={t('meteo.agro.storm.line', {
          cape: storm.maxCapeJkg === null ? '—' : `${f.n0.format(storm.maxCapeJkg)} J/kg`,
          prob: f.pct(storm.precipProb),
        })}
        detail={storm.at && storm.level !== 'none' ? mf.time(storm.at) : undefined}
      />
      <IndicatorCard
        icon={Droplets}
        title={t('meteo.agro.water.title', { days: wb.days })}
        tone={wb.balanceMm === null ? 'grey' : wb.deficit ? 'amber' : 'green'}
        badge={wb.balanceMm === null ? t('meteo.agro.water.unknown') : wb.deficit ? t('meteo.agro.water.deficit') : t('meteo.agro.water.ok')}
        line={t('meteo.agro.water.line', { et0: f.mm(wb.et0Mm), rain: f.mm(wb.rainMm) })}
        detail={wb.balanceMm === null ? undefined : `${t('meteo.agro.water.balance')}: ${f.signed(wb.balanceMm)} mm`}
      />
    </div>
  );
}
