# schedule-and-sales-ai — Agente de IA

Demo full-stack de um **agente de IA para negócios locais**: agendamento, atendimento e FAQ via chat web e WhatsApp. Arquitetura **modular por domínio** — troque uma variável de ambiente e o mesmo código vira uma clínica odontológica, uma pizzaria ou qualquer outro negócio.

<img width="426" height="240" alt="demo_schedule_ai" src="https://github.com/user-attachments/assets/0cb2b5cd-1f46-4010-8f4c-c717bf8b61b5" />

Monorepo **Node**: API **Fastify** (`api/`) + **React + Vite** (`web/`). Dados em **memória** (sem banco nesta versão). WhatsApp usa o provedor **`stub`** por padrão; Baileys ou outro canal pode ser ligado depois.

---

## Domínios disponíveis

| `BUSINESS_DOMAIN` | Negócio | Horário de atendimento |
|---|---|---|
| `dental` *(padrão)* | Clínica Odontológica | Seg–Sex 8h–17h |
| `pizzeria` | Pizzaria | Seg–Dom 18h–22h |

Trocar de domínio é só uma variável de ambiente — **mesma API, mesmo agente, mesmas tools genéricas**.

Para adicionar um novo vertical basta implementar a interface `BusinessDomain` em `api/src/domains/types.ts`:

```ts
interface BusinessDomain {
  id: string;
  displayName: string;
  systemPrompt: string;          // injetado no agente LLM
  tools: OllamaToolDefinition[]; // tools enviadas ao Ollama
  executeTool(name, args, ctx): Promise<ToolResult>;
  createContext(): DomainContext; // instancia stores do domínio
  whatsAppHelp: string;
  handleWhatsAppCommand?(text, lower, from, ctx): Promise<string | null>;
}
```

---

## Domínio: Clínica Odontológica

### Serviços e preços de referência

| Serviço | Duração | Preço |
|---|---|---|
| Limpeza / Profilaxia | 60 min | R$ 150 |
| Avaliação / Consulta | 60 min | R$ 120 |
| Retorno | 30 min | incluso |
| Restauração / Obturação | 60 min | R$ 250 |
| Extração | 60 min | R$ 200 |
| Emergência | 60 min | R$ 180 |
| Clareamento | 90 min | R$ 600 |
| Ortodontia (avaliação) | 60 min | R$ 150 |

Preços em `api/src/domains/dental/catalog.ts`.

### Exemplos de conversa

```
"quero marcar uma limpeza"
→ agente coleta nome, telefone e data → list_available_slots → create_appointment

"preciso de atendimento de emergência hoje"
→ agente verifica horários → oferece opções → confirma → salva paciente

"quais meus agendamentos?"
→ agente chama list_appointments_for_phone
```

### Tools do agente (dental)

| Tool | O que faz |
|---|---|
| `get_services` | Lista serviços, preços e duração |
| `list_available_slots` | Horários livres em uma data (aceita dd/mm ou YYYY-MM-DD) |
| `create_appointment` | Agenda consulta + cria registro de paciente |
| `list_appointments_for_phone` | Consultas agendadas do paciente |
| `cancel_appointment` | Cancela pelo booking_id + telefone |
| `get_patient_history` | Histórico de consultas |

---

## Domínio: Pizzaria

### Cardápio de referência

| Item | Preço |
|---|---|
| Pizza média | R$ 60 |
| Pizza grande | R$ 80 |
| Refrigerante 600 ml | R$ 10 |
| Refrigerante 2 L | R$ 16 |

Preços em `api/src/services/pizzeria-catalog.ts`.

---

## Rodar Ollama

```bash
ollama serve
ollama list
```

---

## Rodar com Docker

```bash
docker compose up --build
```

- **Interface**: http://localhost:8080
- **API**: http://localhost:3001

---

## Rodar em desenvolvimento

```bash
npm install
npm run dev
```

Para escolher o domínio:

```bash
# Clínica odontológica (padrão)
BUSINESS_DOMAIN=dental npm run dev

# Pizzaria
BUSINESS_DOMAIN=pizzeria npm run dev
```

---

