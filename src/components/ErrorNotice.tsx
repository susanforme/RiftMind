import { errorName } from '../lib/display-names';
import { Alert, AlertDescription } from './ui/alert';
import { useTranslation } from 'react-i18next';
import type { AppError } from '../generated/contracts';
export function ErrorNotice({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (!error) return null;
  const e = error as Partial<AppError>;
  return (
    <Alert
      variant="destructive"
      data-error="true"
      className="rounded-[7px] bg-card text-muted-foreground py-3 px-3.5 text-[12px] my-3.5 mx-0 data-[error=true]:bg-(--loss-bg) data-[error=true]:text-destructive data-[error=true]:border-destructive [&[data-error=true]_small]:block [&[data-error=true]_small]:text-inherit [&[data-error=true]_small]:wrap-anywhere [&[data-error=true]_small]:mt-1"
    >
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
