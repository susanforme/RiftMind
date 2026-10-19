import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { transport } from '../../app/runtime';
import { queryClient } from '../../app/query-client';
import type { MatchSummary } from '../../generated/contracts';

export function useMatchScoreboard(
  match: MatchSummary,
  expanded: boolean,
  epoch?: string,
  transient = false,
) {
  const row = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (!row.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(row.current);
    return () => observer.disconnect();
  }, []);
  const scoreboard = useQuery({
    queryKey: ['match-scoreboard', epoch, match.playerKey, match.matchKey, match.revision],
    queryFn: () =>
      transport.call('get_match_scoreboard', {
        playerKey: match.playerKey,
        matchKey: match.matchKey,
      }),
    enabled: !!epoch && (visible || expanded),
    staleTime: transient ? 0 : Infinity,
    gcTime: transient ? 0 : 300000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const [taskId, setTaskId] = useState<string | null>(null);
  const fetchDetails = useMutation({
    mutationFn: () =>
      transport.call('fetch_match_details', {
        playerKey: match.playerKey,
        matchKey: match.matchKey,
      }),
    onSuccess: (task) => setTaskId(task.id),
  });
  const task = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => transport.call('get_task_status', { id: taskId! }),
    enabled: !!taskId,
    refetchInterval: (query) =>
      query.state.data && ['queued', 'running'].includes(query.state.data.state) ? 800 : false,
  });
  useEffect(() => {
    if (!task.data || !['completed', 'failed', 'cancelled'].includes(task.data.state)) return;
    void queryClient.invalidateQueries({
      queryKey: ['match-scoreboard', epoch, match.playerKey, match.matchKey],
    });
  }, [task.data?.state, epoch, match.matchKey, match.playerKey]);
  return {
    row,
    scoreboard,
    fetchDetails,
    task,
    loading:
      fetchDetails.isPending ||
      (!!taskId && !task.data && !task.error) ||
      (!!task.data && ['queued', 'running'].includes(task.data.state)),
  };
}
