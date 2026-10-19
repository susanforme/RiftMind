import { create } from 'zustand';
import type { NotebookContent, NotebookEntry, NotebookKind } from '../../generated/contracts';
export interface NotebookDraft {
  epoch: string;
  entry: NotebookEntry | null;
  content: NotebookContent;
}
interface NotebookDrafts {
  drafts: Record<string, NotebookDraft>;
  setDraft: (key: string, draft: NotebookDraft | null) => void;
}
export const useNotebookDrafts = create<NotebookDrafts>((set) => ({
  drafts: {},
  setDraft: (key, draft) =>
    set((state) => {
      const drafts = { ...state.drafts };
      if (draft) drafts[key] = draft;
      else delete drafts[key];
      return { drafts };
    }),
}));
export function blankNotebook(championId: number, kind: NotebookKind): NotebookContent {
  return {
    championId,
    kind,
    title: '',
    text: '',
    pinned: false,
    opponentId: null,
    position: null,
    tags: [],
    steps: [],
    groups: kind === 'build' ? [{ name: 'Core', items: [] }] : [],
    mapId: kind === 'build' ? 11 : null,
    resourceVersion: kind === 'build' ? '16.20.1' : null,
    confirmedPatch: null,
    links: [],
    sources: [],
    skillOrder: null,
  };
}
export function downloadJson(json: string, filename: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
