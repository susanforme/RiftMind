import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ResourceKind } from '../generated/contracts';
import { Button } from './ui/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card';
import { Skeleton } from './ui/skeleton';
import { GameEntityDescription } from './GameEntityDescription';
import { GameEntityIcon } from './GameEntityIcon';
import { useGameEntityAsset } from './useGameEntityAsset';

export function GameEntityDetails({
  kind,
  id,
  version,
  label,
  className,
  interactive = true,
}: {
  kind: Extract<ResourceKind, 'item' | 'spell' | 'rune'>;
  id: number | null | undefined;
  version: string;
  label: string;
  className?: string;
  interactive?: boolean;
}) {
  const { t } = useTranslation();
  const asset = useGameEntityAsset(kind, id, version);
  const details = asset.data?.[0];
  const name = details?.name || label;
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const contentId = useId();
  const titleId = useId();
  const descriptionId = useId();
  function closeDetails() {
    setPinned(false);
    setOpen(false);
  }
  const icon = (
    <GameEntityIcon
      kind={kind}
      id={id}
      version={version}
      label={name}
      className={className}
      showTitle={!interactive}
    />
  );
  if (!id || !interactive) return icon;

  return (
    <HoverCard
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen || !pinned) setOpen(nextOpen);
      }}
      openDelay={200}
      closeDelay={150}
    >
      <HoverCardTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto min-h-6 min-w-6 shrink-0 rounded-sm p-0 hover:bg-transparent"
          aria-label={name}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? contentId : undefined}
          onFocus={() => setOpen(true)}
          onClick={() => {
            setPinned(!pinned);
            setOpen(!pinned);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' || event.key === 'Tab') closeDetails();
          }}
        >
          {icon}
        </Button>
      </HoverCardTrigger>
      <HoverCardContent
        id={contentId}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={12}
        onEscapeKeyDown={closeDetails}
        onPointerDownOutside={closeDetails}
        className="w-80 max-w-[calc(100vw-1.5rem)] max-h-[var(--radix-hover-card-content-available-height)] overflow-y-auto p-4 motion-reduce:animate-none"
      >
        <div className="mb-3 flex items-center gap-3">
          <GameEntityIcon
            kind={kind}
            id={id}
            version={version}
            label={name}
            className="size-10 rounded-md"
            showTitle={false}
          />
          <div className="min-w-0">
            <div id={titleId} className="text-sm font-semibold break-words">
              {name}
            </div>
            <dl className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              {details?.price != null && (
                <div className="flex gap-1">
                  <dt>{t('matches.itemPrice')}</dt>
                  <dd className="tabular-nums text-foreground">{details.price}</dd>
                </div>
              )}
              {details?.cooldown != null && (
                <div className="flex gap-1">
                  <dt>{t('matches.spellCooldown')}</dt>
                  <dd className="tabular-nums text-foreground">
                    {t('matches.cooldownSeconds', { seconds: details.cooldown })}
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </div>
        <div id={descriptionId}>
          {asset.isPending ? (
            <Skeleton className="h-16 w-full" aria-label={t('common.loading')} />
          ) : details?.description ? (
            <GameEntityDescription description={details.description} />
          ) : (
            <p className="text-sm text-muted-foreground">{t('matches.entityDetailsUnavailable')}</p>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
}
