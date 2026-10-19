import type { ColorMode } from '../../generated/contracts';
export function resolveMode(preference: ColorMode, systemDark: boolean): 'light' | 'dark' {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}
export function applyTheme(themeId: string, mode: 'light' | 'dark') {
  document.documentElement.dataset.theme = themeId === 'default' ? themeId : 'default';
  document.documentElement.dataset.mode = mode;
  document.documentElement.style.colorScheme = mode;
}
