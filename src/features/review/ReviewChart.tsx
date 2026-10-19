import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { init, use as registerCharts, type ECharts } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkAreaComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ChartData } from '../../generated/contracts';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { matchTime, numberText } from './format';
registerCharts([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkAreaComponent,
  CanvasRenderer,
]);
export default function ReviewChart({
  data,
  metric,
  onSelect,
  comparison,
  maxTime,
  minTime,
  highlight,
  label,
  failureLabel,
}: {
  comparison?: ChartData;
  maxTime?: number;
  minTime?: number;
  highlight?: [number, number];
  label?: string;
  failureLabel?: string;
  data: ChartData;
  metric: 'gold' | 'cs';
  onSelect: (ms: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const instance = useRef<ECharts | null>(null);
  const [failed, setFailed] = useState(false);
  const { t, i18n } = useTranslation();
  useEffect(() => {
    if (!ref.current) return;
    let observer: ResizeObserver | undefined;
    let themeObserver: MutationObserver | undefined;
    try {
      const chart = init(ref.current);
      instance.current = chart;
      const draw = () => {
        try {
          const styles = getComputedStyle(ref.current!);
          const color = (token: string) => styles.getPropertyValue(token).trim();
          chart.setOption({
            animation: false,
            color: [color('--chart-self'), color('--chart-opponent')],
            grid: { left: 55, right: 20, top: 42, bottom: 30 },
            legend: { textStyle: { color: color('--foreground') } },
            textStyle: { color: color('--foreground') },
            tooltip: {
              trigger: 'axis',
              renderMode: 'richText',
              backgroundColor: color('--popover'),
              borderColor: color('--border'),
              textStyle: { color: color('--popover-foreground') },
              valueFormatter: (value: unknown) =>
                typeof value === 'number' ? numberText(value) : '—',
            },
            xAxis: {
              type: 'value',
              axisLabel: { formatter: matchTime, color: color('--chart-axis') },
              axisLine: { lineStyle: { color: color('--chart-axis') } },
              min: minTime || 0,
              max: maxTime,
            },
            yAxis: {
              type: 'value',
              axisLabel: { color: color('--chart-axis') },
              splitLine: { lineStyle: { color: color('--chart-grid') } },
            },
            series: [
              {
                markArea: highlight
                  ? {
                      silent: true,
                      itemStyle: { color: color('--accent'), opacity: 0.35 },
                      data: [[{ xAxis: highlight[0] }, { xAxis: highlight[1] }]],
                    }
                  : undefined,
                id: 'personal',
                name: t(comparison ? 'scouting.left' : 'review.personal'),
                type: 'line',
                showSymbol: false,
                connectNulls: false,
                data: data.points.map((p) => [p.timestampMs, p[metric]]),
              },
              {
                id: 'opponent',
                name: t(comparison ? 'scouting.right' : 'review.opponent'),
                type: 'line',
                showSymbol: false,
                connectNulls: false,
                lineStyle: { type: 'dashed' },
                data: comparison
                  ? comparison.points.map((p) => [p.timestampMs, p[metric]])
                  : data.points.map((p) => [
                      p.timestampMs,
                      metric === 'gold' ? p.opponentGold : p.opponentCs,
                    ]),
              },
            ],
          });
        } catch {
          setFailed(true);
        }
      };
      draw();
      chart.on('click', (event) => {
        const point = event.data as [number, number] | undefined;
        if (point) onSelect(point[0]);
      });
      observer = new ResizeObserver(() => {
        try {
          chart.resize();
        } catch {
          setFailed(true);
        }
      });
      observer.observe(ref.current);
      themeObserver = new MutationObserver(draw);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'data-mode'],
      });
    } catch {
      setFailed(true);
    }
    return () => {
      observer?.disconnect();
      themeObserver?.disconnect();
      instance.current?.dispose();
      instance.current = null;
    };
  }, [data, metric, i18n.language, t, onSelect, comparison, maxTime, minTime, highlight]);
  return failed ? (
    <Alert>
      <AlertDescription>{failureLabel || t('review.chartFailed')}</AlertDescription>
    </Alert>
  ) : (
    <div
      data-ui="review-chart"
      className="w-full h-[320px] min-w-0 overflow-hidden"
      ref={ref}
      role="img"
      aria-label={label || t(comparison ? 'scouting.comparisonChart' : `review.${metric}Chart`)}
    />
  );
}
