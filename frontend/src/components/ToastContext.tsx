import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem { id: number; message: string; kind: ToastKind }
interface ToastApi { show: (message: string, kind?: ToastKind) => void }

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const show = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 4200);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((item) => {
          const Icon = item.kind === 'success' ? CheckCircle2 : item.kind === 'error' ? CircleAlert : Info;
          return (
            <div key={item.id} className={`toast toast-${item.kind}`}>
              <Icon size={19} />
              <span>{item.message}</span>
              <button aria-label="Cerrar" onClick={() => setItems((current) => current.filter((x) => x.id !== item.id))}><X size={16} /></button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast debe usarse dentro de ToastProvider.');
  return value;
}
