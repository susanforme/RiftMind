import { championName } from '../../lib/display-names';
import { useEffect, useRef } from 'react';
import { init, use as registerCharts } from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useTranslation } from 'react-i18next';
import type { ChampionStats } from '../../generated/contracts';
registerCharts([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);
export default function ChampionGamesChart({ rows }: { rows: ChampionStats[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    if (!ref.current) return;
    const chart = init(ref.current);
    const draw = () => {
      const style = getComputedStyle(ref.current!);
      chart.setOption({
        animation: false,
        grid: { left: 12, right: 12, top: 20, bottom: 12, containLabel: true },
        textStyle: { color: style.getPropertyValue('--foreground').trim() },
        color: [style.getPropertyValue('--chart-self').trim()],
        tooltip: {
          renderMode: 'richText',
          backgroundColor: style.getPropertyValue('--popover').trim(),
          borderColor: style.getPropertyValue('--border').trim(),
          textStyle: { color: style.getPropertyValue('--popover-foreground').trim() },
        },
        xAxis: {
          type: 'category',
          axisLabel: {
            color: style.getPropertyValue('--muted-foreground').trim(),
            hideOverlap: true,
          },
          axisLine: { lineStyle: { color: style.getPropertyValue('--chart-axis').trim() } },
          data: rows.slice(0, 15).map((r) => championName(t, r.championId)),
        },
        yAxis: {
          type: 'value',
          axisLabel: {
            color: style.getPropertyValue('--muted-foreground').trim(),
            hideOverlap: true,
          },
          minInterval: 1,
          splitLine: { lineStyle: { color: style.getPropertyValue('--chart-grid').trim() } },
        },
        series: [
          {
            type: 'bar',
            data: rows.slice(0, 15).map((r) => r.games),
            name: t('scouting.games'),
            barMaxWidth: 32,
          },
        ],
      });
    };
    draw();
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-mode'],
    });
    return () => {
      theme.disconnect();
      observer.disconnect();
      chart.dispose();
    };
  }, [rows, t]);
  return (
    <div
      ref={ref}
      data-ui="pool-chart"
      className="w-full h-[220px] min-w-0"
      role="img"
      aria-label={t('scouting.championsChart')}
    />
  );
}
