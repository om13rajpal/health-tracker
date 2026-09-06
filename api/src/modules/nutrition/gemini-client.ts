export type GeminiClient = {
  generateContent(prompt: string): Promise<string>;
  generateContentWithImage(prompt: string, imageBase64: string): Promise<string>;
};

// Real implementation, wired in nutrition.routes.ts — not exercised by unit
// tests, which inject a fake GeminiClient instead. Verify the exact current
// Gemini REST endpoint/model name against https://ai.google.dev/gemini-api/docs
// at execution time before treating "gemini-2.0-flash" below as final; the
// GeminiClient interface it implements is what matters for the rest of this
// task and is stable regardless of which model name is current.
export function createGeminiClient(apiKey: string): GeminiClient {
  return {
    async generateContent(prompt: string): Promise<string> {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
      );
      if (!response.ok) {
        throw new Error(`Gemini API request failed: ${response.status}`);
      }
      const data = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error("Gemini API returned no content");
      }
      return text;
    },
    async generateContentWithImage(prompt: string, imageBase64: string): Promise<string> {
      // Same caveat as above: verify the exact current Gemini multimodal
      // request shape against https://ai.google.dev/gemini-api/docs at
      // execution time — the inline_data/mime_type field names below are
      // illustrative of the general pattern, not guaranteed byte-exact for
      // whatever API version is current when this task is implemented.
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              { parts: [{ text: prompt }, { inline_data: { mime_type: "image/jpeg", data: imageBase64 } }] },
            ],
          }),
        }
      );
      if (!response.ok) {
        throw new Error(`Gemini API request failed: ${response.status}`);
      }
      const data = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error("Gemini API returned no content");
      }
      return text;
    },
  };
}
