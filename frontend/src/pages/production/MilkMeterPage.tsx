import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, Eye, Gauge, Link2, Milk, Plus, RefreshCw, Router, Save, Settings2, Trash2, Upload, Wifi, WifiOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../../api/client';
import { AnimalSelect, useAnimalDirectory, type AnimalPickerOption } from '../../components/AnimalPicker';
import { useToast } from '../../components/ToastContext';
import { Badge, Button, EmptyState, Field, IconButton, Input, Select } from '../../components/ui';
import type { ActiveLactationCow } from '../../types/api';
import { currentDateInput, formatDate, formatNumber } from '../../utils';
import {
  DEVICE_AP_ADDRESS,
  deviceRequest,
  loadActiveDeviceSessionId,
  loadDeviceAddress,
  loadDeviceSessions,
  saveActiveDeviceSessionId,
  saveDeviceAddress,
  saveDeviceSession,
  type DeviceAnimal,
  type DeviceContainer,
  type DeviceControlMeasure,
  type DeviceMeasure,
  type DeviceMonitorStatus,
  type DeviceReading,
  type DeviceSession,
  type DeviceStatus,
} from '../../device/deviceApi';

const importedKey = 'sgb.milk-meter.imported';
const snapshotPrefix = 'sgb.milk-meter.snapshot.v2.';
const newContainer = (): DeviceContainer => ({ id: 0, name: 'Nuevo recipiente', type: 'BUCKET', active: false, capacity_liters: 0, calibrated: false, points: [] });

interface MeterSnapshot {
  status: DeviceStatus;
  containers: DeviceContainer[];
  readings: DeviceReading[];
  animals: DeviceAnimal[];
  savedAt: number;
}

function snapshotKey(address: string) {
  return `${snapshotPrefix}${address.trim().replace(/[^a-z0-9]/gi, '_')}`;
}

function loadSnapshot(address: string): MeterSnapshot | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(snapshotKey(address)) || 'null') as MeterSnapshot | null;
    return parsed?.status && Array.isArray(parsed.readings) ? parsed : null;
  } catch { return null; }
}

function saveSnapshot(address: string, snapshot: MeterSnapshot) {
  localStorage.setItem(snapshotKey(address), JSON.stringify(snapshot));
}

function loadImportedKeys() {
  try { return new Set<string>(JSON.parse(localStorage.getItem(importedKey) || '[]')); }
  catch { return new Set<string>(); }
}

