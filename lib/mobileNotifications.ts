import { Platform, Alert, Linking } from 'react-native';
import { getBackendBaseUrl } from './backendUrl';

export type NotificationUserType = 'barber' | 'customer';

export interface RegisterMobilePushPayload {
  userType: NotificationUserType;
  shopId?: string | null;
  barberId?: string | null;
  entryId?: string | null;
  backendUrl?: string;
}

export interface MobilePushResult {
  success: boolean;
  token?: string;
  reason?: string;
}

let messagingModule: any = null;

async function getMessaging() {
  if (messagingModule) return messagingModule;
  try {
    const mod = await import('@react-native-firebase/messaging');
    messagingModule = mod.default;
    console.log('[FCM] Firebase messaging module loaded');
    return messagingModule;
  } catch (e) {
    console.error('[FCM] Failed to load @react-native-firebase/messaging:', e);
    return null;
  }
}

function normalizeBackendUrl(url?: string): string {
  return getBackendBaseUrl(url);
}

let backgroundHandlerSet = false;
let foregroundHandlerSet = false;

export async function ensureForegroundNotificationHandler() {
  if (Platform.OS === 'web' || foregroundHandlerSet) return;

  const firebaseMessaging = await getMessaging();
  if (!firebaseMessaging) return;

  firebaseMessaging().onMessage(async (remoteMessage: any) => {
    const title = remoteMessage?.notification?.title || 'My Salon Time';
    const body = remoteMessage?.notification?.body || '';
    console.log('[FCM] >>> FOREGROUND message received:', JSON.stringify({
      title, body, data: remoteMessage?.data,
    }));

    // Show an alert so the user sees the notification while app is open
    Alert.alert(title, body);
  });

  // Background / quit state handler - MUST be set at top level
  if (!backgroundHandlerSet) {
    firebaseMessaging().setBackgroundMessageHandler(async (remoteMessage: any) => {
      console.log('[FCM] >>> BACKGROUND message received:', JSON.stringify({
        title: remoteMessage?.notification?.title,
        body: remoteMessage?.notification?.body,
        data: remoteMessage?.data,
      }));
    });
    backgroundHandlerSet = true;
    console.log('[FCM] Background message handler configured');
  }

  foregroundHandlerSet = true;
  console.log('[FCM] Foreground message handler configured');
}

export async function configureAndroidNotificationChannel() {
  if (Platform.OS !== 'android') return;

  try {
    // react-native-firebase handles channel creation via AndroidManifest
    // but we can create one programmatically via notifee if needed
    console.log('[FCM] Android notification channel: using default channel from AndroidManifest');
  } catch (e) {
    console.error('[FCM] Channel setup error:', e);
  }
}

