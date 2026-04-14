// Shared protocol types for Bridge ↔ Extension communication.
// Pure interfaces — no runtime code.

export type DirectOperation =
  | "tab.content"
  | "tab.screenshot"
  | "tab.execute"
  | "tab.evaluate"
  | "macro.list"
  | "macro.play"
  | "macro.record_start"
  | "macro.record_stop"
  | "macro.delete"
  | "macro.demo"
  | "recording.start"
  | "recording.stop"
  | "recording.status";

// --- Bridge → Extension messages ---

export interface RemotePromptMessage {
  type: "REMOTE_PROMPT";
  text: string;
  requestId?: string;
}

export interface DirectRequestMessage {
  type: "DIRECT_REQUEST";
  requestId: string;
  operation: DirectOperation;
  params?: Record<string, any>;
}

// --- Extension → Bridge messages ---

export interface AgentEventMessage {
  type: "AGENT_EVENT";
  event: { type: string; delta?: string; [key: string]: any };
  requestId?: string;
}

export interface DirectResponseMessage {
  type: "DIRECT_RESPONSE";
  requestId: string;
  success: boolean;
  data?: any;
  error?: string;
}

export interface ErrorMessage {
  type: "ERROR";
  message: string;
  requestId?: string;
}

// Union for convenience
export type BridgeToExtension = RemotePromptMessage | DirectRequestMessage;
export type ExtensionToBridge = AgentEventMessage | DirectResponseMessage | ErrorMessage;
