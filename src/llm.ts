import { GoogleGenerativeAI } from '@google/generative-ai';
import { MODEL_PRICING } from './personas.js';

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type StreamResult = {
  // Async generator yielding text chunks
  stream: AsyncGenerator<string, void, unknown>;
  // Promise that resolves with usage metrics after stream completes
  usage: Promise<{ inputTokens: number; outputTokens: number; costMillis: number; model: string }>;
};

export async function streamChat(params: {
  model: 'gemini-flash' | 'claude-haiku' | 'claude-sonnet' | 'deepseek';
  systemPrompt: string;
  messages: ChatMessage[];
}): Promise<StreamResult> {
  if (params.model === 'gemini-flash') {
    return streamGeminiFlash(params.systemPrompt, params.messages);
  }
  throw new Error(`Model ${params.model} not yet implemented. Current build: Gemini Flash only.`);
}

async function streamGeminiFlash(
  systemPrompt: string,
  messages: ChatMessage[]
): Promise<StreamResult> {
  if (!gemini) throw new Error('GEMINI_API_KEY not configured');

  const model = gemini.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: systemPrompt,
  });

  // Convert our message format → Gemini's
  const history = messages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const latestMessage = messages[messages.length - 1];

  const chat = model.startChat({ history });

  // Estimate input tokens (rough — Gemini API doesn't expose pre-count)
  const inputText = systemPrompt + messages.map(m => m.content).join('\n');
  const estInputTokens = Math.ceil(inputText.length / 4);

  let completeText = '';
  let resolveUsage!: (u: { inputTokens: number; outputTokens: number; costMillis: number; model: string }) => void;
  const usagePromise = new Promise<{ inputTokens: number; outputTokens: number; costMillis: number; model: string }>(
    res => { resolveUsage = res; }
  );

  const stream = (async function* () {
    try {
      const result = await chat.sendMessageStream(latestMessage.content);
      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          completeText += text;
          yield text;
        }
      }
      // After stream done, compute usage
      const response = await result.response;
      const usage = response.usageMetadata;
      const inputTokens = usage?.promptTokenCount ?? estInputTokens;
      const outputTokens = usage?.candidatesTokenCount ?? Math.ceil(completeText.length / 4);
      const pricing = MODEL_PRICING['gemini-flash'];
      // cost in millis (thousandths of a dollar)
      const costMillis = Math.round(
        (inputTokens / 1_000_000) * pricing.input +
        (outputTokens / 1_000_000) * pricing.output
      );
      resolveUsage({ inputTokens, outputTokens, costMillis, model: 'gemini-2.5-flash' });
    } catch (err) {
      console.error('[stream] error', err);
      resolveUsage({ inputTokens: estInputTokens, outputTokens: 0, costMillis: 0, model: 'gemini-2.5-flash' });
      throw err;
    }
  })();

  return { stream, usage: usagePromise };
}


// ════════════════════════════════════════════════════════════════
// IMAGE GENERATION
// ────────────────────────────────────────────────────────────────
// Uses Google's REST API directly (the v0.21 SDK doesn't expose
// responseModalities). Tries Gemini's image-capable model variants
// in order until one succeeds. Returns a base64 data URL ready for
// inline render.
// ════════════════════════════════════════════════════════════════

const IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-2.0-flash-preview-image-generation',
  'gemini-2.0-flash-exp-image-generation',
];

export async function generateImage(params: {
  prompt: string;
  personaName?: string;
  personaStyleHint?: string;
}): Promise<{ dataUrl: string; mimeType: string; bytes: number; model: string; caption: string | null }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  // Optionally augment the prompt with a persona-specific style hint.
  const augmentedPrompt = params.personaStyleHint
    ? `${params.prompt}\n\nStyle: ${params.personaStyleHint}`
    : params.prompt;

  let lastErr: any = new Error('No image models tried');
  for (const model of IMAGE_MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: augmentedPrompt }] }],
          generationConfig: {
            responseModalities: ['IMAGE', 'TEXT'],
          },
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        lastErr = new Error(`${model}: HTTP ${res.status} ${text.slice(0, 200)}`);
        continue;
      }
      const data: any = await res.json();
      const parts: any[] = data.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith?.('image/'));
      if (!imagePart) {
        lastErr = new Error(`${model}: no image in response`);
        continue;
      }
      const mimeType = imagePart.inlineData.mimeType as string;
      const base64 = imagePart.inlineData.data as string;
      const textPart = parts.find(p => typeof p.text === 'string' && p.text.trim().length > 0);
      const caption = textPart ? (textPart.text as string).trim() : null;
      return {
        dataUrl: `data:${mimeType};base64,${base64}`,
        mimeType,
        bytes: Math.ceil(base64.length * 0.75),
        model,
        caption,
      };
    } catch (err: any) {
      lastErr = err;
    }
  }
  throw new Error(`All image models failed. Last error: ${lastErr?.message || lastErr}`);
}
