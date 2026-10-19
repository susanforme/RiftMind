import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import commonZh from './locales/zh-CN/common.json';
import settingsZh from './locales/zh-CN/settings.json';
import matchesZh from './locales/zh-CN/matches.json';
import errorsZh from './locales/zh-CN/errors.json';
import connectionZh from './locales/zh-CN/connection.json';
import commonEn from './locales/en-US/common.json';
import settingsEn from './locales/en-US/settings.json';
import matchesEn from './locales/en-US/matches.json';
import errorsEn from './locales/en-US/errors.json';
import connectionEn from './locales/en-US/connection.json';
export function resolveLanguage(preference: string, system?: string) { return preference === 'system' ? (system ? (system.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US') : 'zh-CN') : (preference === 'en-US' ? 'en-US' : 'zh-CN'); }
// No detector or localStorage: Rust settings are the only preference authority.
void i18n.use(initReactI18next).init({ resources: { 'zh-CN': { translation: { common: commonZh, settings: settingsZh, matches: matchesZh, errors: errorsZh, connection: connectionZh } }, 'en-US': { translation: { common: commonEn, settings: settingsEn, matches: matchesEn, errors: errorsEn, connection: connectionEn } } }, lng: resolveLanguage('system', navigator.language), fallbackLng: 'zh-CN', interpolation: { escapeValue: false } });
export default i18n;
