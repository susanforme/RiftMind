import { Alert, AlertDescription } from './ui/alert';
import { useTranslation } from 'react-i18next';
import type { AppError } from '../generated/contracts';
export function ErrorNotice({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const e = error as Partial<AppError>;
  return <Alert variant="destructive" className="notice error"><AlertDescription>{t(`errors.${e.code?.toLowerCase() || 'network_unavailable'}`)}{e.requestId && <small>{t('common.requestId')}: {e.requestId}</small>}</AlertDescription></Alert>;
}
