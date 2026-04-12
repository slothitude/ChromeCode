async function testApi() {
  const apiKey = "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";
  const baseUrl = "https://integrate.api.nvidia.com/v1";
  const modelId = "minimaxai/minimax-m2.7";

  console.log("Testing ChromeCode Brain (NVIDIA API)...");
  
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: "user", content: "Hello ChromeCode! Who are you?" }],
        max_tokens: 50
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("API Error:", err);
      return;
    }

    const json = await response.json();
    console.log("Response from NVIDIA:", json.choices[0].message.content);
    console.log("Test PASSED! The brain is working.");
  } catch (err) {
    console.error("Fetch Error:", err);
  }
}

testApi();
