import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Maximize2, Minimize2, Search, X } from 'lucide-react';
import { IconButton } from '../../components/ui';

export interface ProductionChartPoint { x: number; y: number; date: string; detail: string }
export interface ProductionChartSeries { id: string; label: string; points: ProductionChartPoint[] }

interface ProductionChartProps {
  series: ProductionChartSeries[];
  xMode: 'date' | 'days';
  tankByDate?: Record<string, number>;
  onDateSelect?: (date: string) => void;
  filterOptions?: Array<{ id: string; label: string }>;
  filterValue?: string;
  onFilterChange?: (id: string) => void;
}

const width = 760;
const height = 420;
const inset = { left: 55, right: 20, top: 20, bottom: 43 };
const dayMs = 86_400_000;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const colors = ['#20d780', '#d629c5', '#f0d91a', '#2ea7df', '#ff765f', '#8b5cf6', '#00c7b7', '#ff9f1c', '#ef476f', '#57cc35', '#3f51e8', '#a86add', '#00a896', '#f97316', '#b7d80b', '#db3a77', '#5b8def', '#946b49', '#00b4d8', '#e63946'];
const colorAt = (index: number) => colors[index] ?? `hsl(${Math.round((index * 137.508 + 17) % 360)} 78% 52%)`;
const dateKey = (value: number) => new Date(value).toISOString().slice(0, 10);

