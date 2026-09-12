import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State { error: Error | null }

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SGB render error', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="app-error-boundary">
      <AlertTriangle size={34} />
      <h1>No se pudo mostrar esta pantalla</h1>
      <p>Los datos locales siguen guardados. Recarga la vista para recuperarla sin cerrar la aplicación.</p>
      <button type="button" onClick={() => { this.setState({ error: null }); window.location.reload(); }}><RefreshCw size={18} />Recargar pantalla</button>
      <details><summary>Detalle técnico</summary><code>{this.state.error.message}</code></details>
    </main>;
  }
}
