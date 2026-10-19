import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { init, use as registerCharts } from 'echarts/core';
import { BoxplotChart, ScatterChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { BaselineMetric } from '../../generated/contracts';
registerCharts([BoxplotChart, ScatterChart, GridComponent, TooltipComponent, CanvasRenderer]);
export default function PersonalDistributionChart({ metric }: { metric: BaselineMetric }) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    if (!ref.current) return;
    const chart = init(ref.current);
    const draw = () => {
      const styles = getComputedStyle(ref.current!);
      const token = (name: string) => styles.getPropertyValue(name).trim();
      chart.setOption({
        animation: false,
        tooltip: {
          renderMode: 'richText',
          trigger: 'item',
          backgroundColor: token('--popover'),
          borderColor: token('--border'),
          textStyle: { color: token('--popover-foreground') },
        },
        textStyle: { color: token('--foreground') },
        grid: { left: 55, right: 15, top: 15, bottom: 40 },
        xAxis: {
          type: 'category',
          data: [t('training.iqr'), t('training.current')],
          axisLabel: { color: token('--foreground') },
          axisLine: { lineStyle: { color: token('--chart-axis') } },
        },
        yAxis: {
          type: 'value',
          name: metric.unit,
          nameTextStyle: { color: token('--muted-foreground') },
          axisLabel: { color: token('--muted-foreground') },
          splitLine: { lineStyle: { color: token('--chart-grid') } },
        },
        series: [
          {
            type: 'boxplot',
            itemStyle: { color: token('--secondary'), borderColor: token('--chart-self') },
            data: [
              [
                metric.lowerQuartile,
                metric.lowerQuartile,
                metric.median,
                metric.upperQuartile,
                metric.upperQuartile,
              ],
            ],
          },
          {
            type: 'scatter',
            symbolSize: 10,
            itemStyle: { color: token('--chart-self') },
            data: metric.current == null ? [] : [[1, metric.current]],
          },
        ],
      });
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
  }, [metric, t]);
  return (
    <div
      ref={ref}
      className="w-full h-[200px]"
      role="img"
      aria-label={t('training.distributionLabel', { count: metric.count, unit: metric.unit })}
    />
  );
}
