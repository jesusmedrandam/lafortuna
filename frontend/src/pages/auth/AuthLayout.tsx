import { Outlet } from 'react-router-dom';
import { ShieldCheck, Sparkles, Wifi } from 'lucide-react';

export function AuthLayout() {
  return (
    <main className="auth-layout">
      <section className="auth-brand-panel">
        <div className="auth-brand">
          <span className="auth-logo-surface"><img src="/branding/logo-sgb-full.png" alt="Sistema de Gestión Bovina" /></span>
        </div>
        <div className="auth-copy">
          <span className="eyebrow">Sistema de Gestión Bovina</span>
          <h2>La información de tu finca, organizada y disponible.</h2>
          <p>Animales, grupos, potreros, corrales, sanidad y producción en un mismo sistema.</p>
        </div>
        <div className="auth-features">
          <div><ShieldCheck size={20} /><span>Acceso por roles y permisos</span></div>
          <div><Wifi size={20} /><span>Servidor conectado a tu nueva base</span></div>
          <div><Sparkles size={20} /><span>Diseño adaptable a celular y computador</span></div>
        </div>
      </section>
      <section className="auth-form-panel"><Outlet /></section>
    </main>
  );
}
