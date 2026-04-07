import AsyncStorage from '@react-native-async-storage/async-storage';

const NOTIFICATION_DEBUG_KEY = '@notification_debug_logs_v1';
const MAX_STORED_LOGS = 80;

export type NotificationLogLevel = 'info' | 'warn' | 'error';

export interface NotificationDebugEntry {
  id: string;
  timestamp: string;
  level: NotificationLogLevel;
  message: string;
  details?: string;
}

function stringifyDetails(details: unknown): string | undefined {
  if (details === undefined || details === null) {
    return undefined;
  }

  if (typeof details === 'string') {
    return details;
  }

  try {
    return JSON.stringify(details);
  } catch {
    return String(details);
  }
}

async function readStoredLogs(): Promise<NotificationDebugEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(NOTIFICATION_DEBUG_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is NotificationDebugEntry => {
      return !!entry && typeof entry === 'object' && typeof entry.message === 'string';
    });
  } catch {
    return [];
  }
}

export async function appendNotificationDebugLog(
  message: string,
  options?: { level?: NotificationLogLevel; details?: unknown }
): Promise<void> {
  try {
    const level = options?.level || 'info';
    const entry: NotificationDebugEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      level,
      message,
      details: stringifyDetails(options?.details),
    };

    const logs = await readStoredLogs();
    const nextLogs = [entry, ...logs].slice(0, MAX_STORED_LOGS);
    await AsyncStorage.setItem(NOTIFICATION_DEBUG_KEY, JSON.stringify(nextLogs));
  } catch {
    // Intentionally ignored so notification flow is never blocked by debug logging.
  }
}

export async function getNotificationDebugLogs(limit = 20): Promise<NotificationDebugEntry[]> {
  const logs = await readStoredLogs();
  return logs.slice(0, Math.max(1, limit));
}

export async function clearNotificationDebugLogs(): Promise<void> {
  try {
    await AsyncStorage.removeItem(NOTIFICATION_DEBUG_KEY);
  } catch {
    // Intentionally ignored.
  }
}
