import { createRouter, createRootRoute, createRoute, createHashHistory, redirect } from '@tanstack/react-router';
import { AppShell } from './shell/AppShell';
import { MatchesPage } from '../features/matches/MatchesPage';
import { ReviewPage } from '../features/review/ReviewPage';
import { ProgressPage } from '../features/progress/ProgressPage';
import { SettingsPage } from '../features/settings/SettingsPage';
export interface Search { tab?: string; player?: string; queue?: number; champion?: number; from?: string; to?: string; cursor?: string; report?: string; evidence?: string; at?: number; match?: string }
export function validateSearch(value: Record<string, unknown>): Search {
  const result: Search = {};
  for (const field of ['tab', 'player', 'report', 'evidence', 'match'] as const) if (typeof value[field] === 'string' && /^[\w:.-]{1,256}$/.test(value[field])) result[field] = value[field];
  for (const field of ['queue', 'champion'] as const) { const n = Number(value[field]); if (Number.isInteger(n) && n > 0 && n < 1_000_000) result[field] = n; }
  for (const field of ['from', 'to'] as const) if (typeof value[field] === 'string' && /^\d{4}-\d\d-\d\d$/.test(value[field]) && !Number.isNaN(Date.parse(value[field]))) result[field] = value[field];
  if (typeof value.cursor === 'string' && value.cursor.length <= 2048) result.cursor = value.cursor;
  if (result.from && result.to && result.from > result.to) { delete result.from; delete result.to; }
  if (Number.isInteger(value.at) && Number(value.at) >= 0 && Number(value.at) <= 43_260_000) result.at = Number(value.at);
  return result;
}
export const restoreTabOnBoot = !window.location.hash || window.location.hash === '#/';
const root = createRootRoute({ component: AppShell });
const index = createRoute({ getParentRoute: () => root, path: '/', beforeLoad: () => { throw redirect({ to: '/matches' }); } });
export const matchesRoute = createRoute({ getParentRoute: () => root, path: '/matches', validateSearch, component: MatchesPage });
export const reviewRoute = createRoute({ getParentRoute: () => root, path: '/matches/$matchKey/review', validateSearch, component: ReviewPage });
export const progressRoute = createRoute({ getParentRoute: () => root, path: '/progress', validateSearch, component: ProgressPage });
const settings = createRoute({ getParentRoute: () => root, path: '/settings', component: SettingsPage });
export const router = createRouter({ routeTree: root.addChildren([index, matchesRoute, settings, reviewRoute, progressRoute]), history: createHashHistory(), defaultPreload: 'intent' });
declare module '@tanstack/react-router' { interface Register { router: typeof router } }
