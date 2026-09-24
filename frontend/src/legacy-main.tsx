import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {AuthProvider} from './auth/AuthContext';
import {ToastProvider} from './components/ToastContext';
import {AppErrorBoundary} from './components/AppErrorBoundary';
import {AppUpdatePrompt} from './components/AppUpdatePrompt';
import {OfflineProvider} from './offline/OfflineContext';
import {AppRouter} from './routes/AppRouter';
import {ThemeProvider} from './theme/ThemeContext';

const queryClient=new QueryClient({defaultOptions:{queries:{networkMode:'always',retry:1,
  refetchOnWindowFocus:false,staleTime:30_000},mutations:{networkMode:'always',retry:0}}});

export function LegacyApp(){return <AppErrorBoundary><QueryClientProvider client={queryClient}>
  <ThemeProvider><ToastProvider><AuthProvider><OfflineProvider>
    <AppUpdatePrompt/><AppRouter/>
  </OfflineProvider></AuthProvider></ToastProvider></ThemeProvider>
</QueryClientProvider></AppErrorBoundary>;}
