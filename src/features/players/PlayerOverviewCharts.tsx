import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { init, use as registerCharts } from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { MatchSummary, RankSnapshot } from '../../generated/contracts';
import { codeName, positionName, queueName, rankName } from '../../lib/display-names';
import { positionStats, rankScore, rankedTiers } from './player-overview';

registerCharts([
  BarChart,
  LineChart,
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export default function PlayerOverviewCharts({
  matches,
  snapshots,
  kind,
}: {
  matches: MatchSummary[];
  snapshots: RankSnapshot[];
  kind: 'positions' | 'rank';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    if (!ref.current) return;
    const chart = init(ref.current);
    const draw = () => {
      const style = getComputedStyle(ref.current!);
      const color = (token: string) => style.getPropertyValue(token).trim();
      const axis = color('--muted-foreground');
      const positions = positionStats(matches);
      const scores = snapshots
        .map((snapshot) => rankScore(snapshot.rank))
        .filter((score): score is number => score !== null);
      const timestamps = snapshots.map((snapshot) => Date.parse(snapshot.collectedAt));
      chart.setOption(
        {
          animation: false,
          aria: {
            enabled: true,
            description: t(kind === 'positions' ? 'players.positions' : 'players.rankHistory'),
          },
          color: [color('--chart-self'), color('--chart-opponent')],
          textStyle: { fontFamily: style.fontFamily, color: color('--foreground') },
          grid: {
            left: kind === 'positions' ? 64 : 90,
            right: 20,
            top: kind === 'positions' ? 8 : 44,
            bottom: 32,
          },
          tooltip: {
            trigger: 'axis',
            renderMode: 'richText',
            confine: true,
            backgroundColor: color('--popover'),
            borderColor: color('--border'),
            textStyle: { color: color('--popover-foreground') },
            ...(kind === 'rank'
              ? {
                  formatter: (parameters: unknown) => {
                    const entries = parameters as {
                      data: { name: string; value: [number, number | null] };
                    }[];
                    return entries
                      .map(
                        (entry) =>
                          `${new Date(entry.data.value[0]).toLocaleString()}\n${entry.data.name}`,
                      )
                      .join('\n');
                  },
                }
              : {}),
          },
          legend: kind === 'rank' ? { top: 0, textStyle: { color: axis } } : undefined,
          xAxis:
            kind === 'positions'
              ? {
                  type: 'value',
                  minInterval: 1,
                  name: t('scouting.games'),
                  nameLocation: 'middle',
                  nameGap: 22,
                  nameTextStyle: { color: axis },
                  axisLabel: { color: axis },
                  splitLine: { lineStyle: { color: color('--chart-grid') } },
                }
              : {
                  type: 'time',
                  min: Math.min(...timestamps) - 3600000,
                  max: Math.max(...timestamps) + 3600000,
                  axisLabel: { color: axis, hideOverlap: true },
                  splitNumber: 4,
                },
          yAxis:
            kind === 'positions'
              ? {
                  type: 'category',
                  inverse: true,
                  data: positions.map((row) => positionName(t, row.position)),
                  axisLabel: { color: axis },
                  axisTick: { show: false },
                  axisLine: { show: false },
                }
              : {
                  type: 'value',
                  scale: true,
                  min: Math.max(0, Math.floor(Math.min(...scores) / 100) * 100 - 100),
                  max: Math.ceil(Math.max(...scores) / 100) * 100 + 100,
                  minInterval: 100,
                  axisLabel: {
                    color: axis,
                    formatter: (score: number) => {
                      if (score >= 2800) return `${codeName(t, 'rank', 'MASTER')} ${score - 2800}`;
                      const tier = rankedTiers[Math.max(0, Math.floor(score / 400))];
                      return `${codeName(t, 'rank', tier)} ${['IV', 'III', 'II', 'I'][Math.floor((score % 400) / 100)]}`;
                    },
                  },
                  splitLine: { lineStyle: { color: color('--chart-grid') } },
                },
          series:
            kind === 'positions'
              ? [
                  {
                    type: 'bar',
                    name: t('scouting.games'),
                    data: positions.map((row) => row.games),
                    barMaxWidth: 22,
                    label: { show: true, position: 'right', color: color('--foreground') },
                    itemStyle: { borderRadius: [0, 3, 3, 0] },
                  },
                ]
              : [...new Set(snapshots.map((snapshot) => snapshot.rank.queue))].map((queue) => ({
                  type: 'line',
                  name: queueName(t, queue),
                  connectNulls: false,
                  symbolSize: 7,
                  data: snapshots
                    .filter((snapshot) => snapshot.rank.queue === queue)
                    .map((snapshot) => ({
                      name: rankName(t, snapshot.rank),
                      value: [Date.parse(snapshot.collectedAt), rankScore(snapshot.rank)],
                    })),
                })),
        },
        true,
      );
    };
    draw();
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(ref.current);
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-mode'],
    });
    return () => {
      resize.disconnect();
      theme.disconnect();
      chart.dispose();
    };
  }, [matches, snapshots, kind, t]);
  return (
    <div
      ref={ref}
      className="h-64 w-full min-w-0"
      role="img"
      aria-label={t(kind === 'positions' ? 'players.positions' : 'players.rankHistory')}
    />
  );
}
