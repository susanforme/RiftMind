/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TRANSPORT?: 'desktop' | 'fixture' | 'dev-harness';
  readonly VITE_DEV_TOOLS?: 'true' | 'false';
  readonly VITE_INITIAL_SCENARIO?: string;
  readonly VITE_HARNESS_TOKEN?: string;
}
