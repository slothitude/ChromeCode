import { Macro, MACRO_STORAGE_KEY } from "./macro-types.js";

export async function getAllMacros(): Promise<Macro[]> {
  const result = await chrome.storage.local.get(MACRO_STORAGE_KEY);
  return (result[MACRO_STORAGE_KEY] as Macro[]) || [];
}

async function saveAllMacros(macros: Macro[]): Promise<void> {
  await chrome.storage.local.set({ [MACRO_STORAGE_KEY]: macros });
}

export async function saveMacro(macro: Macro): Promise<void> {
  const macros = await getAllMacros();
  const idx = macros.findIndex((m) => m.id === macro.id);
  if (idx >= 0) {
    macros[idx] = macro;
  } else {
    macros.push(macro);
  }
  await saveAllMacros(macros);
}

export async function deleteMacro(id: string): Promise<void> {
  const macros = await getAllMacros();
  await saveAllMacros(macros.filter((m) => m.id !== id));
}

export async function renameMacro(id: string, name: string): Promise<void> {
  const macros = await getAllMacros();
  const macro = macros.find((m) => m.id === id);
  if (macro) {
    macro.name = name;
    await saveAllMacros(macros);
  }
}
