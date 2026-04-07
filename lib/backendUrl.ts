import Constants from 'expo-constants';
import { Platform } from 'react-native';

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8000';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function getExpoHost(): string | null {
  const hostUri = (Constants as any)?.expoConfig?.hostUri;
  if (typeof hostUri === 'string' && hostUri.length > 0) {
    return hostUri.split(':')[0] || null;
  }

  const debuggerHost = (Constants as any)?.manifest2?.extra?.expoGo?.debuggerHost;
  if (typeof debuggerHost === 'string' && debuggerHost.length > 0) {
    return debuggerHost.split(':')[0] || null;
  }

  return null;
}

export function getBackendBaseUrl(url?: string): string {
  const source = url || process.env.EXPO_PUBLIC_BACKEND_URL;
  if (source && source.trim().length > 0) {
    return trimTrailingSlash(source.trim());
  }

  if (Platform.OS === 'android') {
    return DEFAULT_BACKEND_URL;
  }

  const host = getExpoHost();
  if (host) {
    return `http://${host}:8000`;
  }

  return DEFAULT_BACKEND_URL;
}