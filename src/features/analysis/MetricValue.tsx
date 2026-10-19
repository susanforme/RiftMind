import { useTranslation } from 'react-i18next';
import type { SampleMetric } from '../../generated/contracts';
import { numberText } from '../review/format';
export function MetricValue({ metric, ratio = false }: { metric: SampleMetric; ratio?: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      title={Object.entries(metric.excluded)
        .map(
          ([reason, count]) =>
            `${t(`scouting.${reason}`, { defaultValue: t('scouting.missing') })}: ${count}`,
        )
        .join(', ')}
    >
      {numberText(metric.value, ratio ? 'ratio' : undefined)}{' '}
      <small className="text-muted-foreground text-[12px]">
        {t('scouting.n', { count: metric.samples })}
      </small>
    </span>
  );
}
