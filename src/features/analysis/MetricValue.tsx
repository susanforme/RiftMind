import { useTranslation } from 'react-i18next';
import type { SampleMetric } from '../../generated/contracts';
import { numberText } from '../review/format';
export function MetricValue({
  metric,
  ratio = false,
  showSamples = true,
}: {
  metric: SampleMetric;
  ratio?: boolean;
  showSamples?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <span
      className="inline-flex flex-wrap items-baseline gap-x-1.5 tabular-nums"
      title={Object.entries(metric.excluded)
        .map(
          ([reason, count]) =>
            `${t(`scouting.${reason}`, { defaultValue: t('scouting.missing') })}: ${count}`,
        )
        .join(', ')}
    >
      {numberText(metric.value, ratio ? 'ratio' : undefined)}{' '}
      {showSamples && (
        <small className="text-muted-foreground text-xs font-normal">
          {t('scouting.n', { count: metric.samples })}
        </small>
      )}
    </span>
  );
}
