export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

import { getActiveProvider } from "../shared/provider-storage.js";

export async function streamCompletion(messages: Message[], onChunk: (text: string) => void) {
  const provider = await getActiveProvider();

  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${provider.apiKey}`
    },
    body: JSON.stringify({
      model: provider.modelId,
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
