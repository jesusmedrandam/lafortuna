export interface AuthenticatedUser {
  id: string;
  correo: string;
  nombres: string;
  apellidos: string;
  fotoPerfilUrl: string | null;
  roles: string[];
  permissions: string[];
  sessionVersion: number;
}
