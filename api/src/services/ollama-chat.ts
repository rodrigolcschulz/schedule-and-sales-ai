/** Proxy para Ollama rodando na máquina (porta padrão 11434). */

function trimSlash(url: string): string {
  return url.replace(/\/$/, "");
}

export function getOllamaBaseUrl(): string {
  return trimSlash(process.env.OLLAMA_URL ?? "http://127.0.0.1:11434");
}

export function getOllamaModel(): string {
  return process.env.OLLAMA_MODEL ?? "llama3.1";
}

export async function ollamaChat(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>
): Promise<string> {
  const base = getOllamaBaseUrl();
  const model = getOllamaModel();
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 800)}`);
  }
  const data = (await res.json()) as { message?: { content?: string } };
  const text = data.message?.content?.trim();
  if (!text) throw new Error("Resposta vazia do Ollama.");
  return text;
}

export async function ollamaTags(): Promise<{ ok: boolean; names: string[] }> {
  const base = getOllamaBaseUrl();
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(`${base}/api/tags`, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false, names: [] };
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const names = (data.models ?? []).map((m) => m.name);
    return { ok: true, names };
  } catch {
    return { ok: false, names: [] };
  }
}
