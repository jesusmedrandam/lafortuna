import { FormEvent, useEffect, useState } from 'react';
import {
  ApiRequestError,
  getAdministrativeAccount,
  getPlatformOverview,
  updateAdministrativeAccount,
  updateAdministrativeModule,
  updateAdministrativeQuota,
  type AccountDetails,
  type PlatformOverview,
} from './api';
import {SystemCatalogAdmin} from './SystemCatalogAdmin';
import {Select} from '../components/ui';

const message = (error: unknown) => error instanceof ApiRequestError
  ? error.message
  : 'No fue posible completar la operación.';

const statusName = { ACTIVE: 'Activa', SUSPENDED: 'Suspendida', DISABLED: 'Deshabilitada' } as const;

function formatQuota(value: number, unit: 'BYTES' | 'COUNT') {
  if (unit === 'COUNT') return value.toLocaleString('es-EC');
  const gibibytes = value / 1024 ** 3;
  return `${gibibytes.toLocaleString('es-EC', { maximumFractionDigits: 2 })} GiB`;
}

function QuotaEditor({ quota, busy, onSave }: {
  quota: AccountDetails['quotas'][number];
  busy: boolean;
  onSave: (value: number | null) => Promise<void>;
}) {
  const displayValue = quota.unit === 'BYTES' && quota.limitValue !== null
    ? quota.limitValue / 1024 ** 3
    : quota.limitValue;
  const [value, setValue] = useState(displayValue?.toString() || '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    await onSave(quota.unit === 'BYTES' ? Math.round(parsed * 1024 ** 3) : Math.round(parsed));
  }

  return <form className="quota-row" onSubmit={submit}>
    <div><strong>{quota.name}</strong><small>{formatQuota(quota.usedValue, quota.unit)} utilizados</small></div>
    <div className="quota-input"><input type="number" min="0" step={quota.unit === 'BYTES' ? '.25' : '1'}
      value={value} onChange={(event) => setValue(event.target.value)} disabled={busy} />
      <span>{quota.unit === 'BYTES' ? 'GiB' : 'registros'}</span></div>
    <button className="secondary-button compact" type="submit" disabled={busy}>Guardar</button>
    <button className="text-button" type="button" onClick={() => onSave(null)} disabled={busy}>Sin límite</button>
  </form>;
}

