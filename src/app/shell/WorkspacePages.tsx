import { Activity, useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useNavigate, type NavigateOptions } from '@tanstack/react-router';
import type { WorkspaceTab } from '../../generated/contracts';
import { useWorkspace } from '../../stores/workspace-tabs';
import { TabsContent } from '../../components/ui/tabs';
import { MatchesPage } from '../../features/matches/MatchesPage';
import { PlayerOverviewPage } from '../../features/players/PlayerOverviewPage';
import { ReviewPage } from '../../features/review/ReviewPage';
import { ProgressPage } from '../../features/progress/ProgressPage';
import { LivePage } from '../../features/live/LivePage';
import { ChampionsPage } from '../../features/champions/ChampionsPage';
import { ComparisonPage } from '../../features/comparison/ComparisonPage';
import { ChampionPlansPage } from '../../features/champion-plans/ChampionPlansPage';
import { SettingsPage } from '../../features/settings/SettingsPage';
import { WorkspacePageContext } from '../workspace-page-context';
import { readWorkspaceSearch, workspaceTabForLocation } from '../workspace-navigation';

const workspacePageComponents = {
  matches: MatchesPage,
  players: PlayerOverviewPage,
  review: ReviewPage,
  progress: ProgressPage,
  live: LivePage,
  champions: ChampionsPage,
  compare: ComparisonPage,
  notebooks: ChampionPlansPage,
  settings: SettingsPage,
};

export function WorkspacePages({
  tabs,
  activeTab,
  workspaceEpoch,
  refreshRevisions,
}: {
  tabs: WorkspaceTab[];
  activeTab: WorkspaceTab;
  workspaceEpoch?: string;
  refreshRevisions: Record<string, number>;
}) {
  const pages = tabs.some((tab) => tab.id === activeTab.id)
    ? tabs.map((tab) => (tab.id === activeTab.id ? activeTab : tab))
    : [...tabs, activeTab];
  return pages.map((tab) => (
    <WorkspacePage
      key={`${tab.kind === 'settings' ? tab.id : `${workspaceEpoch}:${tab.id}`}:${refreshRevisions[tab.id] || 0}`}
      tab={tab}
      active={tab.id === activeTab.id}
    />
  ));
}

function WorkspacePage({ tab, active }: { tab: WorkspaceTab; active: boolean }) {
  const navigate = useNavigate();
  const lifecycle = useRef({ active, mounted: true });
  useLayoutEffect(() => {
    lifecycle.current = { active, mounted: true };
    return () => {
      lifecycle.current.mounted = false;
    };
  }, [active]);
  const search = useMemo(() => readWorkspaceSearch(tab), [tab.search]);
  const navigatePage = useCallback(
    (options: NavigateOptions) => {
      if (!lifecycle.current.mounted) return Promise.resolve();
      if (lifecycle.current.active) return navigate(options);
      // Background completions may update their own tab, but never activate another page.
      if (typeof options.to === 'string' && typeof options.search === 'object') {
        const pathname =
          options.to === '/matches/$matchKey/review'
            ? `/matches/${(options.params as { matchKey: string }).matchKey}/review`
            : options.to;
        const target = workspaceTabForLocation(pathname, options.search);
        if (target.id === tab.id) {
          const workspace = useWorkspace.getState();
          workspace.setTabs(
            workspace.tabs.map((existing) => (existing.id === tab.id ? target : existing)),
          );
        }
      }
      return Promise.resolve();
    },
    [navigate, tab.id],
  );
  const context = useMemo(() => ({ search, navigate: navigatePage }), [search, navigatePage]);
  const Page = workspacePageComponents[tab.kind as keyof typeof workspacePageComponents];
  return (
    <WorkspacePageContext.Provider value={context}>
      <Activity mode={active ? 'visible' : 'hidden'}>
        <WorkspaceViewport tab={tab}>{Page && <Page />}</WorkspaceViewport>
      </Activity>
    </WorkspacePageContext.Provider>
  );
}

function WorkspaceViewport({ tab, children }: { tab: WorkspaceTab; children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const search = readWorkspaceSearch(tab);
  const scrollKey =
    tab.kind === 'champions' && search.champion ? `${tab.id}:champion:${search.champion}` : tab.id;
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    element.scrollTop = scrollPositions.current.get(scrollKey) || 0;
    return () => {
      scrollPositions.current.set(scrollKey, element.scrollTop);
    };
  }, [scrollKey]);
  return (
    <TabsContent
      ref={viewport}
      forceMount
      value={tab.id}
      id={`workspace-panel-${tab.id}`}
      aria-labelledby={`workspace-${tab.id}`}
      className="m-0 h-full min-h-0 overflow-auto scroll-pt-6"
      data-workspace-tab={tab.id}
    >
      {children}
    </TabsContent>
  );
}
