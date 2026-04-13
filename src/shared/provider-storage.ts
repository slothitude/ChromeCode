export interface ProviderConfig {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  modelId: string;
}

const DEFAULT_API_KEY = "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";
const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL_ID = "minimaxai/minimax-m2.7";

function generateId(): string {
  return crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function createProvider(overrides?: Partial<ProviderConfig>): ProviderConfig {
  return {
    id: generateId(),
    name: "New Provider",
    apiKey: "",
    baseUrl: DEFAULT_BASE_URL,
    modelId: DEFAULT_MODEL_ID,
    ...overrides,
  };
}

export async function migrateProviders(): Promise<void> {
  const data = await chrome.storage.local.get(["providers", "activeProviderId", "apiKey", "baseUrl", "modelId"]);

  // Already migrated
  if (Array.isArray(data.providers) && data.providers.length > 0) return;

  // Migrate from flat keys
  const migrated = createProvider({
    name: "Default",
    apiKey: data.apiKey || DEFAULT_API_KEY,
    baseUrl: data.baseUrl || DEFAULT_BASE_URL,
    modelId: data.modelId || DEFAULT_MODEL_ID,
  });

  await chrome.storage.local.set({
    providers: [migrated],
    activeProviderId: migrated.id,
  });

  // Clean up old keys
  await chrome.storage.local.remove(["apiKey", "baseUrl", "modelId"]);
}

export async function getAllProviders(): Promise<{ providers: ProviderConfig[]; activeProviderId: string }> {
  const data = await chrome.storage.local.get(["providers", "activeProviderId"]);
  return {
    providers: (data.providers as ProviderConfig[]) || [],
    activeProviderId: (data.activeProviderId as string) || "",
  };
}

export async function getActiveProvider(): Promise<ProviderConfig> {
  await migrateProviders();
  const { providers, activeProviderId } = await getAllProviders();
  return providers.find(p => p.id === activeProviderId) || providers[0] || createProvider({
    name: "Default",
    apiKey: DEFAULT_API_KEY,
    baseUrl: DEFAULT_BASE_URL,
    modelId: DEFAULT_MODEL_ID,
  });
}

export async function saveProviders(providers: ProviderConfig[], activeProviderId: string): Promise<void> {
  await chrome.storage.local.set({ providers, activeProviderId });
}

export async function setActiveProvider(id: string): Promise<void> {
  await chrome.storage.local.set({ activeProviderId: id });
}

export async function deleteProvider(id: string): Promise<void> {
  const { providers, activeProviderId } = await getAllProviders();
  if (providers.length <= 1) throw new Error("Cannot delete the last provider");

  const filtered = providers.filter(p => p.id !== id);
  const newActiveId = activeProviderId === id ? filtered[0].id : activeProviderId;
  await saveProviders(filtered, newActiveId);
}
