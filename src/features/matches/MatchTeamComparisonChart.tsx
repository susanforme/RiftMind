import { useEffect, useRef } from 'react';
import { init, use as registerCharts } from 'echarts/core';
import { BarChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useTranslation } from 'react-i18next';
import type { ScoreboardParticipant, ScoreboardTeam } from '../../generated/contracts';
import { championName } from '../../lib/display-names';
import { GameEntityIcon } from '../../components/GameEntityIcon';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { scoreboardTeamName } from './match-scoreboard-formatters';
registerCharts([
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
  CanvasRenderer,
]);

export default function MatchTeamComparisonChart({
  participants,
  teams,
  version,
}: {
  participants: ScoreboardParticipant[];
  teams: ScoreboardTeam[];
  version: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    const element = container.current;
    if (!element || !participants.length) return;
    const chart = init(element);
    const draw = () => {
      if (!element.clientWidth || !element.clientHeight) return;
      const style = getComputedStyle(element);
      const colors = ['--chart-self', '--chart-opponent'].map((token) =>
        style.getPropertyValue(token).trim(),
      );
      const foreground = style.getPropertyValue('--foreground').trim();
      const muted = style.getPropertyValue('--muted-foreground').trim();
      chart.setOption({
        animation: false,
        aria: { enabled: true },
        grid: { left: 4, right: 68, top: 38, bottom: 32 },
        textStyle: { color: foreground },
        tooltip: { trigger: 'axis', renderMode: 'richText' },
        xAxis: {
          type: 'value',
          axisLabel: { color: muted },
          splitLine: { lineStyle: { color: style.getPropertyValue('--border').trim() } },
        },
        yAxis: {
          type: 'category',
          inverse: true,
          data: participants.map((participant) => championName(t, participant.championId)),
          axisTick: { show: false },
          axisLabel: { show: false },
          axisLine: { show: false },
        },
        legend: { top: 0, textStyle: { color: foreground } },
        series: teams.map((team, index) => ({
          name: scoreboardTeamName(t, team.id),
          type: 'bar',
          barGap: '-100%',
          barMaxWidth: 18,
          itemStyle: { color: colors[index % colors.length], borderRadius: [0, 3, 3, 0] },
          data: participants.map((participant) =>
            participant.teamId === team.id ? participant.damage : null,
          ),
          label: {
            show: true,
            position: 'right',
            color: foreground,
          },
        })),
      });
      chart.resize();
    };
    draw();
    const resize = new ResizeObserver(draw);
    resize.observe(element);
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-mode', 'data-theme'],
    });
    return () => {
      resize.disconnect();
      theme.disconnect();
      chart.dispose();
    };
  }, [participants, teams, t]);
  if (!participants.some((participant) => participant.damage !== null))
    return (
      <Alert>
        <AlertDescription>{t('matches.dataMissing')}</AlertDescription>
      </Alert>
    );
  return (
    <div className="grid min-w-0 grid-cols-[minmax(96px,150px)_minmax(0,1fr)] gap-2">
      <div className="flex h-[400px] flex-col pb-8 pt-[38px]" aria-hidden="true">
        {participants.map((participant) => (
          <div key={participant.id} className="flex min-h-0 flex-1 items-center gap-2">
            <GameEntityIcon
              kind="champion"
              id={participant.championId}
              version={version}
              label={championName(t, participant.championId)}
              className="size-6 rounded-sm"
            />
            <span className="truncate text-xs text-muted-foreground">
              {championName(t, participant.championId)}
            </span>
          </div>
        ))}
      </div>
      <div
        ref={container}
        className="h-[400px] w-full min-w-0"
        role="img"
        aria-label={t('matches.teamDamage')}
      />
    </div>
  );
}