function localDate(epoch: number) {
  const date = epoch > 1_000_000_000 ? new Date(epoch * 1000) : new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function readingTurn(reading: DeviceReading) {
  const value = reading.session_name.toUpperCase();
  return value.startsWith('MAN') ? 'MANANA' : value.startsWith('TAR') ? 'TARDE' : 'UNICO';
}

function EditableNumberInput({ value, onValue }: { value: number; onValue: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <Input type="number" step="0.01" value={draft} onFocus={(event) => event.currentTarget.select()} onChange={(event) => {
    const next = event.target.value;
    setDraft(next);
    if (next !== '' && Number.isFinite(Number(next))) onValue(Number(next));
  }} onBlur={() => { if (draft === '') setDraft(String(value)); }} />;
}

export function MilkMeterPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const directory = useAnimalDirectory();
  const initialSessions = useMemo(loadDeviceSessions, []);
  const initialActiveId = loadActiveDeviceSessionId() || initialSessions[0]?.id || '';
  const initialSession = initialSessions.find((item) => item.id === initialActiveId) || initialSessions[0];
  const initialSnapshot = useMemo(() => loadSnapshot(initialSession?.address || loadDeviceAddress()), [initialSession?.address]);
  const [sessions, setSessions] = useState<DeviceSession[]>(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState(initialSession?.id || '');
  const [editingSessionId, setEditingSessionId] = useState<string | null>(initialSession?.id || null);
  const [isAp, setIsAp] = useState(initialSession?.mode === 'AP');
  const [address, setAddress] = useState(initialSession?.address || loadDeviceAddress());
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [cachedStatus, setCachedStatus] = useState<DeviceStatus | null>(initialSnapshot?.status || null);
  const [containers, setContainers] = useState<DeviceContainer[]>(initialSnapshot?.containers || []);
  const [readings, setReadings] = useState<DeviceReading[]>(initialSnapshot?.readings || []);
  const [deviceAnimals, setDeviceAnimals] = useState<DeviceAnimal[]>(initialSnapshot?.animals || []);
  const [snapshotAt, setSnapshotAt] = useState(initialSnapshot?.savedAt || 0);
  const [importedKeys, setImportedKeys] = useState<Set<string>>(loadImportedKeys);
  const [busy, setBusy] = useState('');
  const [lastMeasure, setLastMeasure] = useState<DeviceMeasure | null>(null);
  const [remoteMeasure, setRemoteMeasure] = useState<DeviceControlMeasure | null>(null);
  const [monitorState, setMonitorState] = useState<DeviceMonitorStatus | null>(null);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [targetType, setTargetType] = useState<'ANIMAL' | 'TANK'>('ANIMAL');
  const [targetId, setTargetId] = useState('');
  const [controlContainerId, setControlContainerId] = useState('');
  const [controlSession, setControlSession] = useState('0');
  const connected = Boolean(status);
  const displayedStatus = status || cachedStatus;
  const hasSnapshot = Boolean(displayedStatus || readings.length || containers.length || deviceAnimals.length);
  const activeBuckets = useMemo(() => containers.filter((item) => item.type === 'BUCKET' && item.active), [containers]);
  const activeTanks = useMemo(() => containers.filter((item) => item.type === 'TANK' && item.active), [containers]);
  const selectableContainers = targetType === 'ANIMAL' ? activeBuckets : activeTanks;
  const animalOptions = useMemo<AnimalPickerOption[]>(() => deviceAnimals.map((animal) => {
    const local = directory.byId.get(animal.id);
    return { id: animal.id, name: animal.name, subtitle: local?.codigo_arete ? `Arete ${local.codigo_arete}` : 'Enviado al medidor', photoUrl: local?.foto_perfil };
  }), [deviceAnimals, directory.byId]);

  useEffect(() => {
    const targetOptions = targetType === 'ANIMAL' ? deviceAnimals.map((animal) => animal.id) : activeTanks.map((tank) => String(tank.id));
    if (!targetOptions.includes(targetId)) setTargetId(targetOptions[0] || '');
  }, [activeTanks, deviceAnimals, targetId, targetType]);

  useEffect(() => {
    const values = selectableContainers.map((item) => String(item.id));
    if (!values.includes(controlContainerId)) setControlContainerId(values[0] || '');
  }, [controlContainerId, selectableContainers]);

  const applySnapshot = (snapshot: MeterSnapshot | null) => {
    setCachedStatus(snapshot?.status || null);
    setContainers(snapshot?.containers || []);
    setReadings(snapshot?.readings || []);
    setDeviceAnimals(snapshot?.animals || []);
    setSnapshotAt(snapshot?.savedAt || 0);
  };

  const fetchDeviceSnapshot = async (base: string, info?: DeviceStatus) => {
    const currentStatus = info || await deviceRequest<DeviceStatus>(base, '/api/status');
    const [containerResponse, readingResponse, animalResponse] = await Promise.all([
      deviceRequest<{ containers: DeviceContainer[] }>(base, '/api/containers'),
      deviceRequest<{ readings: DeviceReading[] }>(base, '/api/readings'),
      deviceRequest<{ animals: DeviceAnimal[] }>(base, '/api/animals'),
    ]);
    const snapshot: MeterSnapshot = { status: currentStatus, containers: containerResponse.containers, readings: readingResponse.readings, animals: animalResponse.animals, savedAt: Date.now() };
    saveSnapshot(base, snapshot);
    setStatus(currentStatus);
    applySnapshot(snapshot);
    if (currentStatus.monitoring || currentStatus.monitor_stable) {
      try {
        const monitor = await deviceRequest<DeviceMonitorStatus>(base, '/api/monitor');
        setMonitorState(monitor.target_type ? monitor : null);
      } catch { setMonitorState(null); }
    } else {
      setMonitorState(null);
    }
    return snapshot;
  };

  const connect = async (existing?: DeviceSession) => {
    setBusy('connect');
    try {
      const mode = existing?.mode ?? (isAp ? 'AP' : 'LAN');
      const base = saveDeviceAddress(existing?.address ?? (mode === 'AP' ? DEVICE_AP_ADDRESS : address));
      setAddress(base);
      const info = await deviceRequest<DeviceStatus>(base, '/api/status');
      if (info.protocol_version !== 1) throw new Error(`Protocolo ${info.protocol_version} no compatible con esta versión de la app.`);
      if (!info.time_valid) await deviceRequest(base, '/api/time', { method: 'POST', body: { epoch: Math.floor(Date.now() / 1000) } });
      await fetchDeviceSnapshot(base, info);
      const id = existing?.id || editingSessionId || crypto.randomUUID();
      const saved: DeviceSession = { id, address: base, mode, deviceId: info.device_id, name: mode === 'AP' ? 'AP del medidor' : `LAN ${info.device_name || info.device_id}` };
      setSessions(saveDeviceSession(saved));
      setActiveSessionId(id);
      setEditingSessionId(id);
      setIsAp(mode === 'AP');
      toast.show(`Medidor ${info.device_id} vinculado localmente.`);
    } catch (error) {
      setStatus(null);
      toast.show(`${(error as Error).message} Se conservan los últimos datos disponibles.`, 'error');
    } finally { setBusy(''); }
  };

  const refreshDevice = async () => {
    setBusy('refresh');
    try { await fetchDeviceSnapshot(address); toast.show('Datos del medidor actualizados.'); }
    catch (error) { setStatus(null); toast.show(`${(error as Error).message} Se muestra la copia guardada.`, 'error'); }
    finally { setBusy(''); }
  };

  const switchSession = async (session: DeviceSession) => {
    setStatus(null);
    setActiveSessionId(session.id);
    setEditingSessionId(session.id);
    setAddress(session.address);
    setIsAp(session.mode === 'AP');
    saveActiveDeviceSessionId(session.id);
    applySnapshot(loadSnapshot(session.address));
    await connect(session);
  };

  const relink = () => {
    const selected = sessions.find((item) => item.id === activeSessionId);
    setStatus(null);
    setEditingSessionId(selected?.id || null);
    setIsAp(selected?.mode === 'AP');
    setAddress(selected?.address || loadDeviceAddress());
  };

  const newSession = () => {
    if (sessions.length >= 2) return toast.show('Ya guardaste dos sesiones. Selecciona una y usa “Volver a vincular” para reemplazarla.', 'error');
    setStatus(null);
    setEditingSessionId(null);
    setActiveSessionId('');
    setIsAp(false);
    setAddress(loadDeviceAddress());
    applySnapshot(null);
  };

  const reloadContainers = async () => {
    const response = await deviceRequest<{ containers: DeviceContainer[] }>(address, '/api/containers');
    setContainers(response.containers);
    await refreshDevice();
  };

  const updateContainer = (index: number, patch: Partial<DeviceContainer>) => setContainers((items) => items.map((item, current) => current === index ? { ...item, ...patch } : item));
  const updatePoint = (containerIndex: number, pointIndex: number, field: 'distance_cm' | 'liters', value: number) => setContainers((items) => items.map((item, current) => current !== containerIndex ? item : ({ ...item, points: item.points.map((point, position) => position === pointIndex ? { ...point, [field]: value } : point) })));

  const saveContainers = async () => {
    setBusy('save');
    try {
      for (const container of containers) {
        if (!container.name.trim() || container.capacity_liters <= 0) throw new Error('Cada recipiente necesita nombre y capacidad mayor a cero.');
        const points = [...container.points].sort((a, b) => a.distance_cm - b.distance_cm).map((point) => `${point.distance_cm}\t${point.liters}`).join('\n');
        await deviceRequest(address, '/api/containers/save', { method: 'POST', body: { id: container.id, name: container.name, type: container.type, capacity_liters: container.capacity_liters, active: container.active, points } });
      }
      await reloadContainers();
      toast.show('Calibración guardada en el medidor.');
    } catch (error) { toast.show((error as Error).message, 'error'); }
    finally { setBusy(''); }
  };

  const measure = async (containerIndex: number) => {
    const container = containers[containerIndex];
    setBusy(`measure-${containerIndex}`);
    try {
      const result = await deviceRequest<DeviceMeasure>(address, '/api/measure', { method: 'POST', body: { sensor: container.type, container_id: container.id || null } });
      setLastMeasure(result);
      if (!result.valid || result.distance_cm == null) throw new Error('No se obtuvo una lectura válida.');
      updateContainer(containerIndex, { points: [...container.points, { distance_cm: result.distance_cm, liters: result.liters ?? 0 }] });
      toast.show(`Lectura ${result.distance_cm.toFixed(2)} cm agregada. Edita los litros conocidos.`);
    } catch (error) { toast.show((error as Error).message, 'error'); }
    finally { setBusy(''); }
  };

  const removeContainer = async (index: number) => {
    const container = containers[index];
    if (container.id) await deviceRequest(address, '/api/containers/delete', { method: 'POST', body: { id: container.id } });
    setContainers((items) => items.filter((_, current) => current !== index));
  };

  const syncCows = async () => {
    setBusy('cows');
    try {
      const cows = await apiRequest<ActiveLactationCow[]>(`/registros/producciones/vacas-activas?fecha=${currentDateInput()}`);
      const items = cows.map((cow) => `${cow.id_animal}\t${cow.nombre}`).join('\n');
      await deviceRequest(address, '/api/animals/replace', { method: 'POST', body: { revision: Math.floor(Date.now() / 1000), items } });
      await refreshDevice();
      toast.show(`${cows.length} vaca(s) disponibles enviadas al medidor.`);
    } catch (error) { toast.show((error as Error).message, 'error'); }
    finally { setBusy(''); }
  };

  const importReadings = async () => {
    setBusy('readings');
    try {
      const imported = new Set(importedKeys);
      let completed = 0;
      for (const reading of readings) {
        if (imported.has(reading.reading_key)) continue;
        const common = { fecha_produccion: localDate(reading.epoch), turno: readingTurn(reading), litros: reading.liters, fuente: 'SENSOR', observaciones: `Medidor ${reading.reading_key} · ${reading.distance_cm} cm` };
        if (reading.target_type === 'ANIMAL' && reading.target_id) await apiRequest('/registros/producciones', { method: 'POST', body: { ...common, id_vaca: reading.target_id } });
        else await apiRequest('/registros/produccion-tanque', { method: 'POST', body: { ...common, referencia_externa: reading.reading_key } });
        imported.add(reading.reading_key);
        completed += 1;
        localStorage.setItem(importedKey, JSON.stringify([...imported].slice(-5000)));
        setImportedKeys(new Set(imported));
      }
      toast.show(completed ? `${completed} lectura(s) importadas. Permanecen guardadas en el medidor.` : 'No hay lecturas nuevas por importar.');
    } catch (error) { toast.show((error as Error).message, 'error'); }
    finally { setBusy(''); }
  };

  const deleteReading = async (reading: DeviceReading) => {
    if (!window.confirm(`¿Eliminar del medidor la lectura de ${reading.target_name}?`)) return;
    setBusy(`delete-${reading.id}`);
    try {
      await deviceRequest(address, '/api/readings/ack', { method: 'POST', body: { id: reading.id } });
      await refreshDevice();
      toast.show('Lectura eliminada del medidor.');
    } catch (error) { toast.show((error as Error).message, 'error'); }
    finally { setBusy(''); }
  };

  const deleteImported = async () => {
    const selected = readings.filter((reading) => importedKeys.has(reading.reading_key));
    if (!selected.length) return toast.show('No hay lecturas importadas para eliminar.');
    if (!window.confirm(`¿Eliminar del medidor ${selected.length} lectura(s) ya importadas?`)) return;
    setBusy('delete-imported');
    try {
      for (const reading of selected) await deviceRequest(address, '/api/readings/ack', { method: 'POST', body: { id: reading.id } });
      await refreshDevice();
      toast.show(`${selected.length} lectura(s) eliminadas del medidor.`);
    } catch (error) { toast.show((error as Error).message, 'error'); }
    finally { setBusy(''); }
  };

  const controlMeasure = async (save: boolean, replace = false) => {
    if (!targetId || !controlContainerId) return toast.show('Selecciona el animal o tanque y el recipiente.', 'error');
    setBusy(save ? 'remote-save' : 'remote-read');
    try {
      const result = await deviceRequest<DeviceControlMeasure>(address, '/api/control/measure', { method: 'POST', body: {
        target_type: targetType,
        target_id: targetType === 'TANK' ? `container:${targetId}` : targetId,
        container_id: Number(controlContainerId),
        session: Number(controlSession),
        save,
        replace,
      } });
      setRemoteMeasure(result);
      if (!result.valid) throw new Error('El sensor no obtuvo una lectura válida.');
      if (save) {
        setMonitorState(null);
        await refreshDevice();
        toast.show(result.replaced ? 'Lectura anterior reemplazada.' : 'Lectura guardada en el medidor.');
      } else {
        const monitor = await deviceRequest<DeviceMonitorStatus>(address, '/api/monitor');
        setMonitorState(monitor.target_type ? monitor : null);
        toast.show('Seguimiento automático iniciado.');
      }
    } catch (error) {
      const message = (error as Error).message;
      if (save && !replace && /ya tiene|reemplaz/i.test(message) && window.confirm(`${message}\n\n¿Deseas reemplazarla?`)) {
        setBusy('');
        await controlMeasure(true, true);
        return;
      }
      toast.show(message, 'error');
    } finally { setBusy(''); }
  };

  useEffect(() => {
    if (!connected || status?.monitoring === undefined) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const monitor = await deviceRequest<DeviceMonitorStatus>(address, '/api/monitor');
        if (!cancelled) setMonitorState(monitor.target_type ? monitor : null);
      } catch { /* La conexión principal conserva la última lectura visible. */ }
    };
    const timer = window.setInterval(() => void poll(), 1000);
    void poll();
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [address, connected, status?.monitoring]);

  return <div className="milk-meter-page">
    <div className="meter-session-header"><IconButton label="Volver a producción" onClick={() => navigate('/produccion')}><ArrowLeft size={20}/></IconButton><div className="meter-session-tabs">{sessions.map((session)=><button type="button" className={session.id===activeSessionId?'active':''} key={session.id} onClick={()=>void switchSession(session)}>{session.mode==='AP'?<Router size={16}/>:<Wifi size={16}/>}<span>{session.name}</span></button>)}</div>{activeSessionId?<IconButton label="Volver a vincular esta sesión" onClick={relink}><Link2 size={19}/></IconButton>:null}{sessions.length<2?<IconButton label="Agregar otra sesión" onClick={newSession}><Plus size={20}/></IconButton>:null}</div>
    <section className="meter-connect-card">
      {!connected ? <><label className="meter-ap-choice"><input type="checkbox" checked={isAp} onChange={(event)=>{setIsAp(event.target.checked);if(event.target.checked)setAddress(DEVICE_AP_ADDRESS);}}/><span><Router size={19}/><strong>Conectado al AP del microcontrolador</strong><small>Usará automáticamente {DEVICE_AP_ADDRESS.replace('http://','')}</small></span></label>{!isAp?<Field label="Dirección IP en la misma LAN" hint="Mantén OK presionado en el equipo para consultar la IP actual."><Input value={address} onChange={(event) => setAddress(event.target.value)} inputMode="url" placeholder="http://192.168.1.80" /></Field>:null}<Button onClick={() => void connect()} loading={busy === 'connect'}><Link2 size={18} />{editingSessionId?'Conectar nuevamente':'Guardar y vincular'}</Button></> : null}
      {displayedStatus ? <div className="meter-status"><Badge tone={connected ? 'success' : 'warning'}>{connected ? <CheckCircle2 size={14} /> : <WifiOff size={14} />}{connected ? 'Conectado' : 'Copia sin conexión'}</Badge><strong>{displayedStatus.device_name}</strong><span>{displayedStatus.device_id} · Firmware {displayedStatus.firmware_version}</span>{snapshotAt ? <small>Actualizado {new Date(snapshotAt).toLocaleString()}</small> : null}</div> : null}
    </section>
    {!hasSnapshot ? <EmptyState icon={Gauge} title="Vincula el medidor" description="Conecta el celular al AP 192.168.4.1 o a la misma red Wi-Fi del ESP32." /> : <>
      <div className="meter-actions">
        <Button variant="secondary" disabled={!connected} onClick={() => void syncCows()} loading={busy === 'cows'}><Upload size={18} />Enviar vacas</Button>
        <Button variant="secondary" onClick={() => void importReadings()} loading={busy === 'readings'} disabled={!readings.length}><Download size={18} />Importar nuevas</Button>
        <Button variant="secondary" disabled={!connected} onClick={() => setCalibrationOpen((value) => !value)}><Settings2 size={18} />Calibrar</Button>
        <Button variant="ghost" disabled={!connected} onClick={() => void refreshDevice()} loading={busy === 'refresh'}><RefreshCw size={18} />Actualizar</Button>
      </div>
      <div className="meter-summary"><span><strong>{displayedStatus?.animals_count ?? deviceAnimals.length}</strong> vacas</span><span><strong>{containers.length}</strong> recipientes</span><span><strong>{readings.length}</strong> lecturas guardadas</span></div>

      <section className="meter-control-section">
        <div className="section-title"><div><h2>Control del medidor</h2><p>Selecciona desde el celular lo mismo que elegirías en la pantalla del equipo.</p></div><Badge tone={connected && status?.remote_control ? 'success' : 'warning'}>{connected && status?.remote_control ? 'Disponible' : connected ? 'Requiere firmware 10' : 'Sin conexión'}</Badge></div>
        <div className="meter-target-tabs"><button type="button" className={targetType === 'ANIMAL' ? 'active' : ''} onClick={() => setTargetType('ANIMAL')}><Milk size={18}/>Animal</button><button type="button" className={targetType === 'TANK' ? 'active' : ''} onClick={() => setTargetType('TANK')}><Gauge size={18}/>Tanque</button></div>
        <div className="meter-control-grid">
          {targetType === 'ANIMAL' ? <Field label="Animal"><AnimalSelect value={targetId} options={animalOptions} onChange={setTargetId} placeholder="Buscar animal…" disabled={!connected}/></Field> : <Field label="Tanque"><Select value={targetId} onChange={(event) => setTargetId(event.target.value)} disabled={!connected}>{activeTanks.map((tank) => <option key={tank.id} value={tank.id}>{tank.name}</option>)}</Select></Field>}
          <Field label={targetType === 'ANIMAL' ? 'Balde' : 'Tanque de medición'}><Select value={controlContainerId} onChange={(event) => setControlContainerId(event.target.value)} disabled={!connected}>{selectableContainers.map((container) => <option key={container.id} value={container.id}>{container.name}</option>)}</Select></Field>
          <Field label="Sesión"><Select value={controlSession} onChange={(event) => setControlSession(event.target.value)} disabled={!connected}><option value="0">Mañana</option><option value="1">Tarde</option><option value="2">Único</option></Select></Field>
        </div>
        <div className="meter-control-actions"><Button variant="secondary" disabled={!connected || !status?.remote_control} onClick={() => void controlMeasure(false)} loading={busy === 'remote-read'}><Eye size={18}/>Iniciar seguimiento</Button><Button disabled={!connected || !status?.remote_control} onClick={() => void controlMeasure(true)} loading={busy === 'remote-save'}><Save size={18}/>Tomar y guardar</Button></div>
        {monitorState ? <div className="meter-live-result"><span><small>Distancia actual</small><strong>{monitorState.distance_cm == null ? '—' : `${formatNumber(monitorState.distance_cm, 2)} cm`}</strong></span><span><small>Producción estimada</small><strong>{monitorState.liters == null ? '—' : `${formatNumber(monitorState.liters, 3)} L`}</strong></span><span><small>Variación de 20 lecturas</small><strong>{monitorState.range_cm == null ? '—' : `${formatNumber(monitorState.range_cm, 2)} cm`}</strong></span><Badge tone={monitorState.stable ? 'success' : 'warning'}>{monitorState.stable ? 'Estable' : monitorState.monitoring ? `Midiendo ${monitorState.progress}/${monitorState.required}` : 'Variable'}</Badge></div> : remoteMeasure ? <div className="meter-live-result"><span><small>Distancia</small><strong>{remoteMeasure.distance_cm == null ? '—' : `${formatNumber(remoteMeasure.distance_cm, 2)} cm`}</strong></span><span><small>Producción</small><strong>{remoteMeasure.liters == null ? '—' : `${formatNumber(remoteMeasure.liters, 3)} L`}</strong></span><span><small>Dispersión</small><strong>{remoteMeasure.spread_cm == null ? '—' : `${formatNumber(remoteMeasure.spread_cm, 2)} cm`}</strong></span><Badge tone={remoteMeasure.stable ? 'success' : 'warning'}>{remoteMeasure.stable ? 'Estable' : 'Variable'}</Badge></div> : null}
      </section>

      <section className="meter-readings-section">
        <div className="section-title"><div><h2>Lecturas del medidor</h2><p>Puedes revisarlas sin importarlas. Importar no las borra del equipo.</p></div><Button variant="ghost" disabled={!connected || !readings.some((reading) => importedKeys.has(reading.reading_key))} onClick={() => void deleteImported()} loading={busy === 'delete-imported'}><Trash2 size={18}/>Eliminar importadas</Button></div>
        {readings.length ? <div className="meter-reading-list">{readings.map((reading) => <article key={reading.id}><span className="meter-reading-icon">{reading.target_type === 'ANIMAL' ? <Milk size={19}/> : <Gauge size={19}/>}</span><div><strong>{reading.target_name}</strong><small>{formatDate(localDate(reading.epoch))} · {reading.session_name} · {formatNumber(reading.distance_cm, 2)} cm</small></div><b>{formatNumber(reading.liters, 3)} L</b><Badge tone={importedKeys.has(reading.reading_key) ? 'success' : 'neutral'}>{importedKeys.has(reading.reading_key) ? 'Importada' : 'Pendiente'}</Badge><IconButton label="Eliminar del medidor" disabled={!connected || busy === `delete-${reading.id}`} onClick={() => void deleteReading(reading)}><Trash2 size={18}/></IconButton></article>)}</div> : <EmptyState icon={Download} title="Sin lecturas guardadas" description="Las nuevas mediciones aparecerán aquí al actualizar el dispositivo." />}
      </section>

      {calibrationOpen ? <section className="calibration-section">
        <div className="section-title"><div><h2>Recipientes y calibración</h2><p>Todos los valores se editan aquí. Guarda una sola vez al terminar.</p></div><Button variant="secondary" disabled={!connected} onClick={() => setContainers((items) => [...items, newContainer()])}><Plus size={18} />Agregar</Button></div>
        {lastMeasure ? <div className="form-alert"><strong>Última lectura:</strong> {lastMeasure.distance_cm?.toFixed(2) ?? '—'} cm · dispersión {lastMeasure.spread_cm?.toFixed(2) ?? '—'} cm · {lastMeasure.valid_samples}/{lastMeasure.requested_samples} ecos</div> : null}
        <div className="container-editor-list">{containers.map((container, containerIndex) => <article className="container-editor" key={`${container.id}-${containerIndex}`}>
          <div className="container-editor-head"><strong>{container.name}</strong><Badge tone={container.calibrated ? 'success' : 'warning'}>{container.calibrated ? 'Calibrado' : 'Pendiente'}</Badge><IconButton label="Eliminar recipiente" disabled={!connected} onClick={() => void removeContainer(containerIndex)}><Trash2 size={18} /></IconButton></div>
          <div className="container-fields"><Field label="Nombre"><Input maxLength={16} value={container.name} onChange={(event) => updateContainer(containerIndex, { name: event.target.value })} /></Field><Field label="Tipo"><Select value={container.type} onChange={(event) => updateContainer(containerIndex, { type: event.target.value as 'BUCKET' | 'TANK' })}><option value="BUCKET">Balde</option><option value="TANK">Tanque</option></Select></Field><Field label="Capacidad máxima (L)"><Input type="number" min="0.01" step="0.01" value={container.capacity_liters || ''} onChange={(event) => updateContainer(containerIndex, { capacity_liters: Number(event.target.value) })} /></Field><label className="checkbox"><input type="checkbox" checked={container.active} onChange={(event) => updateContainer(containerIndex, { active: event.target.checked })} />Activo en el medidor</label></div>
          <div className="point-table"><div className="point-row point-head"><span>Distancia (cm)</span><span>Litros conocidos</span><span /></div>{container.points.map((point, pointIndex) => <div className="point-row" key={pointIndex}><EditableNumberInput value={point.distance_cm} onValue={(value) => updatePoint(containerIndex, pointIndex, 'distance_cm', value)} /><EditableNumberInput value={point.liters} onValue={(value) => updatePoint(containerIndex, pointIndex, 'liters', value)} /><IconButton label="Quitar punto" onClick={() => updateContainer(containerIndex, { points: container.points.filter((_, current) => current !== pointIndex) })}><Trash2 size={17} /></IconButton></div>)}</div>
          <Button variant="secondary" disabled={!connected} onClick={() => void measure(containerIndex)} loading={busy === `measure-${containerIndex}`}><Gauge size={18} />Tomar lectura y agregar punto</Button>
        </article>)}</div>
        <div className="calibration-save"><Button disabled={!connected} onClick={() => void saveContainers()} loading={busy === 'save'}><Save size={18} />Guardar todos los cambios</Button></div>
      </section> : null}
    </>}
  </div>;
}
