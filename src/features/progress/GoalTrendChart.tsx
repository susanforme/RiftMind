import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { init, use as registerCharts } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { GoalEvaluation, TrainingGoal, GoalMember } from '../../generated/contracts';
registerCharts([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  CanvasRenderer,
]);
export default function GoalTrendChart({
  goal,
  evaluation,
  onOpen,
}: {
  goal: TrainingGoal;
  evaluation: GoalEvaluation | null | undefined;
  onOpen: (member: GoalMember) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const chart = init(ref.current);
    const baseline = [...goal.baseline].sort(
      (left, right) =>
        left.startedAt.localeCompare(right.startedAt) ||
        left.matchKey.localeCompare(right.matchKey),
    );
    const members = [...(evaluation?.members || [])].sort(
      (left, right) =>
        left.startedAt.localeCompare(right.startedAt) ||
        left.matchKey.localeCompare(right.matchKey),
    );
    const all = [...baseline, ...members];
    const draw = () => {
      const styles = getComputedStyle(ref.current!);
      const token = (name: string) => styles.getPropertyValue(name).trim();
      chart.setOption(
        {
          animation: false,
          color: [token('--muted-foreground'), token('--primary')],
          grid: { left: 55, right: 24, top: 45, bottom: 70 },
          legend: { textStyle: { color: token('--foreground') } },
          tooltip: { trigger: 'axis', renderMode: 'richText' },
          xAxis: {
            type: 'category',
            data: all.map((member) => member.matchKey),
            axisLabel: { color: token('--muted-foreground'), rotate: 25 },
          },
          yAxis: {
            type: 'value',
            axisLabel: { color: token('--muted-foreground') },
            splitLine: { lineStyle: { color: token('--border') } },
          },
          series: [
            {
              name: t('review.baseline'),
              type: 'line',
              connectNulls: false,
              data: all.map((member, index) => (index < baseline.length ? member.value : null)),
              lineStyle: { type: 'dashed' },
            },
            {
              name: t('review.current'),
              type: 'line',
              connectNulls: false,
              data: all.map((member, index) => (index >= baseline.length ? member.value : null)),
              markLine: {
                symbol: 'none',
                label: { color: token('--foreground') },
                data: [
                  { name: t('training.target'), yAxis: goal.scope.target },
                  ...(evaluation?.baseline == null
                    ? []
                    : [{ name: t('review.baseline'), yAxis: evaluation.baseline }]),
                ],
              },
            },
          ],
        },
        true,
      );
    };
    draw();
    chart.on('click', (event) => {
      if (typeof event.dataIndex === 'number' && all[event.dataIndex]) onOpen(all[event.dataIndex]);
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
    return () => {
      observer.disconnect();
      theme.disconnect();
      chart.dispose();
    };
  }, [goal, evaluation, t, onOpen]);
  return (
    <div
      ref={ref}
      data-ui="review-chart"
      className="w-full h-[280px] min-w-0 overflow-hidden"
      role="img"
      aria-label={t('training.goalTrend')}
    />
  );
}
