import { useTranslation } from 'react-i18next';
import type { AppError } from '../generated/contracts';
export function ErrorNotice({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const e = error as Partial<AppError>;
  return <div role="alert" className="notice error">{t(`errors.${e.code || 'network_unavailable'}`)}{e.requestId && <small>{t('common.requestId')}: {e.requestId}</small>}</div>;
}
