import type { NotificationItem } from '../settings/settings.types';

export type BrowserNotificationSupport = 'UNSUPPORTED' | NotificationPermission;

export const browserNotificationSupport = (): BrowserNotificationSupport =>
  typeof window === 'undefined' || !('Notification' in window) ? 'UNSUPPORTED' : Notification.permission;

export async function requestBrowserNotifications(): Promise<BrowserNotificationSupport> {
  if (browserNotificationSupport() === 'UNSUPPORTED') return 'UNSUPPORTED';
  return Notification.requestPermission();
}

export async function showBrowserNotification(item: NotificationItem) {
  if (browserNotificationSupport() !== 'granted' || document.visibilityState === 'visible') return false;
  const payload = { title: item.title, body: item.body, tag: `pravia:${item.id}`, url: item.href || '/configuracion/notificaciones' };
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active || navigator.serviceWorker.controller;
    if (worker) { worker.postMessage({ type: 'SHOW_PRAVIA_NOTIFICATION', payload }); return true; }
    await registration.showNotification(payload.title, { body: payload.body, icon: '/icons/pravia-192.png', tag: payload.tag, data: { url: payload.url } });
    return true;
  }
  const notification = new Notification(payload.title, { body: payload.body, icon: '/icons/pravia-192.png', tag: payload.tag });
  notification.onclick = () => { window.focus(); window.location.assign(payload.url); notification.close(); };
  return true;
}
