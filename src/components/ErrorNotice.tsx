import { errorName } from '../lib/display-names';
import { Alert, AlertDescription } from './ui/alert';
import { useTranslation } from 'react-i18next';
import type { AppError } from '../generated/contracts';
export function ErrorNotice({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const e = error as Partial<AppError>;
  return (
    <Alert variant="destructive" className="notice error">
      <AlertDescription>
        {errorName(t, e.code)}
        {e.requestId && (
          <small>
            {t('common.requestId')}: {e.requestId}
          </small>
        )}
      </AlertDescription>
    </Alert>
  );
}
