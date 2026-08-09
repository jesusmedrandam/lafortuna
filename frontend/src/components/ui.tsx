import { ArrowUpDown, CalendarDays, LoaderCircle, Search, X, type LucideIcon } from 'lucide-react';
import { useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

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
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) { return <select className="input" {...props} />; }
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

export function ConfirmDialog({ title, message, onConfirm, onClose, loading }: { title: string; message: string; onConfirm: () => void; onClose: () => void; loading?: boolean }) {
  return <Modal title={title} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="danger" loading={loading} onClick={onConfirm}>Confirmar</Button></>}><p>{message}</p></Modal>;
}
