import { useState } from 'react';
import { formatDate } from '../core/dates';
import { pct, type GroupStat, type Rate } from '../core/metrics';
import type { ISODate } from '../core/types';
import { Details } from './ui';

/*
 * Hand-drawn SVG. Series colour #2B5590 validated against the white surface; text uses
 * ink colours; every value is also available as a table.
 */

function columnPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export interface WeekPoint {
  start: ISODate;
  end: ISODate;
  onTime: Rate;
}

export function WeeklyOnTimeChart({ weeks, overall }: { weeks: WeekPoint[]; overall: Rate }) {
  const [active, setActive] = useState<number | null>(null);
  const W = 680;
  const H = 300;
  const pad = { l: 44, r: 92, t: 16, b: 34 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const band = plotW / weeks.length;
  const barW = Math.min(24, band * 0.6);
  const y = (v: number) => pad.t + plotH * (1 - v);
  const tip = active !== null ? weeks[active] : null;
  const tipX = active !== null ? pad.l + band * active + band / 2 : 0;
  const tipY = tip?.onTime.rate != null ? y(tip.onTime.rate) : y(0);

  return (
    <>
      <figure className="figure-chart">
        <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Share returned on time for each of the last 13 weeks. Overall ${pct(overall)}.`}>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <g key={t}>
              <line className="gridline" x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />
              <text x={pad.l - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {t * 100}%
              </text>
            </g>
          ))}
          {weeks.map((w, i) => {
            const cx = pad.l + band * i + band / 2;
            const v = w.onTime.rate;
            const h = v === null ? 0 : y(0) - y(v);
            return (
              <g key={w.start} className={active === i ? 'on' : undefined}>
                <rect
                  className="hit"
                  x={pad.l + band * i}
                  y={pad.t}
                  width={band}
                  height={plotH}
                  tabIndex={0}
                  aria-label={`Week of ${formatDate(w.start, 'medium')}: ${pct(w.onTime)} returned on time, ${w.onTime.hits} of ${w.onTime.n}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                />
                {v !== null && h > 0 ? <path className="bar" d={columnPath(cx - barW / 2, y(v), barW, h, 4)} pointerEvents="none" /> : null}
                {i % 2 === 0 ? (
                  <text x={cx} y={H - pad.b + 20} textAnchor="middle">
                    {formatDate(w.start, 'short')}
                  </text>
                ) : null}
              </g>
            );
          })}
          <line className="baseline" x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} />
          {overall.rate !== null ? (
            <g pointerEvents="none">
              <line className="avg" x1={pad.l} x2={W - pad.r + 6} y1={y(overall.rate)} y2={y(overall.rate)} />
              <text className="avg-label" x={W - pad.r + 10} y={y(overall.rate)} dominantBaseline="middle">
                All weeks {pct(overall)}
              </text>
            </g>
          ) : null}
        </svg>
        {tip ? (
          <div className="chart-tip" style={{ left: `${(tipX / W) * 100}%`, top: `${(tipY / H) * 100}%` }}>
            <strong>{pct(tip.onTime)}</strong> on time
            <span className="tip-sub">
              {tip.onTime.hits} of {tip.onTime.n}, week of {formatDate(tip.start, 'short')}
            </span>
          </div>
        ) : null}
        <figcaption>Each bar is one week of follow-up windows closing. Weeks are labelled by their first day.</figcaption>
      </figure>
      <Details summary="Show the numbers">
        <table className="table table--s">
          <thead>
            <tr>
              <th>Week</th>
              <th className="numeric">Windows closed</th>
              <th className="numeric">On time</th>
              <th className="numeric">Rate</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.start}>
                <td>
                  {formatDate(w.start, 'short')} to {formatDate(w.end, 'short')}
                </td>
                <td className="numeric">{w.onTime.n}</td>
                <td className="numeric">{w.onTime.hits}</td>
                <td className="numeric">{pct(w.onTime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Details>
    </>
  );
}

function RateCell({ r }: { r: Rate }) {
  const small = r.n < 10;
  return (
    <td>
      <strong className="num">{pct(r)}</strong>
      <span className={`rate-bar${small ? ' is-small' : ''}`} aria-hidden="true">
        {r.rate !== null ? <span style={{ width: `${Math.max(r.rate * 100, 1)}%` }} /> : null}
      </span>
      <span className="cell-sub num">
        {r.hits} of {r.n}
        {small ? ', too few to compare' : ''}
      </span>
    </td>
  );
}

export function FairnessTable({ groups }: { groups: GroupStat[] }) {
  return (
    <table className="table table--s">
      <thead>
        <tr>
          <th>Contact</th>
          <th>On time</th>
          <th>Came back after missing</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <tr key={g.group}>
            <th scope="row" style={{ fontWeight: 600 }}>
              {g.label}
            </th>
            <RateCell r={g.onTime} />
            <RateCell r={g.recovered} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}
