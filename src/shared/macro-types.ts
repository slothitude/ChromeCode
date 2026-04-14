export interface ElementTarget {
  selector: string;
  tagName: string;
  boundingRect?: { top: number; left: number; width: number; height: number };
}

export interface MacroStep {
  type: "click" | "dblclick" | "keydown" | "input" | "scroll";
  target?: ElementTarget;
  timestamp: number;
  mouseX?: number;
  mouseY?: number;
  button?: number;
  key?: string;
  code?: string;
  scrollX?: number;
  scrollY?: number;
  inputValue?: string;
}

export interface Macro {
  id: string;
  name: string;
  url: string;
  createdAt: number;
  durationMs: number;
  steps: MacroStep[];
}

export const MACRO_STORAGE_KEY = "cc_macros";
