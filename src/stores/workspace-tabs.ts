import { create } from 'zustand';
import type { Settings, WorkspaceTab } from '../generated/contracts';
export const defaultTab: WorkspaceTab = { id: 'matches', kind: 'matches', playerKey: null, search: '{}' };
interface Workspace {
  tabs: WorkspaceTab[];
  draft: Settings | null;
  dirty: boolean;
  scroll: Record<string, number>;
  setDraft: (draft: Settings | null, dirty?: boolean) => void;
  setTabs: (tabs: WorkspaceTab[]) => void;
  open: (tab: WorkspaceTab) => void;
  reorder: (from: string, to: string) => void;
  rememberScroll: (id: string, top: number) => void;
}
export const useWorkspace = create<Workspace>(set => ({
  tabs: [defaultTab], draft: null, dirty: false, scroll: {},
  setDraft: (draft, dirty = true) => set({ draft, dirty }),
  setTabs: tabs => set({ tabs: tabs.length ? tabs : [defaultTab] }),
  open: tab => set(s => ({ tabs: s.tabs.some(t => t.id === tab.id) ? s.tabs : [...s.tabs, tab] })),
  reorder: (from, to) => set(s => { const tabs = [...s.tabs]; const a = tabs.findIndex(t => t.id === from); const b = tabs.findIndex(t => t.id === to); if (a < 0 || b < 0) return s; tabs.splice(b, 0, tabs.splice(a, 1)[0]); return { tabs }; }),
  rememberScroll: (id, top) => set(s => ({ scroll: { ...s.scroll, [id]: top } })),
}));
