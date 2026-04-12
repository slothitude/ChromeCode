const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
const baseUrlInput = document.getElementById('base-url') as HTMLInputElement;
const modelIdInput = document.getElementById('model-id') as HTMLInputElement;
const saveBtn = document.getElementById('save')!;
const statusDiv = document.getElementById('status')!;

// Load current settings
chrome.storage.local.get(['apiKey', 'baseUrl', 'modelId'], (settings) => {
  if (settings.apiKey) apiKeyInput.value = settings.apiKey;
  if (settings.baseUrl) baseUrlInput.value = settings.baseUrl;
  if (settings.modelId) modelIdInput.value = settings.modelId;
});

saveBtn.addEventListener('click', () => {
  chrome.storage.local.set({
    apiKey: apiKeyInput.value,
    baseUrl: baseUrlInput.value,
    modelId: modelIdInput.value
  }, () => {
    statusDiv.textContent = 'Settings saved!';
    setTimeout(() => {
      statusDiv.textContent = '';
    }, 2000);
  });
});