export function ProductionAnimalFilter({value,options,onChange}:{value:string;options:Array<{id:string;label:string}>;onChange:(id:string)=>void}){
  const [open,setOpen]=useState(false);const [search,setSearch]=useState('');
  const selected=options.find((item)=>item.id===value)?.label??'Todos los animales';
  const visible=options.filter((item)=>!search.trim()||item.label.toLocaleLowerCase('es').includes(search.trim().toLocaleLowerCase('es')));
  const choose=(id:string)=>{onChange(id);setOpen(false);setSearch('');};
  return <div className="production-chart-filter-menu"><button type="button" onClick={()=>setOpen((current)=>!current)}><span><small>Animal</small><strong>{selected}</strong></span><ChevronDown size={17}/></button>{open?<div className="production-chart-filter-popover"><label><Search size={15}/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Toca aquí para buscar…"/></label><div><button type="button" className={!value?'selected':''} onClick={()=>choose('')}>Todos los animales{!value?<Check size={15}/>:null}</button>{visible.map((item)=><button type="button" className={item.id===value?'selected':''} key={item.id} onClick={()=>choose(item.id)}>{item.label}{item.id===value?<Check size={15}/>:null}</button>)}</div></div>:null}</div>;
}

function pickTicks(values: number[], maximum = 5) {
  if (values.length <= maximum) return values;
  const selected = new Set<number>();
  for (let index = 0; index < maximum; index += 1) selected.add(values[Math.round(index * (values.length - 1) / (maximum - 1))]);
  return [...selected];
}

export function ProductionChart({ series, xMode, tankByDate = {}, onDateSelect, filterOptions = [], filterValue = '', onFilterChange }: ProductionChartProps) {
  const [zoomX, setZoomX] = useState(1);
  const [zoomY, setZoomY] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [cursor, setCursor] = useState<number | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [expandedStageSize, setExpandedStageSize] = useState({ width: 0, height: 0 });
  const expandedStageRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ spanX: number; spanY: number; centerX: number; centerY: number; zoomX: number; zoomY: number; panX: number; panY: number } | null>(null);
  const lastTap = useRef(0);
  const clipId = `production-clip-${useId().replace(/:/g, '')}`;
  const chartSeries = series;
  const seriesColors = useMemo(() => new Map(series.map((item, index) => [item.id, colorAt(index)])), [series]);
  const points = useMemo(() => chartSeries.flatMap((item) => item.points), [chartSeries]);
  const allX = useMemo(() => [...new Set(points.map((point) => point.x))].sort((a, b) => a - b), [points]);
  const firstX = allX[0] ?? 0;
  const lastX = allX.at(-1) ?? firstX + (xMode === 'date' ? dayMs : 1);
  const dataSpanX = Math.max(xMode === 'date' ? dayMs : 1, lastX - firstX);
  const edgePadding = Math.max(dataSpanX * .045, xMode === 'date' ? dayMs * .12 : .15);
  const fullMinX = firstX - edgePadding;
  const fullMaxX = lastX + edgePadding;
  const fullSpanX = Math.max(1, fullMaxX - fullMinX);
  const visibleSpanX = fullSpanX / zoomX;
  const visibleMinX = fullMinX + (fullSpanX - visibleSpanX) * panX;
  const visibleMaxX = visibleMinX + visibleSpanX;
  const fullMaxY = Math.max(1, ...points.map((point) => point.y)) * 1.12;
  const visibleSpanY = fullMaxY / zoomY;
  const visibleMinY = (fullMaxY - visibleSpanY) * panY;
  const visibleX = allX.filter((value) => value >= visibleMinX && value <= visibleMaxX);
  const chartWidth = fullscreen && expandedStageSize.width > 0 ? expandedStageSize.width : width;
  const chartHeight = fullscreen && expandedStageSize.height > 0 ? expandedStageSize.height : height;
  const plotWidth = chartWidth - inset.left - inset.right;
  const plotHeight = chartHeight - inset.top - inset.bottom;
  const mapX = (x: number) => inset.left + ((x - visibleMinX) / visibleSpanX) * plotWidth;
  const mapY = (y: number) => inset.top + plotHeight - ((y - visibleMinY) / visibleSpanY) * plotHeight;
  const activeItems = cursor == null ? [] : chartSeries.flatMap((item) => item.points.filter((point) => point.x === cursor).map((point) => ({ series: item, point, color: seriesColors.get(item.id) ?? colorAt(0) }))).sort((a, b) => b.point.y - a.point.y);
  const listedItems = cursor == null
    ? chartSeries.map((item) => ({ series: item, total: item.points.reduce((sum, point) => sum + point.y, 0), color: seriesColors.get(item.id) ?? colorAt(0) })).sort((a, b) => b.total - a.total)
    : activeItems.map((item) => ({ series: item.series, total: item.point.y, color: item.color }));
  const productionTotal = listedItems.reduce((sum, item) => sum + item.total, 0);
  const tankTotal = useMemo(() => {
    if (cursor != null && xMode === 'date') return Number(tankByDate[dateKey(cursor)] ?? 0);
    return Object.values(tankByDate).reduce((sum, value) => sum + Number(value || 0), 0);
  }, [cursor, tankByDate, xMode]);
  const ticks = pickTicks(visibleX);

  useEffect(() => {
    setCursor((current) => current != null && allX.includes(current) ? current : null);
    setSelectedSeries(null);
    setZoomX(1);
    setZoomY(1);
    setPanX(0);
    setPanY(0);
  }, [allX]);

  useEffect(() => {
    const revealSelected = () => {
      if (!selectedSeries) return;
      document.querySelectorAll<HTMLElement>('[data-production-series-id]').forEach((element) => {
        if (element.dataset.productionSeriesId !== selectedSeries) return;
        const strip = element.parentElement;
        if (!strip) return;
        strip.scrollTo({ left: Math.max(0, element.offsetLeft - (strip.clientWidth - element.clientWidth) / 2), behavior: 'smooth' });
      });
    };
    const frame = window.requestAnimationFrame(revealSelected);
    return () => window.cancelAnimationFrame(frame);
  }, [cursor, fullscreen, listedItems, selectedSeries]);

  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.SGBAndroid?.setChartFullscreen?.(true);
    return () => {
      document.body.style.overflow = previous;
      window.SGBAndroid?.setChartFullscreen?.(false);
    };
  }, [fullscreen]);

  useEffect(() => {
    if (!fullscreen) {
      setExpandedStageSize({ width: 0, height: 0 });
      return;
    }
    let frame = 0;
    const measure = () => {
      const rect = expandedStageRef.current?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) setExpandedStageSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    frame = window.requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    if (expandedStageRef.current) observer?.observe(expandedStageRef.current);
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [fullscreen]);

  const formatX = (value: number) => xMode === 'days'
    ? `Día ${Math.round(value)}`
    : new Date(value).toLocaleDateString('es', { day: '2-digit', month: 'short', timeZone: 'UTC' });

  const resetView = () => {
    setZoomX(1);
    setZoomY(1);
    setPanX(0);
    setPanY(0);
    setCursor(null);
    setSelectedSeries(null);
  };

  const selectFromClient = (clientX: number, clientY: number, target: SVGSVGElement) => {
    const candidates = visibleX.length ? visibleX : allX;
    if (!candidates.length) return;
    const rect = target.getBoundingClientRect();
    const px = clamp(((clientX - rect.left) / rect.width) * chartWidth, inset.left, chartWidth - inset.right);
    const rawX = visibleMinX + ((px - inset.left) / plotWidth) * visibleSpanX;
    const nextCursor = candidates.reduce((best, value) => Math.abs(value - rawX) < Math.abs(best - rawX) ? value : best, candidates[0]);
    const py = clamp(((clientY - rect.top) / rect.height) * chartHeight, inset.top, chartHeight - inset.bottom);
    const rawY = visibleMinY + ((inset.top + plotHeight - py) / plotHeight) * visibleSpanY;
    const candidatesAtX = chartSeries.flatMap((item) => item.points.filter((point) => point.x === nextCursor).map((point) => ({ id: item.id, distance: Math.abs(point.y - rawY) })));
    const nearest = candidatesAtX.sort((a, b) => a.distance - b.distance)[0];
    setCursor(nextCursor);
    setSelectedSeries(nearest?.id ?? null);
    if (xMode === 'date') onDateSelect?.(dateKey(nextCursor));
  };

  const beginGesture = () => {
    const pair = [...pointers.current.values()].slice(0, 2);
    if (pair.length < 2) return;
    gesture.current = {
      spanX: Math.max(12, Math.abs(pair[1].x - pair[0].x)),
      spanY: Math.max(12, Math.abs(pair[1].y - pair[0].y)),
      centerX: (pair[0].x + pair[1].x) / 2,
      centerY: (pair[0].y + pair[1].y) / 2,
      zoomX, zoomY, panX, panY,
    };
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) {
      const now = Date.now();
      if (now - lastTap.current < 320) resetView();
      else selectFromClient(event.clientX, event.clientY, event.currentTarget);
      lastTap.current = now;
    } else beginGesture();
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 1) return selectFromClient(event.clientX, event.clientY, event.currentTarget);
    const pair = [...pointers.current.values()].slice(0, 2);
    const base = gesture.current;
    if (!base) return beginGesture();
    const spanX = Math.max(12, Math.abs(pair[1].x - pair[0].x));
    const spanY = Math.max(12, Math.abs(pair[1].y - pair[0].y));
    const centerX = (pair[0].x + pair[1].x) / 2;
    const centerY = (pair[0].y + pair[1].y) / 2;
    const nextZoomX = clamp(base.zoomX * (spanX / base.spanX), 1, 14);
    const nextZoomY = clamp(base.zoomY * (spanY / base.spanY), 1, 14);
    const rect = event.currentTarget.getBoundingClientRect();
    const movableX = Math.max(.05, 1 - 1 / nextZoomX);
    const movableY = Math.max(.05, 1 - 1 / nextZoomY);
    setZoomX(nextZoomX);
    setZoomY(nextZoomY);
    setPanX(clamp(base.panX - ((centerX - base.centerX) / rect.width) / movableX, 0, 1));
    setPanY(clamp(base.panY + ((centerY - base.centerY) / rect.height) / movableY, 0, 1));
  };

  const onPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    gesture.current = null;
    if (pointers.current.size >= 2) beginGesture();
  };

  if (!points.length) return <div className="production-chart-empty">Todavía no hay registros que coincidan con los filtros.</div>;

  const content = (expanded: boolean) => <section className={`production-chart-card production-chart-v2 ${expanded ? 'production-chart-expanded' : ''}`}>
    <div className="production-chart-topline">
      <div className="production-total-chip"><small>{cursor == null ? 'Producción total' : `Producción · ${formatX(cursor)}`}</small><strong>{productionTotal.toFixed(3)} L</strong></div>
      {xMode==='date'?<div className="production-total-chip tank"><small>{cursor != null ? `Tanque · ${formatX(cursor)}` : 'Total en tanque'}</small><strong>{tankTotal.toFixed(3)} L</strong></div>:<div className="production-total-chip tank"><small>Lactancias comparadas</small><strong>{series.length}</strong></div>}
      {expanded&&onFilterChange ? <ProductionAnimalFilter value={filterValue} options={filterOptions} onChange={onFilterChange}/> : null}
      <div className="production-chart-buttons">{cursor != null ? <IconButton label="Quitar selección" onClick={() => { setCursor(null); setSelectedSeries(null); }}><X size={18}/></IconButton> : null}{expanded ? <IconButton label="Cerrar pantalla completa" onClick={() => setFullscreen(false)}><Minimize2 size={19}/></IconButton> : <IconButton label="Ampliar gráfico" onClick={() => setFullscreen(true)}><Maximize2 size={19}/></IconButton>}</div>
    </div>
    <div ref={expanded?expandedStageRef:undefined} className="production-chart-stage"><svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Gráfico de producción de leche" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <defs><clipPath id={expanded?`${clipId}-full`:clipId}><rect x={inset.left} y={inset.top} width={plotWidth} height={plotHeight}/></clipPath></defs>
      {[0, .25, .5, .75, 1].map((part) => { const y = inset.top + plotHeight * (1 - part); const value = visibleMinY + visibleSpanY * part; return <g key={part}><line x1={inset.left} y1={y} x2={chartWidth - inset.right} y2={y} className="chart-grid"/><text x={inset.left - 9} y={y + 4} textAnchor="end" className="chart-axis-label">{value.toFixed(1)}</text></g>; })}
      {ticks.map((value) => <text key={value} x={mapX(value)} y={chartHeight - 13} textAnchor="middle" className="chart-axis-label">{formatX(value)}</text>)}
      <g clipPath={`url(#${expanded?`${clipId}-full`:clipId})`}>
        {chartSeries.map((item) => { const shown = [...item.points].sort((a, b) => a.x - b.x); const path = shown.map((point, pointIndex) => `${pointIndex ? 'L' : 'M'} ${mapX(point.x)} ${mapY(point.y)}`).join(' '); const color = seriesColors.get(item.id) ?? colorAt(0); return <g key={item.id} className={selectedSeries && selectedSeries !== item.id ? 'chart-series-muted' : ''}>{shown.length > 1 ? <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/> : null}{shown.map((point) => <circle key={`${point.x}-${point.y}`} cx={mapX(point.x)} cy={mapY(point.y)} r={selectedSeries === item.id && cursor === point.x ? 7 : 4} fill={color} stroke={selectedSeries === item.id && cursor === point.x ? '#fff' : 'none'} strokeWidth="3"/>)}</g>; })}
        {cursor != null ? <line x1={mapX(cursor)} y1={inset.top} x2={mapX(cursor)} y2={inset.top + plotHeight} className="chart-cursor"/> : null}
      </g>
    </svg></div>
    <div className="production-series-strip" aria-label={cursor == null ? 'Totales por animal' : 'Producción en el punto seleccionado'}>{listedItems.map((item) => <button type="button" data-production-series-id={item.series.id} className={selectedSeries === item.series.id ? 'selected' : ''} key={item.series.id} onClick={() => setSelectedSeries((current) => current === item.series.id ? null : item.series.id)}><i style={{ background: item.color }}/><span><strong>{item.series.label}</strong><small>{item.total.toFixed(3)} L</small></span></button>)}</div>
  </section>;

  return <>{content(false)}{fullscreen ? createPortal(<div className="production-chart-fullscreen" role="dialog" aria-modal="true" aria-label="Gráfico de producción ampliado">{content(true)}</div>, document.body) : null}</>;
}
