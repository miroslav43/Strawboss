import { Injectable } from '@nestjs/common';
import { MeteoClient, type ForecastRequestSpec, type MeteoLane } from '../meteo-client';
import { MeteoBudgetService } from './meteo-budget.service';
import type { ForecastSpec } from './weather.specs';

type Raw = Record<string, unknown>;

/**
 * Budget-checked upstream calls for the weather / climate features. null on a
 * refused budget, cooldown, 429, network error or a malformed answer — callers
 * serve stale / nothing and never throw.
 */
@Injectable()
export class MeteoUpstreamService {
  constructor(
    private readonly client: MeteoClient,
    private readonly budget: MeteoBudgetService,
  ) {}

  async forecast(
    spec: ForecastSpec,
    points: { lat: number; lon: number }[],
    lane: MeteoLane,
  ): Promise<Raw[] | null> {
    if (points.length === 0) return [];
    const nVars = (spec.current?.length ?? 0) + (spec.hourly?.length ?? 0) + (spec.daily?.length ?? 0);
    const nDays = Math.max(
      spec.forecastDays ?? 0,
      ((spec.pastHours ?? 0) + (spec.forecastHours ?? 0)) / 24,
      1,
    );
    const weight = MeteoClient.estimateWeight({ nVars, nDays, nLocations: points.length });
    if (!(await this.budget.tryConsume(weight, lane))) return null;
    const req: ForecastRequestSpec = {
      lats: points.map((p) => p.lat),
      lons: points.map((p) => p.lon),
      ...spec,
    };
    const r = await this.client.requestForecast(req, lane);
    if (r.status === 429) {
      await this.budget.noteRateLimited();
      return null;
    }
    if (!r.locations || r.locations.length !== points.length) return null;
    return r.locations;
  }

  async archive(
    p: { lat: number; lon: number; startDate: string; endDate: string; daily: readonly string[] },
    lane: MeteoLane = 'background',
  ): Promise<Raw | null> {
    const days = Math.max(
      1,
      Math.round((Date.parse(p.endDate) - Date.parse(p.startDate)) / 86_400_000) + 1,
    );
    const weight = MeteoClient.estimateWeight({ nVars: p.daily.length, nDays: days, nLocations: 1 });
    if (!(await this.budget.tryConsume(weight, lane))) return null;
    const r = await this.client.requestArchive(p, lane);
    if (r.status === 429) {
      await this.budget.noteRateLimited();
      return null;
    }
    return r.daily;
  }
}
