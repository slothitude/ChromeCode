import { AuthStorageBackend } from "@mariozechner/pi-coding-agent";

export class ChromeAuthStorageBackend implements AuthStorageBackend {
  async withLockAsync<T>(fn: (current: string | undefined) => Promise<{ result: T; next?: string }>): Promise<T> {
    const data = await chrome.storage.local.get("pi_auth");
    const { result, next } = await fn(data.pi_auth);
    if (next !== undefined) {
      await chrome.storage.local.set({ pi_auth: next });
    }
    return result;
  }

  withLock<T>(fn: (current: string | undefined) => { result: T; next?: string }): T {
    // Chrome storage is async, but pi-mono expects sync in some places.
    // For the extension, we'll try to use the async version everywhere,
    // but if pi-mono calls sync, we might need a workaround or just throw.
    throw new Error("Sync lock not supported in Chrome extension");
  }
}

export class ChromeSettingsStorage {
  async withLock(scope: string, fn: (current: string | undefined) => string | undefined) {
    const key = `pi_settings_${scope}`;
    const data = await chrome.storage.local.get(key);
    const next = fn(data[key]);
    if (next !== undefined) {
      await chrome.storage.local.set({ [key]: next });
    }
  }
}
