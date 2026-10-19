import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { init, use as registerCharts, type ECharts } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { ChartData } from '../../generated/contracts';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { matchTime, numberText } from './format';
registerCharts([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
export default function ReviewChart({ data, metric, onSelect }: { data: ChartData; metric: 'gold' | 'cs'; onSelect: (ms: number) => void }) {
  const ref = useRef<HTMLDivElement>(null); const instance = useRef<ECharts | null>(null); const [failed, setFailed] = useState(false); const { t, i18n } = useTranslation();
  useEffect(() => {
    if (!ref.current) return;
    let observer: ResizeObserver | undefined; let themeObserver: MutationObserver | undefined;
    try {
      const chart = init(ref.current); instance.current = chart;
      const draw = () => { try {
        const styles = getComputedStyle(ref.current!); const color = (token: string) => styles.getPropertyValue(token).trim();
        chart.setOption({ animation: false, color: [color('--primary'), color('--muted-foreground')], grid: { left: 55, right: 20, top: 42, bottom: 30 }, legend: { textStyle: { color: color('--foreground') } }, textStyle: { color: color('--foreground') }, tooltip: { trigger: 'axis', renderMode: 'richText', valueFormatter: (value: unknown) => typeof value === 'number' ? numberText(value) : '—' }, xAxis: { type: 'value', axisLabel: { formatter: matchTime }, min: 0 }, yAxis: { type: 'value', splitLine: { lineStyle: { color: color('--border') } } }, series: [{ name: t('review.personal'), type: 'line', showSymbol: false, connectNulls: false, data: data.points.map(p => [p.timestampMs, p[metric]]) }, { name: t('review.opponent'), type: 'line', showSymbol: false, connectNulls: false, lineStyle: { type: 'dashed' }, data: data.points.map(p => [p.timestampMs, metric === 'gold' ? p.opponentGold : p.opponentCs]) }] }, true);
      } catch { setFailed(true); } };
      draw(); chart.on('click', event => { const point = event.data as [number, number] | undefined; if (point) onSelect(point[0]); });
      observer = new ResizeObserver(() => { try { chart.resize(); } catch { setFailed(true); } }); observer.observe(ref.current);
      themeObserver = new MutationObserver(draw); themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
    } catch { setFailed(true); }
    return () => { observer?.disconnect(); themeObserver?.disconnect(); instance.current?.dispose(); instance.current = null; };
  }, [data, metric, i18n.language, t, onSelect]);
  return failed ? <Alert><AlertDescription>{t('review.chartFailed')}</AlertDescription></Alert> : <div className="review-chart" ref={ref} role="img" aria-label={t(`review.${metric}Chart`)} />;
}
