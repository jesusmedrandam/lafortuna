import { env } from '../config/env.js';
export async function sendCodeEmail(to, code, purpose) {
    if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
        if (env.NODE_ENV !== 'production')
            console.log(`[Correo simulado] ${purpose} para ${to}: ${code}`);
        return;
    }
    const subject = purpose === 'ACTIVACION' ? 'Activa tu cuenta de M&M Ganadería' : 'Código para restablecer tu contraseña';
    const htmlContent = `<div style="font-family:Arial,sans-serif"><h2>${env.APP_NAME}</h2><p>Tu código es:</p><p style="font-size:30px;font-weight:bold;letter-spacing:6px">${code}</p><p>Caduca en 15 minutos.</p></div>`;
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'api-key': env.BREVO_API_KEY },
        body: JSON.stringify({ sender: { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME }, to: [{ email: to }], subject, htmlContent })
    });
    if (!response.ok)
        throw new Error(`Brevo respondió ${response.status}: ${await response.text()}`);
}
//# sourceMappingURL=email.service.js.map