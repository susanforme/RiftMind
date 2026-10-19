import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { Button } from './button';
import { useTranslation } from 'react-i18next';
export function ConfirmDialog({ open, title, description, onConfirm, onClose }: { open: boolean; title: string; description: string; onConfirm: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  return <DialogPrimitive.Root open={open} onOpenChange={value => { if (!value) onClose(); }}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="dialog-overlay" /><DialogPrimitive.Content className="dialog-content"><DialogPrimitive.Title>{title}</DialogPrimitive.Title><DialogPrimitive.Description>{description}</DialogPrimitive.Description><div className="actions"><Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button variant="destructive" onClick={onConfirm}>{t('common.confirm')}</Button></div></DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root>;
}
