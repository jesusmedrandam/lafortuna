import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { LoadingState } from '../components/ui';
import { VersionSync } from '../hooks/VersionSync';
import { AppShell } from '../layout/AppShell';
import { LoginPage } from '../pages/auth/LoginPage';
import { RegisterPage } from '../pages/auth/RegisterPage';
import { VerifyPage } from '../pages/auth/VerifyPage';
import { RecoveryPage } from '../pages/auth/RecoveryPage';
import { AuthLayout } from '../pages/auth/AuthLayout';
import { DashboardPage } from '../pages/dashboard/DashboardPage';
import { AnimalsPage } from '../pages/animals/AnimalsPage';
import { AnimalDetailPage } from '../pages/animals/AnimalDetailPage';
import { GroupsPage } from '../pages/groups/GroupsPage';
import { PasturesPage } from '../pages/locations/PasturesPage';
import { CorralsPage } from '../pages/locations/CorralsPage';
import { LocationsPage } from '../pages/locations/LocationsPage';
import { ProfilePage } from '../pages/profile/ProfilePage';
import { UsersPage } from '../pages/admin/UsersPage';
import { RolesPage } from '../pages/admin/RolesPage';
import { AuditPage } from '../pages/admin/AuditPage';
import { ForbiddenPage } from '../pages/shared/ForbiddenPage';
import { NotFoundPage } from '../pages/shared/NotFoundPage';
import { AccessPendingPage } from '../pages/shared/AccessPendingPage';
import { MovementsPage } from '../pages/operations/MovementsPage';
import { SanitaryPage } from '../pages/operations/SanitaryPage';
import { CleaningsPage } from '../pages/operations/CleaningsPage';
import { BirthsPage } from '../pages/reproduction/BirthsPage';
import { ProductionPage } from '../pages/production/ProductionPage';
import { CatalogsPage } from '../pages/catalogs/CatalogsPage';
import { AnimalRecordsPage } from '../pages/records/AnimalRecordsPage';
import { SalesPage } from '../pages/sales/SalesPage';
import { MultimediaPage } from '../pages/multimedia/MultimediaPage';
import { MarksPage } from '../pages/marks/MarksPage';
import { SettingsPage } from '../pages/admin/SettingsPage';

function ProtectedRoot() {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <div className="boot-screen"><img src="/branding/logo-sgb-icon.png" alt="SGB" /><LoadingState text="Recuperando sesión…" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <><VersionSync /><Outlet /></>;
}

function HomePage() {
  const { user, hasPermission } = useAuth();
  if (!user?.roles.length && !user?.permissions.length) return <AccessPendingPage />;
  if (hasPermission('DASHBOARD_CONSULTAR')) return <DashboardPage />;
  return <ForbiddenPage />;
}

function PermissionRoute({ permissions, children }: { permissions: string[]; children: ReactNode }) {
  const { hasPermission } = useAuth();
  return hasPermission(...permissions) ? children : <ForbiddenPage />;
}

export function AppRouter() {
  return <BrowserRouter>
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/registro" element={<RegisterPage />} />
        <Route path="/activar" element={<VerifyPage />} />
        <Route path="/recuperar" element={<RecoveryPage />} />
      </Route>
      <Route element={<ProtectedRoot />}>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="animales" element={<PermissionRoute permissions={['ANIMAL_CONSULTAR']}><AnimalsPage /></PermissionRoute>} />
          <Route path="animales/:id" element={<PermissionRoute permissions={['ANIMAL_CONSULTAR']}><AnimalDetailPage /></PermissionRoute>} />
          <Route path="multimedia" element={<PermissionRoute permissions={['IMAGEN_CONSULTAR']}><MultimediaPage /></PermissionRoute>} />
          <Route path="grupos" element={<PermissionRoute permissions={['GRUPO_CONSULTAR']}><GroupsPage /></PermissionRoute>} />
          <Route path="potreros" element={<PermissionRoute permissions={['POTRERO_CONSULTAR']}><PasturesPage /></PermissionRoute>} />
          <Route path="corrales" element={<PermissionRoute permissions={['CORRAL_CONSULTAR']}><CorralsPage /></PermissionRoute>} />
          <Route path="ubicaciones" element={<PermissionRoute permissions={['UBICACION_CONSULTAR']}><LocationsPage /></PermissionRoute>} />
          <Route path="perfil" element={<ProfilePage />} />
          <Route path="movimientos" element={<PermissionRoute permissions={['MOVIMIENTO_CONSULTAR']}><MovementsPage /></PermissionRoute>} />
          <Route path="sanidad" element={<PermissionRoute permissions={['SANIDAD_CONSULTAR']}><SanitaryPage /></PermissionRoute>} />
          <Route path="limpiezas" element={<PermissionRoute permissions={['LIMPIEZA_CONSULTAR']}><CleaningsPage /></PermissionRoute>} />
          <Route path="partos" element={<PermissionRoute permissions={['PARTO_CONSULTAR', 'ABORTO_CONSULTAR']}><BirthsPage /></PermissionRoute>} />
          <Route path="produccion" element={<PermissionRoute permissions={['PRODUCCION_CONSULTAR', 'LACTANCIA_CONSULTAR']}><ProductionPage /></PermissionRoute>} />
          <Route path="pesajes" element={<PermissionRoute permissions={['PESAJE_CONSULTAR']}><AnimalRecordsPage mode="pesajes" /></PermissionRoute>} />
          <Route path="muertes" element={<PermissionRoute permissions={['MUERTE_CONSULTAR']}><AnimalRecordsPage mode="muertes" /></PermissionRoute>} />
          <Route path="ventas" element={<PermissionRoute permissions={['VENTA_CONSULTAR']}><SalesPage /></PermissionRoute>} />
          <Route path="catalogos" element={<PermissionRoute permissions={['CATALOGO_CONSULTAR']}><CatalogsPage /></PermissionRoute>} />
          <Route path="configuracion" element={<PermissionRoute permissions={['CATALOGO_CONSULTAR']}><SettingsPage /></PermissionRoute>} />
          <Route path="marquillas" element={<PermissionRoute permissions={['CATALOGO_CONSULTAR']}><MarksPage /></PermissionRoute>} />
          <Route path="usuarios" element={<PermissionRoute permissions={['USUARIO_CONSULTAR']}><UsersPage /></PermissionRoute>} />
          <Route path="roles" element={<PermissionRoute permissions={['ROL_CONSULTAR']}><RolesPage /></PermissionRoute>} />
          <Route path="auditoria" element={<PermissionRoute permissions={['AUDITORIA_CONSULTAR']}><AuditPage /></PermissionRoute>} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  </BrowserRouter>;
}
