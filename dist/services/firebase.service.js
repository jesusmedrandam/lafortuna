import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '../config/env.js';
let messaging;
let configurationWarningShown = false;
export function firebaseMessaging() {
    if (messaging !== undefined)
        return messaging;
    if (!env.FIREBASE_PROJECT_ID || !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        messaging = null;
        if (!configurationWarningShown) {
            configurationWarningShown = true;
            console.warn('Firebase push deshabilitado: faltan FIREBASE_PROJECT_ID o GOOGLE_APPLICATION_CREDENTIALS.');
        }
        return null;
    }
    const app = getApps()[0] ?? initializeApp({
        credential: applicationDefault(),
        projectId: env.FIREBASE_PROJECT_ID,
    });
    messaging = getMessaging(app);
    return messaging;
}
//# sourceMappingURL=firebase.service.js.map