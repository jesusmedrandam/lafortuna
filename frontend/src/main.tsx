import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './auth/AuthContext';
import { ToastProvider } from './components/ToastContext';
import { AppRouter } from './routes/AppRouter';
import './styles/global.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 }, mutations: { retry: 0 } } });

createRoot(document.getElementById('root')!).render(<StrictMode><QueryClientProvider client={queryClient}><ToastProvider><AuthProvider><AppRouter /></AuthProvider></ToastProvider></QueryClientProvider></StrictMode>);
