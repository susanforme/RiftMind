import { championName } from '../../lib/display-names';
import { useEffect, useRef } from 'react';
import { init, use as registerCharts } from 'echarts/core';
import { BarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useTranslation } from 'react-i18next';
import type { ChampionStats } from '../../generated/contracts';
import { GameEntityIcon } from '../../components/GameEntityIcon';
import { Button } from '../../components/ui/button';

registerCharts([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

export default function ChampionGamesChart({
  rows,
  onChampion,
}: {
  rows: ChampionStats[];
  onChampion: (championId: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    if (!ref.current) return;
    const chart = init(ref.current);
    const draw = () => {
      const style = getComputedStyle(ref.current!);
      const champions = rows.slice(0, 6);
      chart.setOption({
        animation: false,
        grid: { left: 8, right: 40, top: 0, bottom: 24 },
        textStyle: { color: style.getPropertyValue('--foreground').trim() },
        color: [style.getPropertyValue('--chart-self').trim()],
        tooltip: {
          renderMode: 'richText',
          backgroundColor: style.getPropertyValue('--popover').trim(),
          borderColor: style.getPropertyValue('--border').trim(),
          textStyle: { color: style.getPropertyValue('--popover-foreground').trim() },
        },
        xAxis: {
          type: 'value',
          minInterval: 1,
          axisLabel: {
            color: style.getPropertyValue('--muted-foreground').trim(),
            hideOverlap: true,
          },
          splitLine: { lineStyle: { color: style.getPropertyValue('--chart-grid').trim() } },
        },
        yAxis: {
          type: 'category',
          inverse: true,
          data: Array.from({ length: 6 }, (_, index) =>
            champions[index] ? championName(t, champions[index].championId) : '',
          ),
          axisLabel: { show: false },
          axisTick: { show: false },
          axisLine: { show: false },
        },
        series: [
          {
            type: 'bar',
            data: champions.map((champion) => ({
              value: champion.games,
              championId: champion.championId,
            })),
            name: t('scouting.games'),
            barMaxWidth: 22,
            itemStyle: { borderRadius: [0, 3, 3, 0] },
            label: {
              show: true,
              position: 'right',
              color: style.getPropertyValue('--foreground').trim(),
            },
          },
        ],
      });
    };
    draw();
    chart.on('click', (event) => {
      const championId = (event.data as { championId?: number })?.championId;
      if (championId) onChampion(championId);
    });
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
  }, [rows, t, onChampion]);
  return (
    <div className="flex h-56 min-w-0 gap-2">
      <div className="grid w-32 shrink-0 grid-rows-6 pb-6 sm:w-40">
        {rows.slice(0, 6).map((champion) => (
          <Button
            key={champion.championId ?? 'unknown'}
            variant="ghost"
            aria-label={championName(t, champion.championId)}
            className="h-full justify-start gap-3 overflow-hidden px-1"
            disabled={!champion.championId}
            onClick={() => onChampion(champion.championId!)}
          >
            <GameEntityIcon
              kind="champion"
              id={champion.championId}
              label={championName(t, champion.championId)}
              className="size-8 rounded-full"
            />
            <span className="truncate">{championName(t, champion.championId)}</span>
          </Button>
        ))}
      </div>
      <div
        ref={ref}
        data-ui="pool-chart"
        className="h-56 min-w-0 flex-1"
        role="img"
        aria-label={t('scouting.championsChart')}
      />
    </div>
  );
}
