import AsyncStorage from '@react-native-async-storage/async-storage';

const DEVICE_ID_KEY = '@device_id';
let cached: string | null = null;

// RFC4122-ish v4 id. Math.random is fine here — this is a per-install handle used
// for booking dedup, not a security token.
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Stable per-install identifier, persisted in AsyncStorage. Sent with queue joins so
 * the backend can enforce "one active ticket per shop, at most two shops at a time".
 */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    let id = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = generateId();
      await AsyncStorage.setItem(DEVICE_ID_KEY, id);
    }
    cached = id;
    return id;
  } catch {
    // Storage unavailable — fall back to an in-memory id so dedup still works this session.
    if (!cached) cached = generateId();
    return cached;
  }
}
