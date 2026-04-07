import { Platform } from 'react-native';
import { getBackendBaseUrl } from './backendUrl';

function normalizeBackendUrl(url?: string): string {
  return getBackendBaseUrl(url);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isWebPushSupported(): boolean {
  if (Platform.OS !== 'web') return false;
  if (typeof window === 'undefined') return false;

  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function subscribeBarberToWebPush(
  backendUrl?: string,
  shopId?: string | null,
  barberId?: string | null
): Promise<boolean> {
  try {
    const normalizedUrl = normalizeBackendUrl(backendUrl);
    if (!isWebPushSupported()) return false;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    if (!navigator.serviceWorker.controller) {
      await navigator.serviceWorker.register('/sw.js');
    }

    const registration = await navigator.serviceWorker.ready;
    const keyRes = await fetch(`${normalizedUrl}/api/push/vapid-public-key`);
    if (!keyRes.ok) return false;

    const { publicKey } = await keyRes.json();
    const applicationServerKey = urlBase64ToUint8Array(publicKey) as unknown as BufferSource;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    const subJson = subscription.toJSON();
    const saveRes = await fetch(`${normalizedUrl}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
        userType: 'barber',
        shopId: shopId || null,
        barberId: barberId || null,
      }),
    });

    return saveRes.ok;
  } catch (error) {
    console.error('Web push subscription failed:', error);
    return false;
  }
}