/**
 * Check notification permission on every app launch.
 * If not granted, shows the native OS permission dialog.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const firebaseMessaging = await getMessaging();
  if (!firebaseMessaging) {
    console.warn('[FCM] requestNotificationPermission: messaging module not available');
    return false;
  }

  try {
    // Check current permission status
    const hasPermission = await firebaseMessaging().hasPermission();
    console.log(`[FCM] Current notification permission status: ${hasPermission}`);
    // hasPermission returns:
    //  -1 = NOT_DETERMINED (never asked)
    //   0 = DENIED
    //   1 = AUTHORIZED
    //   2 = PROVISIONAL

    if (hasPermission === 1 || hasPermission === 2) {
      console.log('[FCM] Notification permission already granted');
      return true;
    }

    // If denied (0), on Android the OS won't show the permission dialog again.
    // We must direct the user to the app's notification settings.
    if (hasPermission === 0 && Platform.OS === 'android') {
      console.log('[FCM] Permission previously denied, prompting user to open settings...');
      Alert.alert(
        'Notifications Disabled',
        'Notifications are turned off for this app. Please enable them in your device settings to receive queue updates.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open Settings',
            onPress: () => Linking.openSettings(),
          },
        ],
      );
      return false;
    }

    // Not determined yet — show native permission dialog
    console.log('[FCM] Requesting notification permission from user...');
    const authStatus = await firebaseMessaging().requestPermission();
    const granted = authStatus === 1 || authStatus === 2;
    console.log(`[FCM] Permission dialog result: ${authStatus}, granted: ${granted}`);

    if (!granted) {
      console.warn('[FCM] User denied notification permission');
      if (Platform.OS === 'android') {
        Alert.alert(
          'Notifications Disabled',
          'You denied notification permission. To receive queue updates, please enable notifications in your device settings.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Open Settings',
              onPress: () => Linking.openSettings(),
            },
          ],
        );
      }
    }

    return granted;
  } catch (e) {
    console.error('[FCM] Error checking/requesting notification permission:', e);
    return false;
  }
}

async function registerDeviceWithBackend(payload: {
  token: string;
  userType: NotificationUserType;
  shopId?: string | null;
  barberId?: string | null;
  entryId?: string | null;
  backendUrl?: string;
}): Promise<boolean> {
  const backendUrl = normalizeBackendUrl(payload.backendUrl);
  const url = `${backendUrl}/api/notifications/register-device`;

  console.log(`[FCM] Registering device with backend: ${url}`);
  console.log(`[FCM] Payload: userType=${payload.userType}, shopId=${payload.shopId}, entryId=${payload.entryId}`);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: payload.token,
        platform: Platform.OS,
        userType: payload.userType,
        shopId: payload.shopId || null,
        barberId: payload.barberId || null,
        entryId: payload.entryId || null,
        enabled: true,
      }),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error(`[FCM] Backend rejected registration: ${res.status} ${errorBody}`);
      return false;
    }

    const data = await res.json();
    console.log('[FCM] Backend registration success:', JSON.stringify(data));
    return true;
  } catch (error) {
    console.error('[FCM] Network error registering device:', error);
    return false;
  }
}

export async function registerMobilePushDevice(payload: RegisterMobilePushPayload): Promise<MobilePushResult> {
  console.log('[FCM] === Starting push registration ===');
  console.log(`[FCM] userType=${payload.userType}, shopId=${payload.shopId}, entryId=${payload.entryId}, platform=${Platform.OS}`);

  if (Platform.OS === 'web') {
    console.log('[FCM] Skipping: web platform');
    return { success: false, reason: 'web-platform' };
  }

  const firebaseMessaging = await getMessaging();
  if (!firebaseMessaging) {
    console.error('[FCM] Firebase messaging module not available');
    return { success: false, reason: 'firebase-messaging-unavailable' };
  }

  // Make sure foreground + background handlers are wired up
  await ensureForegroundNotificationHandler();

  // Request permission
  console.log('[FCM] Requesting notification permission...');
  try {
    const authStatus = await firebaseMessaging().requestPermission();
    const enabled =
      authStatus === 1 || // AUTHORIZED
      authStatus === 2;   // PROVISIONAL
    console.log(`[FCM] Permission status: ${authStatus}, enabled: ${enabled}`);

    if (!enabled) {
      console.warn('[FCM] Notification permission denied');
      return { success: false, reason: 'permission-denied' };
    }
  } catch (e) {
    console.error('[FCM] Permission request failed:', e);
    return { success: false, reason: 'permission-failed' };
  }

  // Get FCM token
  console.log('[FCM] Getting FCM token...');
  let fcmToken = '';
  let retries = 3;
  while (retries > 0) {
    try {
      fcmToken = await firebaseMessaging().getToken();
      if (fcmToken) {
        console.log(`[FCM] Token acquired: ${fcmToken.substring(0, 20)}...${fcmToken.substring(fcmToken.length - 10)}`);
        break;
      }
    } catch (error) {
      console.warn(`[FCM] Failed to get FCM token (retries left: ${retries - 1}):`, error);
      retries--;
      if (retries === 0) {
        console.error('[FCM] Exhausted all retries for FCM token');
        return { success: false, reason: 'token-fetch-failed' };
      }
      await new Promise(r => setTimeout(r, 2000)); // Wait 2s before retry
    }
  }

  if (!fcmToken) {
    console.error('[FCM] FCM token is empty');
    return { success: false, reason: 'token-missing' };
  }

  // Register with backend
  const registered = await registerDeviceWithBackend({
    token: fcmToken,
    userType: payload.userType,
    shopId: payload.shopId,
    barberId: payload.barberId,
    entryId: payload.entryId,
    backendUrl: payload.backendUrl,
  });

  if (!registered) {
    console.error('[FCM] Backend registration failed');
    return { success: false, reason: 'backend-register-failed', token: fcmToken };
  }

  console.log('[FCM] === Push registration completed successfully ===');
  return { success: true, token: fcmToken };
}

export async function unregisterMobilePushDevice(token: string, backendUrl?: string): Promise<boolean> {
  const normalizedUrl = normalizeBackendUrl(backendUrl);
  if (!token) {
    console.warn('[FCM] Skipping unregister: no token');
    return false;
  }

  console.log(`[FCM] Unregistering device token: ${token.substring(0, 20)}...`);

  try {
    const res = await fetch(`${normalizedUrl}/api/notifications/unregister-device`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    console.log(`[FCM] Unregister response: ${res.status}`);
    return res.ok;
  } catch (error) {
    console.error('[FCM] Unregister network error:', error);
    return false;
  }
}
