export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function streamCompletion(messages: Message[], onChunk: (text: string) => void) {
  const settings = await chrome.storage.local.get(["apiKey", "baseUrl", "modelId"]);
  
  const apiKey = settings.apiKey || "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";
  const baseUrl = settings.baseUrl || "https://integrate.api.nvidia.com/v1";
  const modelId = settings.modelId || "minimaxai/minimax-m2.7";

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: modelId,
      messages: messages,
      temperature: 1,
      top_p: 0.95,
      max_tokens: 8192,
      stream: true
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${error}`);
  }

  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n");
    
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") break;
        try {
          const json = JSON.parse(data);
          const content = json.choices[0]?.delta?.content;
          if (content) onChunk(content);
        } catch (e) {}
      }
    }
  }
}
