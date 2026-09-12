import { ArrowUpDown, CalendarDays, Eye, EyeOff, LoaderCircle, Search, X, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

export function Button({ children, className = '', variant = 'primary', loading, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; loading?: boolean }) {
  return <button className={`button button-${variant} ${className}`} disabled={props.disabled || loading} {...props}>{loading ? <LoaderCircle className="spin" size={17} /> : null}{children}</button>;
}

export function IconButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props}>{children}</button>;
}

export function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return <div className={`card ${onClick ? 'card-clickable' : ''} ${className}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? (event) => { if (event.key === 'Enter') onClick(); } : undefined}>{children}</div>;
}

export function Field({ label, hint, error, required, children }: { label: string; hint?: string; error?: string; required?: boolean; children: ReactNode }) {
  return <label className="field"><span className="field-label">{label}{required ? <b> *</b> : null}</span>{children}{hint ? <small>{hint}</small> : null}{error ? <small className="field-error">{error}</small> : null}</label>;
}

export function Input({ className = '', type, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  if (type === 'date' || type === 'datetime-local') {
    return <span className="date-input-wrap"><input ref={inputRef} className={`input ${className}`} type={type} {...props} /><button type="button" aria-label="Abrir calendario" title="Abrir calendario" onClick={(event) => { event.preventDefault(); inputRef.current?.showPicker?.(); }}><CalendarDays size={18} /></button></span>;
  }
  return <input className={`input ${className}`} type={type} {...props} />;
}

export function PasswordInput({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return <div className="password-input">
    <Input className={className} type={visible ? 'text' : 'password'} {...props} />
    <button type="button" onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'} title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
      {visible ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  </div>;
}
export function Select({ className = '', children, value, defaultValue, onChange, disabled, multiple, size, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const nativeRef = useRef<HTMLSelectElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [internalValue, setInternalValue] = useState(String(defaultValue ?? ''));
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0, maxHeight: 280 });
  const controlled = value !== undefined;
  const selectedValue = String(controlled ? value ?? '' : internalValue);
  const options = useMemo(() => {
    const collector: Array<{ value: string; label: string; disabled: boolean }> = [];
    const textOf = (content: ReactNode): string => {
      if (content == null || typeof content === 'boolean') return '';
      if (typeof content === 'string' || typeof content === 'number') return String(content);
      if (Array.isArray(content)) return content.map(textOf).join('');
      if (typeof content === 'object' && 'props' in content) return textOf((content as { props: { children?: ReactNode } }).props.children);
      return '';
    };
    const visit = (nodes: ReactNode) => {
      for (const node of Array.isArray(nodes) ? nodes : [nodes]) {
        if (Array.isArray(node)) {
          visit(node);
          continue;
        }
        if (!node || typeof node !== 'object' || !('props' in node)) continue;
        const element = node as { type?: unknown; props: { value?: unknown; disabled?: boolean; children?: ReactNode; label?: string } };
        if (element.type === 'option') collector.push({
          value: String(element.props.value ?? ''),
          label: textOf(element.props.children) || String(element.props.value ?? ''),
          disabled: Boolean(element.props.disabled),
        });
        else if (element.props.children) visit(element.props.children);
      }
    };
    visit(children);
    return collector;
  }, [children]);
  const active = options.find((option) => option.value === selectedValue) ?? options[0];
  const androidCustom = Boolean(window.SGBAndroid) && !multiple && !size;

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 10;
      const below = window.innerHeight - rect.bottom - margin;
      const above = rect.top - margin;
      const useAbove = below < 180 && above > below;
      const maxHeight = Math.max(120, Math.min(360, (useAbove ? above : below) - 6));
      setPosition({ left: Math.max(margin, Math.min(rect.left, window.innerWidth - rect.width - margin)), top: useAbove ? Math.max(margin, rect.top - Math.min(maxHeight, options.length * 48 + 12) - 6) : rect.bottom + 6, width: rect.width, maxHeight });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, options.length]);

  if (!androidCustom) return <select ref={nativeRef} className={`input ${className}`} value={value} defaultValue={defaultValue} onChange={onChange} disabled={disabled} multiple={multiple} size={size} {...props}>{children}</select>;

  const choose = (next: string) => {
    if (!controlled) setInternalValue(next);
    const select = nativeRef.current;
    if (select) {
      select.value = next;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setOpen(false);
    window.setTimeout(() => buttonRef.current?.focus(), 0);
  };

  return <>
    <select ref={nativeRef} className="sgb-select-native" aria-hidden tabIndex={-1} value={selectedValue} onChange={onChange} disabled={disabled} {...props}>{children}</select>
    <button ref={buttonRef} id={id} type="button" className={`input sgb-select-button ${className}`} disabled={disabled} aria-haspopup="listbox" aria-expanded={open} onClick={(event) => { event.preventDefault(); setOpen((current) => !current); }}>
      <span>{active?.label || 'Selecciona'}</span><span className="sgb-select-chevron" aria-hidden>⌄</span>
    </button>
    {open ? createPortal(<div className="sgb-select-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="sgb-select-menu" role="listbox" aria-labelledby={id} style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }} onMouseDown={(event) => event.stopPropagation()}>
        {options.map((option, index) => <button key={`${option.value}-${index}`} type="button" role="option" aria-selected={option.value === selectedValue} className={option.value === selectedValue ? 'selected' : ''} disabled={option.disabled} onClick={() => choose(option.value)}>{option.label}</button>)}
      </div>
    </div>, document.body) : null}
  </>;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className="input textarea" {...props} />; }

export function Modal({ title, children, onClose, footer, wide = false }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><IconButton label="Cerrar" onClick={onClose}><X size={20} /></IconButton></header><div className="modal-body">{children}</div>{footer ? <footer>{footer}</footer> : null}</section></div>;
}

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="page-header"><div><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{action ? <div>{action}</div> : null}</div>;
}

export function LoadingState({ text = 'Cargando información…' }: { text?: string }) {
  return <div className="state-panel"><LoaderCircle className="spin" size={30} /><p>{text}</p></div>;
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="state-panel empty-state"><div className="empty-icon"><Icon size={31} /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="state-panel error-state"><h3>No se pudo cargar</h3><p>{message}</p>{onRetry ? <Button variant="secondary" onClick={onRetry}>Reintentar</Button> : null}</div>;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function SearchBox({ value, onChange, placeholder = 'Buscar…' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <div className="search-box"><Search size={18} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></div>;
}

export function ListToolbar({ search, onSearch, order, onOrder, placeholder = 'Buscar…', count }: { search: string; onSearch: (value: string) => void; order: string; onOrder: (value: 'NEWEST' | 'OLDEST' | 'AZ' | 'ZA') => void; placeholder?: string; count?: number }) {
  return <div className="toolbar list-toolbar">
    <SearchBox value={search} onChange={onSearch} placeholder={placeholder} />
    <div className="list-order"><ArrowUpDown size={17} /><Select aria-label="Ordenar registros" value={order} onChange={(event) => onOrder(event.target.value as 'NEWEST' | 'OLDEST' | 'AZ' | 'ZA')}><option value="NEWEST">Más recientes</option><option value="OLDEST">Más antiguos</option><option value="AZ">Nombre A–Z</option><option value="ZA">Nombre Z–A</option></Select>{count == null ? null : <Badge tone="info">{count}</Badge>}</div>
  </div>;
}

export function CompactToolbar({ search, onSearch, placeholder = 'Buscar…', actions, count, className = '', below }: { search?: string; onSearch?: (value: string) => void; placeholder?: string; actions?: ReactNode; count?: number; className?: string; below?: ReactNode }) {
  return <div className={`compact-sticky-controls ${className}`}>
    <div className="compact-toolbar-row">
      {search !== undefined && onSearch ? <SearchBox value={search} onChange={onSearch} placeholder={placeholder} /> : null}
      {actions ? <div className="compact-toolbar-actions">{actions}</div> : null}
      {count == null ? null : <span className="compact-result-count" aria-label={`${count} elementos visibles`}><strong>{count}</strong></span>}
    </div>
    {below ? <div className="compact-toolbar-below">{below}</div> : null}
  </div>;
}

export function FloatingActionDock({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`floating-action-dock ${className}`}>{children}</div>;
}

export function ConfirmDialog({ title, message, onConfirm, onClose, loading }: { title: string; message: string; onConfirm: () => void; onClose: () => void; loading?: boolean }) {
  return <Modal title={title} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" loading={loading} onClick={onConfirm}>Confirmar</Button></>}><p>{message}</p></Modal>;
}
