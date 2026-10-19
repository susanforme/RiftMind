import { createContext, useCallback, useContext } from 'react';
import { useNavigate, type NavigateOptions } from '@tanstack/react-router';
import type { Search } from './router';

export interface WorkspacePageState {
  search: Search;
  navigate: (options: NavigateOptions) => Promise<void>;
}

export const WorkspacePageContext = createContext<WorkspacePageState | null>(null);

export function useWorkspaceSearch(fallback: Search | undefined): Search {
  return useContext(WorkspacePageContext)?.search ?? fallback ?? {};
}

export function useWorkspaceMatchKey(fallback: string | undefined): string {
  return useContext(WorkspacePageContext)?.search.match ?? fallback ?? '';
}

export function useWorkspaceNavigate(): ReturnType<typeof useNavigate> {
  const navigate = useNavigate();
  const navigatePage = useContext(WorkspacePageContext)?.navigate;
  return useCallback(
    (options: NavigateOptions) => (navigatePage ? navigatePage(options) : navigate(options)),
    [navigate, navigatePage],
  ) as ReturnType<typeof useNavigate>;
}