## Endpoints principais

| Rota | Descrição |
|---|---|
| `GET /domain` | Domínio ativo e tools disponíveis |
| `GET /catalog` | Catálogo do domínio (serviços ou cardápio) |
| `GET /slots?date=YYYY-MM-DD` | Horários disponíveis |
| `POST /bookings` | Criar agendamento (aceita `serviceId` para odonto) |
| `GET /bookings` | Listar agendamentos |
| `DELETE /bookings/:id` | Cancelar agendamento |
| `GET /appointments?phone=` | Consultas do paciente *(dental only)* |
| `POST /integrations/whatsapp/simulate-inbound` | Simular mensagem WhatsApp |
| `GET /llm/status` | Status do Ollama |
| `POST /llm/chat/agent` | Agente com tools (loop Ollama) |
| `POST /llm/tools/invoke` | Testar tool diretamente sem LLM |

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `BUSINESS_DOMAIN` | `dental` | Domínio ativo |
| `WHATSAPP_PROVIDER` | `stub` | `stub` ou `baileys` |
| `OLLAMA_URL` | `http://localhost:11434` | Endpoint do Ollama |
| `OLLAMA_MODEL` | `llama3.1` | Modelo usado no agente |
| `LLM_AGENT_SYSTEM_PROMPT` | *(do domínio)* | Sobrescreve o system prompt do agente |

---

## Simular WhatsApp

```bash
# Ver horários disponíveis
curl -s -X POST http://localhost:3001/integrations/whatsapp/simulate-inbound \
  -H "Content-Type: application/json" \
  -d '{"from":"5547999999999","text":"horarios 2026-05-12"}'

# Agendar via comando direto
curl -s -X POST http://localhost:3001/integrations/whatsapp/simulate-inbound \
  -H "Content-Type: application/json" \
  -d '{"from":"5547999999999","text":"agendar 2026-05-12 09 Maria limpeza"}'

# Frase livre — agente LLM com tools
curl -s -X POST http://localhost:3001/integrations/whatsapp/simulate-inbound \
  -H "Content-Type: application/json" \
  -d '{"from":"5547999999999","text":"preciso agendar retorno na próxima semana"}'
```

---

## Arquitetura

```
api/src/
  index.ts                    # bootstrap: seleciona domínio via BUSINESS_DOMAIN
  domains/
    types.ts                  # interface BusinessDomain
    dental/
      catalog.ts              # serviços, preços, keywords
      patient-store.ts        # PatientStore (consultas)
      tools.ts                # 6 tools LLM
      prompt.ts               # system prompt da clínica
      index.ts                # dentalDomain (seg-sex 8h–17h)
    pizzeria/
      index.ts                # pizzeriaDomain (18h–22h)
  services/
    schedule-store.ts         # agendamento genérico (horas e dias configuráveis)
    order-store.ts            # pedidos (pizzeria)
    pizzeria-catalog.ts       # cardápio (pizzeria)
    whatsapp-bot.ts           # attachDomainWhatsAppBot — genérico + fallback LLM
    llm-agent.ts              # runLlmToolAgent({ systemPrompt, tools, executeTool })
    ollama-chat.ts            # cliente HTTP Ollama
  whatsapp/
web/src/
  pages/Chat.tsx              # interface única: chat + painel lateral (consultas, horários, serviços)
docker/
```

### Fluxo de mensagem WhatsApp

```
mensagem recebida
  → comandos universais (ajuda, horarios, meus, cancelar)
  → domain.handleWhatsAppCommand()   ← comandos específicos do domínio
  → runLlmToolAgent()                ← fallback: agente LLM com tools do domínio
```

---

## Stack

| Parte | Estado atual | Próximos passos |
|---|---|---|
| Backend | Node + TypeScript, Fastify | — |
| Domínios | dental, pizzeria | barbearia, pet shop, … |
| Persistência | Memória | PostgreSQL / SQLite |
| LLM | Ollama (llama3.1) + agente com tools | Memória de sessão, streaming |
| WhatsApp | Stub + simulação | Baileys ou Meta Cloud API |
| Frontend | React + Vite, single-page | — |
