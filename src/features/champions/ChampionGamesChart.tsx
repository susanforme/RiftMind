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
        grid: { left: 40, right: 20, top: 20, bottom: 30 },
        textStyle: { color: style.getPropertyValue('--foreground').trim() },
        color: [style.getPropertyValue('--primary').trim()],
        tooltip: { renderMode: 'richText' },
        xAxis: {
          type: 'category',
          axisLabel: { color: style.getPropertyValue('--muted-foreground').trim() },
          axisLine: { lineStyle: { color: style.getPropertyValue('--border').trim() } },
          data: rows.slice(0, 15).map((r) => championName(t, r.championId)),
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: style.getPropertyValue('--muted-foreground').trim() },
          minInterval: 1,
          splitLine: { lineStyle: { color: style.getPropertyValue('--border').trim() } },
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
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
    return () => {
      theme.disconnect();
      observer.disconnect();
      chart.dispose();
    };
  }, [rows, t]);
  return (
    <div ref={ref} className="pool-chart" role="img" aria-label={t('scouting.championsChart')} />
  );
}
