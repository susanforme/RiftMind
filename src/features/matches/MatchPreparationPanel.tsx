import { ChevronRight } from 'lucide-react';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '../../components/ui/collapsible';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { transport } from '../../app/runtime';
import { queryClient } from '../../app/query-client';
import type { PreparationBatch } from '../../generated/contracts';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import {
  Table,
  TableHead,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
} from '../../components/ui/table';
import { ErrorNotice } from '../../components/ErrorNotice';
export function MatchPreparationPanel({
  epoch,
  player,
  selected,
}: {
  epoch: string;
  player: string;
  selected: string[];
}) {
  const { t } = useTranslation();
  const [preview, setPreview] = useState<PreparationBatch | null>(null);
  const [recompute, setRecompute] = useState(false);
  const batches = useQuery({
    queryKey: ['preparations', epoch],
    queryFn: () => transport.call('list_match_preparations', {}),
    refetchInterval: (query) =>
      query.state.data?.some((batch) => ['running', 'queued'].includes(batch.state)) ? 500 : false,
  });
  const inspect = useMutation({
    mutationFn: () =>
      transport.call('preview_match_preparation', {
        workspaceEpoch: epoch,
        playerKey: player,
        matchKeys: selected,
        batchId: null,
        recompute,
      }),
    onSuccess: setPreview,
  });
  const start = useMutation({
    mutationFn: () =>
      transport.call('start_match_preparation', {
        workspaceEpoch: epoch,
        playerKey: preview!.playerKey,
        matchKeys: preview!.members.map((member) => member.matchKey),
        batchId: null,
        recompute,
      }),
    onSuccess: () => {
      setPreview(null);
      void queryClient.invalidateQueries({ queryKey: ['preparations'] });
    },
  });
  const change = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) =>
      transport.call('change_match_preparation', { workspaceEpoch: epoch, id, action }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['preparations'] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('training.prepareSamples')}</CardTitle>
      </CardHeader>
      <CardContent data-ui="review-stack" className="grid grid-cols-1 gap-4 min-w-0">
        <ErrorNotice error={batches.error || inspect.error || start.error || change.error} />
        <div data-ui="actions" className="flex items-center gap-2">
          <Badge variant="outline">{selected.length}/20</Badge>
          <Button
            variant="outline"
            disabled={!selected.length || selected.length > 20 || inspect.isPending}
            onClick={() => inspect.mutate()}
          >
            {t('training.previewBatch')}
          </Button>
          <Button
            variant="outline"
            aria-pressed={recompute}
            disabled={!!preview}
            onClick={() => setRecompute(!recompute)}
          >
            {t('training.recompute')}
          </Button>
        </div>
        {preview && (
          <>
            <div data-ui="actions" className="flex items-center gap-2">
              {['existing', 'ready', 'pending_details', 'unavailable'].map((status) => (
                <Badge variant="secondary" key={status}>
                  {t(`training.preparation_${status}`)}:{' '}
                  {preview.members.filter((member) => member.report === status).length}
                </Badge>
              ))}
              <Button disabled={start.isPending} onClick={() => start.mutate()}>
                {t('training.startBatch')}
              </Button>
              <Button variant="ghost" onClick={() => setPreview(null)}>
                {t('common.cancel')}
              </Button>
            </div>
            <BatchMembers batch={preview} />
          </>
        )}
        {batches.data
          ?.filter((batch) => batch.playerKey === player)
          .map((batch) => (
            <Collapsible key={batch.id}>
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="group h-auto min-h-9 w-full justify-start gap-2 px-0 py-2 text-left text-sm font-normal whitespace-normal text-muted-foreground"
                >
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
                  />
                  {t(`training.batch_${batch.state}`)} ·{' '}
                  {new Date(batch.updatedAt).toLocaleString()} ·{' '}
                  {
                    batch.members.filter((member) =>
                      ['completed', 'existing'].includes(member.report),
                    ).length
                  }
                  /{batch.members.length}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent
                forceMount
                className="hidden min-w-0 pb-2 data-[state=open]:block"
              >
                <div data-ui="actions" className="flex items-center gap-2">
                  {['running', 'queued'].includes(batch.state) ? (
                    <Button
                      variant="outline"
                      disabled={batch.cancelRequested || change.isPending}
                      onClick={() => change.mutate({ id: batch.id, action: 'cancel' })}
                    >
                      {t('common.cancel')}
                    </Button>
                  ) : (
                    batch.state !== 'completed' && (
                      <Button
                        variant="outline"
                        disabled={change.isPending}
                        onClick={() => change.mutate({ id: batch.id, action: 'resume' })}
                      >
                        {t('training.resumeBatch')}
                      </Button>
                    )
                  )}
                </div>
                <BatchMembers batch={batch} />
              </CollapsibleContent>
            </Collapsible>
          ))}
      </CardContent>
    </Card>
  );
}
function BatchMembers({ batch }: { batch: PreparationBatch }) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('review.match')}</TableHead>
          <TableHead>{t('training.details')}</TableHead>
          <TableHead>{t('training.report')}</TableHead>
          <TableHead>{t('training.result')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {batch.members.map((member) => (
          <TableRow key={member.matchKey}>
            <TableCell>{member.matchKey}</TableCell>
            <TableCell>{t(`training.preparation_${member.details}`)}</TableCell>
            <TableCell>{t(`training.preparation_${member.report}`)}</TableCell>
            <TableCell>
              {member.error ? <ErrorNotice error={member.error} /> : member.reportId ? '✓' : '—'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
