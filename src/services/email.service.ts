import { env } from '../config/env.js';

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, character => ({
    '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;',
  })[character] ?? character);
}

export async function sendCodeEmail(to: string, code: string, purpose: 'ACTIVACION' | 'RESTABLECER_PASSWORD') {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
    if (env.NODE_ENV !== 'production') console.log(`[Correo simulado] ${purpose} para ${to}: ${code}`);
    return;
  }
  const activation = purpose === 'ACTIVACION';
  const subject = activation ? 'Activa tu cuenta de SGB' : 'Restablece tu contraseña de SGB';
  const title = activation ? 'Activa tu cuenta' : 'Restablece tu contraseña';
  const explanation = activation
    ? 'Usa este código para verificar tu correo y completar la activación de tu cuenta.'
    : 'Recibimos una solicitud para cambiar la contraseña de tu cuenta.';
  const appName = escapeHtml(env.APP_NAME || 'SGB · Sistema de Gestión Bovina');
  const safeCode = escapeHtml(code);
  const htmlContent = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#f0f5f2;color:#173129;font-family:Arial,Helvetica,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f0f5f2;padding:28px 12px"><tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dbe8e1;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(16,61,45,.10)">
        <tr><td style="background:#0d3b2e;padding:25px 32px;color:#ffffff"><div style="font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#8ee0b8">Sistema ganadero</div><div style="font-size:25px;font-weight:700;margin-top:6px">${appName}</div></td></tr>
        <tr><td style="padding:34px 32px 18px"><h1 style="margin:0 0 12px;font-size:25px;color:#173129">${title}</h1><p style="margin:0;color:#60766e;line-height:1.65;font-size:15px">${explanation}</p></td></tr>
        <tr><td style="padding:10px 32px 24px"><div style="background:#eaf8f0;border:1px solid #bfe8cf;border-radius:16px;padding:23px;text-align:center"><div style="font-size:12px;text-transform:uppercase;letter-spacing:1.4px;color:#497366;margin-bottom:10px">Código de seguridad</div><div style="font-size:34px;font-weight:800;letter-spacing:9px;color:#137a4e">${safeCode}</div></div></td></tr>
        <tr><td style="padding:0 32px 34px"><p style="margin:0 0 12px;color:#405b52;line-height:1.6;font-size:14px"><strong>El código caduca en 15 minutos.</strong></p><p style="margin:0;color:#71857e;line-height:1.6;font-size:13px">Si no solicitaste esta acción, ignora este correo. No compartas el código con otras personas.</p></td></tr>
        <tr><td style="border-top:1px solid #e6eee9;padding:18px 32px;color:#85968f;font-size:12px;text-align:center">Mensaje automático de SGB · Sistema de Gestión Bovina</td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
  const textContent = `${title}\n\n${explanation}\n\nCódigo: ${code}\n\nCaduca en 15 minutos. No compartas este código.\n\nSGB · Sistema de Gestión Bovina`;
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-key': env.BREVO_API_KEY },
    body: JSON.stringify({ sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME }, to: [{ email: to }], subject, htmlContent, textContent })
  });
  if (!response.ok) throw new Error(`Brevo respondió ${response.status}: ${await response.text()}`);
}
