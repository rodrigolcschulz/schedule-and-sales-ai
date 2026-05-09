import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchLlmChat,
  fetchLlmChatAgent,
  fetchLlmStatus,
  type LlmStatus,
} from "../api";

type ChatTurn = { role: "user" | "assistant"; content: string };

export function Chat() {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useTools, setUseTools] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await fetchLlmStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setError(null);
    const nextMessages: ChatTurn[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setLoading(true);
    try {
      const { reply, trace } = useTools
        ? await fetchLlmChatAgent(nextMessages)
        : await fetchLlmChat(nextMessages);
      let text = reply;
      if (trace?.length) {
        text += `\n\n_(tools: ${trace.map((t) => `${t.tool}${t.ok ? "✓" : "✗"}`).join(", ")})_`;
      }
      setMessages([...nextMessages, { role: "assistant", content: text }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao falar com o modelo");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="header">
        <h1>LLM local — mesmo backend de agenda e vendas</h1>
        <p className="muted">
          Chat livre ou modo agente com tools (cardápio, horários, pedidos). O backend encaminha para o{" "}
          <a href="https://ollama.com" target="_blank" rel="noreferrer">
            Ollama
          </a>{" "}
          na sua máquina. Modelo padrão no servidor:{" "}
          <code className="small">qwen2.5:7b</code> (troque com{" "}
          <code className="small">OLLAMA_MODEL</code>).
        </p>
      </header>

      <p className="muted small">
        <Link to="/">← Voltar ao demo</Link>
      </p>

      <section className="card">
        <h2>Status</h2>
        {status ? (
          <ul className="status-list">
            <li>
              Ollama:{" "}
              <strong>{status.ollamaReachable ? "acessível" : "indisponível"}</strong>
            </li>
            <li>
              Modelo configurado: <code>{status.model}</code>
            </li>
            <li className="muted small">
              URL: <code>{status.ollamaUrl}</code>
            </li>
            {status.models.length > 0 && (
              <li className="muted small">
                Modelos locais: {status.models.slice(0, 6).join(", ")}
                {status.models.length > 6 ? "…" : ""}
              </li>
            )}
          </ul>
        ) : (
          <p className="muted">Não foi possível ler o status.</p>
        )}
        <button type="button" className="ghost" onClick={() => void loadStatus()}>
          Atualizar status
        </button>
        {!status?.ollamaReachable && (
          <p className="banner marg-top">
            Instale e rode o Ollama, depois baixe um modelo:{" "}
            <code>ollama pull qwen2.5:7b</code> ou <code>ollama pull llama3</code>.
          </p>
        )}
      </section>

      <section className="card chat-card">
        <h2>Chat</h2>
        <label className="tool-toggle">
          <input
            type="checkbox"
            checked={useTools}
            onChange={(e) => setUseTools(e.target.checked)}
          />
          <span>
            Modo agente (tools de agendamento + pedido) — requer modelo com suporte a tools no
            Ollama (ex.: Llama 3.1, Qwen 2.5).
          </span>
        </label>
        <div className="chat-log">
          {messages.length === 0 && (
            <p className="muted small">
              Dica: pergunte sobre o cardápio demo ou peça um resumo em português.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={`${i}-${m.role}`}
              className={m.role === "user" ? "chat-bubble user" : "chat-bubble assistant"}
            >
              <span className="chat-role">{m.role === "user" ? "Você" : "Assistente"}</span>
              <p className="chat-text">{m.content}</p>
            </div>
          ))}
          {loading && <p className="muted small">Gerando…</p>}
          <div ref={bottomRef} />
        </div>
        {error && <p className="banner">{error}</p>}
        <div className="chat-input-row">
          <textarea
            className="chat-input"
            rows={2}
            value={input}
            placeholder="Escreva uma mensagem…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button type="button" disabled={loading} onClick={() => void send()}>
            Enviar
          </button>
        </div>
      </section>

      <section className="card muted-card">
        <h2>Qwen ou Llama 3?</h2>
        <p className="small">
          Para <strong>português</strong> e uso geral em chat, <strong>Qwen 2.5</strong> costuma
          ser uma boa escolha em tamanhos 7B–14B. <strong>Llama 3</strong> também funciona bem;
          experimente os dois no mesmo hardware e compare latência e tom. O default da API é{" "}
          <code>qwen2.5:7b</code> — altere com a variável <code>OLLAMA_MODEL</code>.
        </p>
      </section>
    </div>
  );
}
