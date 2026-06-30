# schedule-ai

Demo full-stack de agente de IA para atendimento e agendamento de negócios locais.

Arquitetura atual: API e frontend em TypeScript + serviço Python dedicado para inteligência de IA (planner, contracts, memory, rules e orquestração).

Stack principal:

- API em Fastify + TypeScript (`api`)
- Web em React + Vite (`web`)
- AI Service em Python + FastAPI (`python-ai`)
- Ollama como motor de LLM (com suporte a OpenAI e Claude via adapter)
- Persistência em memória nesta fase

## Visão geral

O projeto separa claramente três camadas:

- **Domínio de negócio** — entidades, CRUD, auth e integrações (Fastify)
- **Inteligência de IA** — planner, contracts, memory, rules e orquestração (Python)
- **Canal de entrada** — chat web e WhatsApp (Fastify + React)

O domínio mais completo no repositório é o dental.

## Arquitetura alvo

```text
Fastify API (TypeScript)
├── Patients
├── Appointments
├── Services
├── Authentication
└── Internal AI API
      |
      v (POST /ai/plan, /ai/execute, /ai/reflect)
Python AI Service (FastAPI)
├── Planner
├── Contracts (Pydantic)
├── Memory (short-term e long-term)
├── Tool Registry
├── Rules Engine
├── State Machine (LangGraph)
├── Reflection
├── Guardrails
└── Provider Adapter (Ollama / OpenAI / Claude)
      |
      v
Model Provider
└── Ollama local (e/ou cloud models)
```

## Estrutura de pastas

```text
schedule-ai/
├── api/                         # Fastify + TypeScript
│   └── src/
│       ├── domains/dental/
│       ├── services/
│       │   ├── ai-client.ts
│       │   └── run-agent.ts
│       └── index.ts
├── web/                         # React + Vite
├── python-ai/                   # FastAPI (novo)
│   ├── main.py
│   ├── Dockerfile
│   ├── routers/
│   │   └── ai.py               # /ai/plan, /ai/execute, /ai/reflect, /ai/health
│   ├── contracts/
│   │   └── planner.py          # Pydantic — espelha o Zod do TS
│   ├── planner/
│   │   └── llm_planner.py
│   ├── memory/
│   │   └── memory_store.py
│   ├── rules/
│   │   └── rules_engine.py
│   ├── graph/
│   │   └── state_machine.py    # LangGraph
│   ├── guardrails/
│   │   └── guardrails.py
│   ├── providers/
│   │   └── adapter.py          # Ollama / OpenAI / Claude
│   └── requirements.txt
```

## Contratos

Os contratos são definidos em JSON Schema e gerados para ambas as linguagens:

- TypeScript: Zod (`api/src/services/planner-contract.ts`)
- Python: Pydantic (`python-ai/contracts/planner.py`)

Isso garante compatibilidade e evita drift entre os serviços.

Exemplo de plano (versão 1.0):

```json
{
  "version": "1.0",
  "domainId": "dental",
  "summary": "Plano montado para intenção book.",
  "intent": "book",
  "confidence": 0.85,
  "needsClarification": true,
  "missingFields": [
    {
      "field": "date",
      "reason": "A data do atendimento não foi informada.",
      "question": "Qual data você prefere para a consulta?"
    }
  ],
  "steps": [
    {
      "id": "slots.list",
      "title": "Consultar horários disponíveis na data",
      "toolName": "list_available_slots",
      "toolArgs": { "date": "2026-06-29" }
    }
  ],
  "suggestedReply": "Qual data você prefere para a consulta?"
}
```

## Como rodar

### Desenvolvimento

```bash
# API + Web (na raiz)
npm install
npm run dev

# Python AI Service (terminal separado)
cd python-ai
python -m venv .venv
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
```

### Ollama local (Windows)

```bash
# Ver modelos locais
ollama list

# Baixar modelo (uma vez)
ollama pull llama3.1

# Rodar modelo no terminal
ollama run llama3.1

# Subir servidor manualmente apenas se nao estiver ativo
ollama serve
```

Se `ollama serve` retornar erro de bind na porta `11434`, significa que o Ollama ja esta rodando.

Notas:

- Web: http://localhost:5173
- API: http://localhost:3001
- Python AI: http://localhost:8001
- O backend de IA precisa do Ollama disponível (padrão: http://localhost:11434)

### Docker

```bash
docker compose up --build
```

Serviços:

- Web: http://localhost:8080
- API: http://localhost:3001
- Python AI: http://localhost:8001

## Endpoints principais

### Fastify (porta 3001)

- `GET  /health`
- `GET  /domain`
- `GET  /catalog`
- `GET  /slots?date=YYYY-MM-DD`
- `POST /bookings`
- `GET  /bookings`
- `DELETE /bookings/:id`
- `GET  /appointments?phone=`
- `GET  /llm/status`
- `POST /llm/chat`
- `POST /llm/tools/invoke`
- `POST /llm/planner`
- `POST /llm/chat/agent`
- `POST /integrations/whatsapp/simulate-inbound`

### Python AI Service (porta 8001)

- `GET  /ai/health`
- `POST /ai/plan`
- `POST /ai/execute`
- `POST /ai/reflect`

## Fluxo do agente com planner acoplado

No `POST /llm/chat/agent`:

1. O Fastify cria um plano chamando `/ai/plan` no Python service.
2. Se o plano indicar falta de dados, retorna a pergunta objetiva do planner.
3. Se o plano estiver completo, executa o fluxo do agente com tools.
4. A resposta inclui o campo `plan` para auditoria do fluxo.

## Documentação

Neste momento a documentação principal está neste README e no `python-ai/README.md`.
