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
      chart.setOption({
        animation: false,
        color: [token('--chart-opponent'), token('--chart-self')],
        grid: { left: 55, right: 24, top: 45, bottom: 70 },
        legend: { textStyle: { color: token('--foreground') } },
        tooltip: {
          trigger: 'axis',
          renderMode: 'richText',
          backgroundColor: token('--popover'),
          borderColor: token('--border'),
          textStyle: { color: token('--popover-foreground') },
        },
        xAxis: {
          type: 'category',
          data: all.map((member) => member.startedAt.slice(5, 10)),
          axisLabel: { color: token('--chart-axis') },
          axisLine: { lineStyle: { color: token('--chart-axis') } },
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: token('--chart-axis') },
          splitLine: { lineStyle: { color: token('--chart-grid') } },
        },
        series: [
          {
            id: 'baseline',
            name: t('review.baseline'),
            type: 'line',
            connectNulls: false,
            data: all.map((member, index) => (index < baseline.length ? member.value : null)),
            lineStyle: { type: 'dashed' },
          },
          {
            id: 'current',
            name: t('review.current'),
            type: 'line',
            connectNulls: false,
            data: all.map((member, index) => (index >= baseline.length ? member.value : null)),
            markLine: {
              symbol: 'none',
              label: { color: token('--foreground') },
              data: [
                {
                  name: t('training.target'),
                  yAxis: goal.scope.target,
                  lineStyle: { color: token('--chart-positive') },
                },
                ...(evaluation?.baseline == null
                  ? []
                  : [
                      {
                        name: t('review.baseline'),
                        yAxis: evaluation.baseline,
                        lineStyle: { color: token('--chart-axis') },
                      },
                    ]),
              ],
            },
          },
        ],
      });
    };
    draw();
    chart.on('click', (event) => {
      if (typeof event.dataIndex === 'number' && all[event.dataIndex]) onOpen(all[event.dataIndex]);
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    const theme = new MutationObserver(draw);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-mode'],
    });
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
      className="w-full h-[320px] min-w-0 overflow-hidden"
      role="img"
      aria-label={t('training.goalTrend')}
    />
  );
}
