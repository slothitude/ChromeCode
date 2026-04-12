async function testLiveEdit() {
  const apiKey = "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";
  const baseUrl = "https://integrate.api.nvidia.com/v1";
  const modelId = "minimaxai/minimax-m2.7";

  const systemPrompt = `You are ChromeCode, a browser-based coding agent.
You can see the user's active tab.
To perform a "Live Edit" on the page, provide your JavaScript code within a block starting with:
\`\`\`javascript:cc_live_edit
// your code
\`\`\`
The code will be injected into the user's tab. Use standard DOM APIs.`;

  const userPrompt = "Go to wikipedia.org and change the main heading to 'Baloon'o'pedia'.";

  console.log("--- SIMULATING CHROMECODE INTERACTION ---");
  console.log("User:", userPrompt);
  
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.1 // Low temperature for consistent code generation
      })
    });

    const json = await response.json();
    const reply = json.choices[0].message.content;
    
    console.log("\nAssistant Reply:");
    console.log(reply);

    if (reply.includes("```javascript:cc_live_edit")) {
      console.log("\n✅ SUCCESS: Agent generated the live-edit block!");
    } else {
      console.log("\n❌ FAILED: Agent did not generate the block.");
    }
  } catch (err) {
    console.error("Test Error:", err);
  }
}

testLiveEdit();
