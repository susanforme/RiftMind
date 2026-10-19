import {
  createRouter,
  createRootRoute,
  createRoute,
  createHashHistory,
  redirect,
} from '@tanstack/react-router';
import { AppShell } from './shell/AppShell';
import { MatchesPage } from '../features/matches/MatchesPage';
import { ReviewPage } from '../features/review/ReviewPage';
import { ProgressPage } from '../features/progress/ProgressPage';
import { LivePage } from '../features/live/LivePage';
import { ChampionsPage } from '../features/champions/ChampionsPage';
import { ComparisonPage } from '../features/comparison/ComparisonPage';
import { ChampionPlansPage } from '../features/champion-plans/ChampionPlansPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { PlayerOverviewPage } from '../features/players/PlayerOverviewPage';
export interface Search {
  tab?: string;
  entry?: string;
  player?: string;
  queue?: number;
  queues?: number[];
  championSort?: string;
  championCursor?: number;
  champion?: number;
  from?: string;
  to?: string;
  cursor?: string;
  report?: string;
  evidence?: string;
  at?: number;
  match?: string;
  position?: string;
  patch?: string;
  left?: string;
  right?: string;
  leftPlayer?: string;
  rightPlayer?: string;
  leftReport?: string;
  rightReport?: string;
  leftRevision?: number;
  rightRevision?: number;
}
export function validateSearch(value: Record<string, unknown>): Search {
  const result: Search = {};
  for (const field of [
    'tab',
    'entry',
    'player',
    'report',
    'evidence',
    'match',
    'left',
    'right',
    'leftPlayer',
    'rightPlayer',
    'leftReport',
    'rightReport',
  ] as const)
    if (typeof value[field] === 'string' && /^[\w:.-]{1,256}$/.test(value[field]))
      result[field] = value[field];
  for (const field of ['queue', 'champion'] as const) {
    const n = Number(value[field]);
    if (Number.isInteger(n) && n > 0 && n < 1_000_000) result[field] = n;
  }
  if (Array.isArray(value.queues) && value.queues.length <= 32) {
    const queues = value.queues.map(Number);
    if (queues.every((queue) => Number.isInteger(queue) && queue > 0 && queue < 1_000_000))
      result.queues = [...new Set(queues)].sort((left, right) => left - right);
  }
  if (
    typeof value.championSort === 'string' &&
    ['games', 'win_rate', 'kda', 'cs_per_min', 'damage_share'].includes(value.championSort)
  )
    result.championSort = value.championSort;
  if (
    Number.isInteger(value.championCursor) &&
    Number(value.championCursor) >= 0 &&
    Number(value.championCursor) <= 10000
  )
    result.championCursor = Number(value.championCursor);
  for (const field of ['from', 'to'] as const)
    if (
      typeof value[field] === 'string' &&
      /^\d{4}-\d\d-\d\d$/.test(value[field]) &&
      !Number.isNaN(Date.parse(value[field]))
    )
      result[field] = value[field];
  if (
    typeof value.position === 'string' &&
    ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'UNKNOWN'].includes(value.position)
  )
    result.position = value.position;
  if (typeof value.patch === 'string' && /^\d+\.\d+$/.test(value.patch)) result.patch = value.patch;
  for (const field of ['leftRevision', 'rightRevision'] as const) {
    const n = Number(value[field]);
    if (Number.isInteger(n) && value[field] != null && n >= 0 && n < 1_000_000) result[field] = n;
  }
  if (typeof value.cursor === 'string' && value.cursor.length <= 2048) result.cursor = value.cursor;
  if (result.from && result.to && result.from > result.to) {
    delete result.from;
    delete result.to;
  }
  if (Number.isInteger(value.at) && Number(value.at) >= 0 && Number(value.at) <= 43_260_000)
    result.at = Number(value.at);
  return result;
}
const root = createRootRoute({ component: AppShell });
const index = createRoute({
  getParentRoute: () => root,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/matches' });
  },
});
export const matchesRoute = createRoute({
  getParentRoute: () => root,
  path: '/matches',
  validateSearch,
  component: MatchesPage,
});
export const playerRoute = createRoute({
  getParentRoute: () => root,
  path: '/players',
  validateSearch,
  component: PlayerOverviewPage,
});
export const reviewRoute = createRoute({
  getParentRoute: () => root,
  path: '/matches/$matchKey/review',
  validateSearch,
  component: ReviewPage,
});
export const progressRoute = createRoute({
  getParentRoute: () => root,
  path: '/progress',
  validateSearch,
  component: ProgressPage,
});
export const liveRoute = createRoute({
  getParentRoute: () => root,
  path: '/live',
  validateSearch,
  component: LivePage,
});
export const championsRoute = createRoute({
  getParentRoute: () => root,
  path: '/champions',
  validateSearch,
  component: ChampionsPage,
});
export const compareRoute = createRoute({
  getParentRoute: () => root,
  path: '/compare',
  validateSearch,
  component: ComparisonPage,
});
export const notebookRoute = createRoute({
  getParentRoute: () => root,
  path: '/notebooks',
  validateSearch,
  component: ChampionPlansPage,
});
const settings = createRoute({
  getParentRoute: () => root,
  path: '/settings',
  component: SettingsPage,
});
export const router = createRouter({
  routeTree: root.addChildren([
    index,
    matchesRoute,
    playerRoute,
    settings,
    reviewRoute,
    progressRoute,
    liveRoute,
    championsRoute,
    compareRoute,
    notebookRoute,
  ]),
  history: createHashHistory(),
  defaultPreload: 'intent',
});
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
