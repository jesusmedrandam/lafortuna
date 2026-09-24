import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from './theme/ThemeContext';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import './sgb-v2/styles.css';
import './sgb-v2/shell.css';
import './styles/global.css';
import './styles/device.css';
import './styles/radical-ui.css';
import './styles/restored-ui.css';
import './styles/settings-hub.css';
import './styles/patch-1.2.8.35.css';
import './sgb-v2/v2.css';

const root=createRoot(document.getElementById('root')!);
if (import.meta.env.VITE_SGB_V2 !== 'false') {
  void import('./sgb-v2/V2App').then(({V2App})=>root.render(
    <StrictMode><AppErrorBoundary><ThemeProvider><V2App/></ThemeProvider></AppErrorBoundary></StrictMode>,
  ));
} else {
  void import('./legacy-main').then(({LegacyApp})=>root.render(<StrictMode><LegacyApp/></StrictMode>));
}
