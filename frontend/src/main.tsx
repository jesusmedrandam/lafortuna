import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './auth/AuthContext';
import { ToastProvider } from './components/ToastContext';
import { AppRouter } from './routes/AppRouter';
import { ThemeProvider } from './theme/ThemeContext';
import { OfflineProvider } from './offline/OfflineContext';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { AppUpdatePrompt } from './components/AppUpdatePrompt';
import './styles/global.css';
import './styles/device.css';
import './styles/radical-ui.css';
import './styles/restored-ui.css';
import './styles/settings-hub.css';
import './styles/patch-1.2.8.35.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { networkMode: 'always', retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 }, mutations: { networkMode: 'always', retry: 0 } } });

createRoot(document.getElementById('root')!).render(<StrictMode><AppErrorBoundary><QueryClientProvider client={queryClient}><ThemeProvider><ToastProvider><AuthProvider><OfflineProvider><AppUpdatePrompt/><AppRouter /></OfflineProvider></AuthProvider></ToastProvider></ThemeProvider></QueryClientProvider></AppErrorBoundary></StrictMode>);
