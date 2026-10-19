import { useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useQuery } from '@tanstack/react-query';
import { transport } from './runtime';
import { queryClient } from './query-client';
import { applyTheme, resolveMode } from './theme';
import { resolveLanguage } from '../i18n';
import i18n from '../i18n';
import { useWorkspace, defaultTab } from '../stores/workspace-tabs';
import { router } from './router';
import type { AppState } from '../generated/contracts';
export function RuntimeEffects() {
  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => transport.call('get_settings', {}),
  });
  useEffect(() => {
    let stopped = false;
    let cleanup: (() => void) | undefined;
    let last = 0;
    let runtime = '';
    let epoch = '';
    const reconcile = () => {
      void queryClient.invalidateQueries();
    };
    void transport
      .subscribe((e) => {
        if (
          stopped ||
          (runtime === e.runtimeId && epoch === e.workspaceEpoch && e.sequence <= last)
        )
          return;
        if (
          (runtime && runtime !== e.runtimeId) ||
          (epoch && epoch !== e.workspaceEpoch) ||
          e.kind === 'workspace-reset'
        ) {
          void queryClient.cancelQueries();
          for (const key of [
            'matches',
            'match-scoreboard',
            'review-data',
            'review-chart',
            'timeline',
            'review-evidence',
            'annotations',
            'goals',
            'goal-progress',
            'player-progress',
            'live',
            'player-profile',
            'player-overview',
            'favorites',
            'champion-pool',
            'comparison',
            'compare-chart',
            'compare-events',
            'compare-candidates',
            'issues',
            'notebooks',
            'notebook-review-source',
            'notebook-history',
            'notebook-link',
            'practices',
            'personal-baseline',
            'event-context',
            'preparations',
            'player-profile-icon',
            'champion-splash',
            'champion-skins',
            'game-entity-art',
          ])
            queryClient.removeQueries({ queryKey: [key] });
          useWorkspace.getState().markWorkspaceChanged();
          queryClient.removeQueries({ queryKey: ['assets'] });
          queryClient.removeQueries({ queryKey: ['task'] });
          queryClient.setQueryData(['app'], (old: AppState | undefined) =>
            old ? { ...old, workspaceEpoch: e.workspaceEpoch, runtimeId: e.runtimeId } : old,
          );
          reconcile();
          useWorkspace.getState().setDraft(null, false);
          useWorkspace.getState().setTabs([defaultTab]);
          void router.navigate(
            router.state.location.pathname === '/settings'
              ? { to: '/settings', replace: true }
              : { to: '/matches', search: {}, replace: true },
          );
        }

        if (e.sequence > last + 1) reconcile();
        last = e.sequence;
        runtime = e.runtimeId;
        epoch = e.workspaceEpoch;
        const keys: Record<string, string[]> = {
          'notebooks-changed': ['notebooks', 'notebook-history', 'notebook-link', 'practices'],
          'preparations-changed': ['preparations', 'matches', 'issues', 'goals', 'goal-progress'],
          'live-changed': ['live', 'players', 'favorites'],
          'players-changed': ['players', 'favorites'],
          'favorites-changed': ['favorites'],
          'app-state-changed': ['app'],
          'settings-changed': ['settings'],
          'connection-changed': ['connection', 'players', 'live', 'player-overview'],
          'task-progress': ['task'],
          'match-updated': [
            'matches',
            'match-scoreboard',
            'players',
            'usage',
            'champion-pool',
            'live',
            'player-overview',
          ],
          'update-changed': ['app'],
          'review-data-changed': ['review-data', 'match-scoreboard', 'matches'],
          'review-changed': [
            'review-data',
            'matches',
            'player-progress',
            'issues',
            'notebooks',
            'notebook-review-source',
            'notebook-history',
            'notebook-link',
            'practices',
            'personal-baseline',
            'event-context',
            'preparations',
            'champion-pool',
          ],
          'annotations-changed': ['annotations'],
          'goals-changed': ['goals', 'goal-progress', 'player-progress'],
          'assets-ready': [
            'assets',
            'player-profile-icon',
            'champion-splash',
            'champion-skins',
            'game-entity-art',
          ],
          'workspace-reset': ['settings', 'players', 'app', 'matches'],
        };
        for (const key of keys[e.kind] || [])
          void queryClient.invalidateQueries({ queryKey: [key] });
      })
      .then((fn) => {
        if (stopped) fn();
        else {
          cleanup = fn;
          reconcile();
        }
      })
      .catch(reconcile);
    window.addEventListener('focus', reconcile);
    return () => {
      stopped = true;
      cleanup?.();
      window.removeEventListener('focus', reconcile);
    };
  }, []);
  const languagePreference = settings?.languagePreference;
  useEffect(() => {
    if (languagePreference === undefined) return;
    const language = resolveLanguage(languagePreference, navigator.language);
    if (i18n.language !== language) void i18n.changeLanguage(language);
  }, [languagePreference]);

  const themeId = settings?.themeId;
  const colorModePreference = settings?.colorModePreference;
  useEffect(() => {
    if (themeId === undefined || colorModePreference === undefined) return;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const mode = resolveMode(colorModePreference, media.matches);
      applyTheme(themeId, mode);
      if (transport.mode === 'desktop')
        void getCurrentWindow()
          .setTheme(mode)
          .catch(() => {});
    };
    apply();
    if (colorModePreference === 'system') {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
  }, [themeId, colorModePreference]);
  return null;
}
