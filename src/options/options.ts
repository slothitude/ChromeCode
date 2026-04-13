import {
  migrateProviders, getAllProviders, saveProviders,
  setActiveProvider, deleteProvider, createProvider,
  ProviderConfig,
} from "../shared/provider-storage.js";

const listEl = document.getElementById("provider-list")!;
const addBtn = document.getElementById("add-btn")!;
const editPanel = document.getElementById("edit-panel")!;
const editName = document.getElementById("edit-name") as HTMLInputElement;
const editApikey = document.getElementById("edit-apikey") as HTMLInputElement;
const editBaseurl = document.getElementById("edit-baseurl") as HTMLInputElement;
const editModelid = document.getElementById("edit-modelid") as HTMLInputElement;
const editSave = document.getElementById("edit-save")!;
const editCancel = document.getElementById("edit-cancel")!;
const statusDiv = document.getElementById("status")!;

let editingId: string | null = null; // null = adding new

function showStatus(msg: string) {
  statusDiv.textContent = msg;
  setTimeout(() => { statusDiv.textContent = ""; }, 2000);
}

function renderProviderList(providers: ProviderConfig[], activeId: string) {
  listEl.innerHTML = "";
  for (const p of providers) {
    const row = document.createElement("div");
    row.className = "provider-row" + (p.id === activeId ? " active" : "");

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "active-provider";
    radio.checked = p.id === activeId;
    radio.addEventListener("change", () => handleSetActive(p.id));

    const nameSpan = document.createElement("span");
    nameSpan.className = "provider-name";
    nameSpan.textContent = p.name;

    const modelSpan = document.createElement("span");
    modelSpan.className = "provider-model";
    modelSpan.textContent = p.modelId;

    const editBtn = document.createElement("button");
    editBtn.className = "btn-icon";
    editBtn.textContent = "\u270E";
    editBtn.title = "Edit";
    editBtn.addEventListener("click", () => openEditPanel(p));

    const delBtn = document.createElement("button");
    delBtn.className = "btn-icon delete";
    delBtn.textContent = "\u2715";
    delBtn.title = "Delete";
    delBtn.addEventListener("click", () => handleDelete(p.id));

    row.append(radio, nameSpan, modelSpan, editBtn, delBtn);
    listEl.appendChild(row);
  }
}

function openEditPanel(provider?: ProviderConfig) {
  editingId = provider?.id ?? null;
  editName.value = provider?.name ?? "New Provider";
  editApikey.value = provider?.apiKey ?? "";
  editBaseurl.value = provider?.baseUrl ?? "https://integrate.api.nvidia.com/v1";
  editModelid.value = provider?.modelId ?? "minimaxai/minimax-m2.7";
  editPanel.classList.add("open");
  editName.focus();
}

function closeEditPanel() {
  editingId = null;
  editPanel.classList.remove("open");
}

async function handleSave() {
  const name = editName.value.trim();
  if (!name) { showStatus("Name is required"); return; }

  const { providers, activeProviderId } = await getAllProviders();

  const config: ProviderConfig = {
    id: editingId ?? createProvider().id,
    name,
    apiKey: editApikey.value,
    baseUrl: editBaseurl.value,
    modelId: editModelid.value,
  };

  let updated: ProviderConfig[];
  if (editingId) {
    updated = providers.map(p => p.id === editingId ? config : p);
  } else {
    updated = [...providers, config];
  }

  const newActiveId = editingId ? activeProviderId : config.id;
  await saveProviders(updated, newActiveId);
  closeEditPanel();
  renderProviderList(updated, newActiveId);
  showStatus(editingId ? "Provider updated" : "Provider added");
}

async function handleDelete(id: string) {
  try {
    await deleteProvider(id);
    const { providers, activeProviderId } = await getAllProviders();
    renderProviderList(providers, activeProviderId);
    showStatus("Provider deleted");
  } catch (e: any) {
    showStatus(e.message);
  }
}

async function handleSetActive(id: string) {
  await setActiveProvider(id);
  const { providers, activeProviderId } = await getAllProviders();
  renderProviderList(providers, activeProviderId);
}

addBtn.addEventListener("click", () => openEditPanel());
editCancel.addEventListener("click", closeEditPanel);
editSave.addEventListener("click", handleSave);

// Init
(async () => {
  await migrateProviders();
  const { providers, activeProviderId } = await getAllProviders();
  renderProviderList(providers, activeProviderId);
})();
