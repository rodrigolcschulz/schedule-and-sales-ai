import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  cancelBooking,
  fetchLlmChatAgent,
  fetchLlmStatus,
  fetchServices,
  fetchSlots,
  listAppointments,
  type Appointment,
  type DentalService,
  type LlmStatus,
  type SlotRow,
} from "../api";
import { formatBookingWhenBr, formatSlotTimeBr } from "../schedule";

type ChatTurn = { role: "user" | "assistant"; content: string };

function todayYmd(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    (d.getMonth() + 1).toString().padStart(2, "0"),
    d.getDate().toString().padStart(2, "0"),
  ].join("-");
}

export function App() {
  // ── LLM ────────────────────────────────────────────────────────────────────
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Painel lateral ─────────────────────────────────────────────────────────
  const [services, setServices] = useState<DentalService[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [date, setDate] = useState(todayYmd);
  const [panelMsg, setPanelMsg] = useState<string | null>(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"appointments" | "services" | "slots">(
    "appointments"
  );

  // ── Load data ───────────────────────────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    try { setStatus(await fetchLlmStatus()); } catch { setStatus(null); }
  }, []);

  const loadServices = useCallback(async () => {
    try { setServices(await fetchServices()); } catch { /* silencioso */ }
  }, []);

  const loadAppointments = useCallback(async () => {
    try { setAppointments(await listAppointments()); } catch { /* silencioso */ }
  }, []);

  const loadSlots = useCallback(async () => {
    setPanelLoading(true);
    try { setSlots(await fetchSlots(date)); } catch { /* silencioso */ }
    finally { setPanelLoading(false); }
  }, [date]);

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => { void loadServices(); }, [loadServices]);
  useEffect(() => { void loadAppointments(); }, [loadAppointments]);
  useEffect(() => { void loadSlots(); }, [loadSlots]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatLoading]);

  // ── Chat ────────────────────────────────────────────────────────────────────
  async function send() {
    const text = input.trim();
    if (!text || chatLoading) return;
    setInput("");
    setChatError(null);
    const next: ChatTurn[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setChatLoading(true);
    try {
      const { reply, trace } = await fetchLlmChatAgent(next);
      if (trace?.length) {
        // Recarrega o painel lateral após execução de tools para manter dados sincronizados.
        const hasSuccessfulTool = trace.some((t: { tool: string; ok: boolean }) => t.ok);
        if (hasSuccessfulTool) {
          await Promise.all([loadAppointments(), loadSlots()]);
        }
      }
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setChatError(e instanceof Error ? e.message : "Erro ao falar com o modelo");
      setMessages((m) => m.slice(0, -1));
    } finally {
      setChatLoading(false);
    }
  }

  async function onCancel(bookingId: string) {
    setPanelMsg(null);
    try {
      await cancelBooking(bookingId);
      await loadAppointments();
      await loadSlots();
      setPanelMsg("Consulta cancelada.");
    } catch (e) {
      setPanelMsg(e instanceof Error ? e.message : "Erro ao cancelar");
    }
  }

  const freeSlots = slots.filter((s) => s.available);

  return (
    <div className="app-shell">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="app-header-inner">
          <div>
            <h1 className="app-title">Clínica Odonto Demo</h1>
            <p className="app-subtitle muted">
              Assistente IA · Agendamento · Serviços
            </p>
          </div>
          <div className="status-badge">
            <span
              className={status?.ollamaReachable ? "dot dot--green" : "dot dot--red"}
            />
            <span className="muted small">
              {status?.ollamaReachable
                ? `IA online · ${status.model}`
                : "IA indisponível"}
            </span>
          </div>
        </div>
      </header>

      {/* ── Main layout ────────────────────────────────────────────────────── */}
      <div className="app-body">
        {/* ── Chat (coluna principal) ──────────────────────────────────────── */}
        <main className="chat-col">
          <div className="chat-log" id="chat-log">
            {messages.length === 0 && (
              <div className="chat-empty">
                <p>Olá! Posso ajudar a:</p>
                <ul>
                  <li>Agendar uma consulta</li>
                  <li>Verificar horários disponíveis</li>
                  <li>Informar serviços e preços</li>
                  <li>Cancelar ou reagendar</li>
                </ul>
                <p className="muted small">
                  Modo agente ativo — uso tools de agendamento automaticamente.
                </p>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={`${i}-${m.role}`}
                className={m.role === "user" ? "chat-bubble user" : "chat-bubble assistant"}
              >
                <span className="chat-role">
                  {m.role === "user" ? "Você" : "Assistente"}
                </span>
                <div className="chat-text">
                  {m.role === "user" ? (
                    <p style={{ margin: 0 }}>{m.content}</p>
                  ) : (
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  )}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="chat-bubble assistant">
                <span className="chat-role">Assistente</span>
                <p className="chat-text muted">Digitando…</p>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {chatError && <p className="banner chat-error">{chatError}</p>}

          <div className="chat-input-row">
            <textarea
              className="chat-input"
              rows={2}
              value={input}
              placeholder="Digite sua mensagem… (Enter para enviar)"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button type="button" disabled={chatLoading} onClick={() => void send()}>
              Enviar
            </button>
          </div>
        </main>

        {/* ── Painel lateral ──────────────────────────────────────────────── */}
        <aside className="side-panel">
          {/* Tabs */}
          <div className="tabs">
            <button
              type="button"
              className={activeTab === "appointments" ? "tab tab--active" : "tab"}
              onClick={() => setActiveTab("appointments")}
            >
              Consultas
            </button>
            <button
              type="button"
              className={activeTab === "slots" ? "tab tab--active" : "tab"}
              onClick={() => { setActiveTab("slots"); void loadSlots(); }}
            >
              Horários
            </button>
            <button
              type="button"
              className={activeTab === "services" ? "tab tab--active" : "tab"}
              onClick={() => setActiveTab("services")}
            >
              Serviços
            </button>
          </div>

          {panelMsg && <p className="banner panel-msg">{panelMsg}</p>}

          {/* Tab: Consultas agendadas */}
          {activeTab === "appointments" && (
            <div className="panel-content">
              <div className="panel-actions">
                <button
                  type="button"
                  className="ghost small-btn"
                  onClick={() => { void loadAppointments(); setPanelMsg(null); }}
                >
                  Atualizar
                </button>
              </div>
              {appointments.length === 0 ? (
                <p className="muted small">Nenhuma consulta agendada.</p>
              ) : (
                <ul className="panel-list">
                  {appointments.map((a) => (
                    <li key={a.id} className="panel-item">
                      <div className="panel-item-info">
                        <strong>{a.patientName}</strong>
                        <span className="muted small block">
                          {formatBookingWhenBr(a.startsAt)}
                        </span>
                        <span className="small block">{a.serviceName}</span>
                        {a.notes && (
                          <span className="muted small block">Obs: {a.notes}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="ghost small-btn danger"
                        onClick={() => void onCancel(a.bookingId)}
                      >
                        Cancelar
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Tab: Horários livres */}
          {activeTab === "slots" && (
            <div className="panel-content">
              <div className="panel-actions">
                <input
                  type="date"
                  value={date}
                  className="date-input"
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              {panelLoading ? (
                <p className="muted small">Carregando…</p>
              ) : freeSlots.length === 0 ? (
                <p className="muted small">Nenhum horário livre neste dia.</p>
              ) : (
                <ul className="panel-list">
                  {freeSlots.map((s) => (
                    <li key={s.id} className="panel-item slot-row">
                      <span>{formatSlotTimeBr(s.startsAt)}</span>
                      <span className="muted small">{s.id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Tab: Serviços */}
          {activeTab === "services" && (
            <div className="panel-content">
              <ul className="panel-list">
                {services.map((s) => (
                  <li key={s.id} className="panel-item service-row">
                    <div>
                      <strong>{s.name}</strong>
                      <span className="muted small block">{s.description}</span>
                    </div>
                    <div className="service-meta">
                      <span className="price">
                        {s.priceReais > 0 ? `R$ ${s.priceReais}` : "incluso"}
                      </span>
                      <span className="muted small">{s.durationMinutes}min</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
