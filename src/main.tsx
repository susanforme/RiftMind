import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './app/router';
import { queryClient } from './app/query-client';
import { setTransport } from './app/runtime';
import { createTransport } from './lib/transport';
import './i18n';
import './styles/globals.css';
async function start() {
  setTransport(await createTransport());
  ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></React.StrictMode>);
}
void start();