export function SuperadminPanel({ accessToken, onSettingsChanged,onStartSupport }: {
  accessToken: string; onSettingsChanged: () => Promise<void>;onStartSupport:(accountId:string,propertyId:string)=>Promise<void>;
}) {
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [detail, setDetail] = useState<AccountDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab,setTab]=useState<'accounts'|'catalogs'>('accounts');
  const [search,setSearch]=useState('');const [page,setPage]=useState(1);

  async function loadOverview() {
    setOverview(await getPlatformOverview(accessToken,search,page));
  }

  async function loadAccount(accountId: string) {
    setBusy(true); setError(null);
    try { setDetail(await getAdministrativeAccount(accessToken, accountId)); }
    catch (loadError) { setError(message(loadError)); }
    finally { setBusy(false); }
  }

  async function reloadAccount() {
    if (!detail) return;
    const [nextDetail] = await Promise.all([
      getAdministrativeAccount(accessToken, detail.account.id),
      loadOverview(),
    ]);
    setDetail(nextDetail);
  }

  useEffect(() => {
    let active=true;const timer=setTimeout(()=>{
      void getPlatformOverview(accessToken,search,page).then(value=>{if(active){setOverview(value);setError(null);}})
        .catch(loadError=>{if(active)setError(message(loadError));});
    },220);return()=>{active=false;clearTimeout(timer);};
  }, [accessToken,search,page]);

  async function support(propertyId:string){if(!detail)return;setBusy(true);setError(null);
    try{await onStartSupport(detail.account.id,propertyId);}
    catch(failure){setError(failure instanceof Error?failure.message:message(failure));}
    finally{setBusy(false);}}

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(null);
    try {
      await updateAdministrativeAccount(accessToken, detail.account.id, {
        status: data.get('status') as AccountDetails['account']['status'],
        maxProperties: Number(data.get('maxProperties')),
      });
      await reloadAccount();
    } catch (saveError) { setError(message(saveError)); }
    finally { setBusy(false); }
  }

  async function saveQuota(code: string, value: number | null) {
    if (!detail) return;
    setBusy(true); setError(null);
    try { await updateAdministrativeQuota(accessToken, detail.account.id, code, value); await reloadAccount(); }
    catch (saveError) { setError(message(saveError)); }
    finally { setBusy(false); }
  }

  async function saveModule(code: string, enabled: boolean) {
    if (!detail) return;
    setBusy(true); setError(null);
    try { await updateAdministrativeModule(accessToken, detail.account.id, code, enabled);
      await reloadAccount(); await onSettingsChanged(); }
    catch (saveError) { setError(message(saveError)); }
    finally { setBusy(false); }
  }

  if (!overview) return <section className="section-block admin-loading"><span className="spinner large" />
    <p>{error || 'Cargando administración global…'}</p></section>;

  return <section className="section-block">
    <div className="section-heading"><div><span className="eyebrow">Administración global</span>
      <h2>Estado de la plataforma</h2></div><span className="phase-label">Datos reales</span></div>
    {error && <div className="form-error admin-error" role="alert">{error}</div>}
    <div className="system-admin-tabs" role="group" aria-label="Administración global">
      <button type="button" className={tab==='accounts'?'active':''}
        onClick={()=>setTab('accounts')}>Cuentas y módulos</button>
      <button type="button" className={tab==='catalogs'?'active':''}
        onClick={()=>setTab('catalogs')}>Opciones del sistema</button>
    </div>
    {tab==='catalogs'?<SystemCatalogAdmin token={accessToken}/>:<>
    <div className="platform-totals">
      <article><span>Usuarios</span><strong>{overview.totals.users}</strong></article>
      <article><span>Cuentas</span><strong>{overview.totals.accounts}</strong></article>
      <article><span>Propiedades</span><strong>{overview.totals.properties}</strong></article>
      <article><span>Animales gestionados</span><strong>{overview.totals.managedAnimals}</strong></article>
    </div>

    <div className="accounts-layout">
      <div className="accounts-list">
        <div className="subheading"><div><h3>Propietarios y cuentas</h3><p>Selecciona al propietario al que darás soporte.</p></div></div>
        <label className="support-owner-search"><span>Buscar propietario</span><input type="search" value={search}
          placeholder="Nombre, correo o cuenta" maxLength={160} disabled={busy} onChange={event=>{setSearch(event.target.value);setPage(1);setDetail(null);}}/></label>
        {overview.accounts.length === 0 ? <div className="empty-state"><strong>{search?'Sin coincidencias':'Aún no existen cuentas'}</strong>
          <p>{search?'Prueba con otro nombre, correo o cuenta.':'Aparecerán aquí cuando un usuario registre su primera propiedad.'}</p></div>
          : overview.accounts.map((account) => <button type="button" key={account.id}
            className={`account-row ${detail?.account.id === account.id ? 'selected' : ''}`}
            disabled={busy} onClick={() => loadAccount(account.id)}>
            <span className="account-avatar">{account.owner.name.slice(0, 1).toUpperCase()}</span>
            <span className="account-copy"><strong>{account.name}</strong><small>{account.owner.name} · {account.owner.email}</small></span>
            <span className={`status-pill ${account.status.toLowerCase()}`}>{statusName[account.status]}</span>
            <span className="account-count">{account.propertyCount} prop.</span>
          </button>)}
        <div className="inline-actions"><button type="button" className="secondary-button compact" disabled={page===1||busy}
          onClick={()=>{setPage(value=>value-1);setDetail(null);}}>Anterior</button><span>Página {page}</span>
          <button type="button" className="secondary-button compact" disabled={!overview.hasMore||busy}
            onClick={()=>{setPage(value=>value+1);setDetail(null);}}>Siguiente</button></div>
      </div>

      <div className="account-detail">
        {!detail ? <div className="empty-state"><strong>Selecciona una cuenta</strong>
          <p>Aquí podrás administrar límites, módulos y propiedades.</p></div> : <>
          <div className="detail-heading"><div><span className="eyebrow">Cuenta seleccionada</span><h3>{detail.account.name}</h3>
            <p>{detail.account.owner.name} · {detail.account.owner.email}</p></div></div>

          <form key={detail.account.id} className="account-settings" onSubmit={saveAccount}>
            <label><span>Estado</span><Select name="status" defaultValue={detail.account.status} disabled={busy}>
              <option value="ACTIVE">Activa</option><option value="SUSPENDED">Suspendida</option>
              <option value="DISABLED">Deshabilitada</option></Select></label>
            <label><span>Máximo de propiedades</span><input name="maxProperties" type="number" min="1" max="1000"
              defaultValue={detail.account.maxProperties} disabled={busy} /></label>
            <button className="primary-button compact" type="submit" disabled={busy}>Guardar cuenta</button>
          </form>

          <div className="detail-section"><h4>Límites compartidos</h4>{detail.quotas.map((quota) =>
            <QuotaEditor key={`${quota.code}:${quota.limitValue}`} quota={quota} busy={busy}
              onSave={(value) => saveQuota(quota.code, value)} />)}</div>

          <div className="detail-section"><h4>Módulos disponibles</h4><div className="module-switches">
            {detail.modules.map((module) => <label key={module.code} className="module-switch">
              <span><strong>{module.name}</strong><small>{module.isCore ? 'Obligatorio' : module.code}</small></span>
              <input type="checkbox" checked={module.enabled} disabled={busy || module.isCore}
                onChange={(event) => saveModule(module.code, event.target.checked)} />
            </label>)}</div></div>

          <div className="detail-section"><h4>Propiedades</h4>{detail.properties.length === 0
            ? <p className="muted">Esta cuenta no tiene propiedades disponibles.</p>
            : detail.properties.map((property) => <div className="property-row" key={property.id}>
              <div><strong>{property.name}</strong><small>{property.timezone}</small></div>
              <span>{property.animalCount} animales · {property.memberCount} usuarios</span>
              <button type="button" className="primary-button compact" disabled={busy}
                onClick={()=>void support(property.id)}>Dar soporte</button>
            </div>)}</div>
        </>}
      </div>
    </div>
    </>}
  </section>;
}
