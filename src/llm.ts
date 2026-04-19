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
  let resolveUsage: (u: { inputTokens: number; outputTokens: number; costMillis: number; model: string }) => void;
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
