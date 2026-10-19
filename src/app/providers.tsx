import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { transport } from './runtime';
import { queryClient } from './query-client';
import { applyTheme, resolveMode } from './theme';
import { resolveLanguage } from '../i18n';
import i18n from '../i18n';
export function RuntimeEffects() {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => transport.call('get_settings', {}) });
  useEffect(() => {
    let stopped = false; let cleanup: (() => void) | undefined; let last = 0; let runtime = ''; let epoch = '';
    const reconcile = () => { void queryClient.invalidateQueries(); };
    void transport.subscribe(e => {
      if (stopped) return;
      if ((runtime && runtime !== e.runtimeId) || (epoch && epoch !== e.workspaceEpoch) || e.kind === 'workspace-reset') { queryClient.clear(); }
      else if (e.sequence <= last) return;
      if (e.sequence > last + 1) reconcile();
      last = e.sequence; runtime = e.runtimeId; epoch = e.workspaceEpoch;
      const keys: Record<string, string[]> = { 'settings-changed': ['settings'], 'connection-changed': ['connection', 'players'], 'task-progress': ['task'], 'match-updated': ['matches', 'players', 'usage'], 'assets-ready': ['assets'], 'workspace-reset': ['settings', 'players', 'app', 'matches'] };
      for (const key of keys[e.kind] || []) void queryClient.invalidateQueries({ queryKey: [key] });
    }).then(fn => { if (stopped) fn(); else { cleanup = fn; reconcile(); } }).catch(reconcile);
    window.addEventListener('focus', reconcile);
    return () => { stopped = true; cleanup?.(); window.removeEventListener('focus', reconcile); };
  }, []);
  useEffect(() => {
    if (!settings) return;
    void i18n.changeLanguage(resolveLanguage(settings.languagePreference, navigator.language));
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyTheme(settings.themeId, resolveMode(settings.colorModePreference, media.matches));
    apply();
    if (settings.colorModePreference === 'system') { media.addEventListener('change', apply); return () => media.removeEventListener('change', apply); }
  }, [settings]);
  return null;
}
