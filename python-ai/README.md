# python-ai — Estrutura e módulos

Serviço de inteligência em Python (FastAPI) que roda ao lado da API Fastify. Toda a lógica de IA fica aqui: planejamento, regras, memória, orquestração e guardrails. O modelo de linguagem roda localmente via Ollama.

---

## Estrutura de pastas

```
python-ai/
├── main.py                        # Entrypoint FastAPI
├── requirements.txt
│
├── routers/
│   ├── __init__.py
│   └── ai.py                      # Rotas: /ai/plan, /ai/execute, /ai/reflect, /ai/health
│
├── contracts/
│   ├── __init__.py
│   └── planner.py                 # Pydantic — espelha o Zod do TypeScript
│
├── planner/
│   ├── __init__.py
│   └── llm_planner.py             # Monta o plano a partir da intenção do usuário
│
├── rules/
│   ├── __init__.py
│   └── rules_engine.py            # Valida o plano contra regras de negócio
│
├── memory/
│   ├── __init__.py
│   └── memory_store.py            # Memória de curto e longo prazo por sessão
│
├── graph/
│   ├── __init__.py
│   └── state_machine.py           # Orquestração do fluxo com LangGraph
│
├── guardrails/
│   ├── __init__.py
│   └── guardrails.py              # Filtros de segurança e validação de saída
│
└── providers/
    ├── __init__.py
    └── adapter.py                 # Adapter para Ollama / OpenAI / Claude
```

---

## Módulos

### `routers/ai.py`
Expõe os três endpoints principais consumidos pelo Fastify:

| Endpoint | Função |
|---|---|
| `POST /ai/plan` | Recebe mensagem + contexto, devolve um plano estruturado |
| `POST /ai/execute` | Executa as tools do plano (consulta slots, cria agendamento etc.) |
| `POST /ai/reflect` | Avalia a resposta gerada e sugere correções se necessário |
| `GET /ai/health` | Healthcheck do serviço e do provider de LLM |

---

### `contracts/planner.py`
Modelos Pydantic que definem o contrato de dados entre Fastify e Python. Espelham os schemas Zod do TypeScript para garantir compatibilidade.

Principais modelos:
- `PlannerRequest` — mensagem do usuário + histórico + domínio
- `PlannerResponse` — plano com intenção, steps, campos faltando e resposta sugerida
- `ExecuteRequest` / `ExecuteResponse` — tool a executar + resultado
- `ReflectRequest` / `ReflectResponse` — resposta gerada + avaliação

---

### `planner/llm_planner.py`
Núcleo do serviço. Recebe a mensagem do usuário, consulta o modelo (via adapter) e devolve um plano estruturado com:

- `intent` — o que o usuário quer (book, cancel, query, faq…)
- `confidence` — certeza da intenção detectada
- `missingFields` — campos que faltam para completar a ação
- `steps` — lista de tools a executar em ordem
- `suggestedReply` — pergunta objetiva caso faltem dados

O planner não executa nada: só planeja.

---

### `rules/rules_engine.py`
Valida o plano antes de executar. Regras de negócio puras, sem chamada ao LLM.

Exemplos de regras:
- Não agendar fora do horário de funcionamento
- Não permitir dois agendamentos no mesmo slot
- Exigir telefone antes de confirmar qualquer reserva
- Bloquear domínios não suportados

As regras são carregadas por domínio (dental, barbearia etc.) e podem ser definidas em JSON ou código.

---

### `memory/memory_store.py`
Armazena contexto da conversa para o planner não começar do zero a cada mensagem.

- **Short-term** — histórico da sessão atual (últimas N mensagens)
- **Long-term** — dados do paciente/cliente já coletados (nome, telefone, preferências)

Nesta fase a memória fica em RAM (dict por `session_id`). Futuramente migra para Redis ou banco.

---

### `graph/state_machine.py`
Orquestra o fluxo completo usando LangGraph:

```
mensagem → planner → rules → [clarificação?] → execute → reflect → resposta
```

Cada nó do grafo é um módulo isolado. O LangGraph gerencia a transição de estado e permite loops (ex: pedir clarificação e voltar ao planner com a resposta).

---

### `guardrails/guardrails.py`
Última camada antes de devolver a resposta ao usuário. Verifica:

- A resposta contém dados sensíveis expostos indevidamente?
- O modelo alucionou uma tool ou argumento que não existe?
- A resposta está no idioma e tom corretos para o domínio?

Se reprovar, retorna ao reflect ou gera uma resposta de fallback segura.

---

### `providers/adapter.py`
Abstrai o provider de LLM. Troca o backend sem mudar nada no planner ou nas regras.

```python
# config via variável de ambiente
LLM_PROVIDER=ollama   # padrão — local
LLM_PROVIDER=openai
LLM_PROVIDER=claude
```

Para Ollama local, aponta para `http://localhost:11434` e usa o modelo configurado (ex: `llama3`, `mistral`, `gemma3`).

---

## Fluxo resumido

```
Fastify (POST /llm/chat/agent)
  └── POST /ai/plan  →  planner → rules
        ├── faltam dados?  →  devolve pergunta ao usuário
        └── plano completo?
              └── POST /ai/execute  →  tools (slots, bookings…)
                    └── POST /ai/reflect  →  guardrails  →  resposta final
```

---

## Como rodar localmente

```bash
# 1. Instalar Ollama e preparar modelo
ollama list
ollama pull llama3.1
ollama run llama3.1

# 2. Se precisar iniciar o servidor manualmente
ollama serve

# 3. Entrar na pasta e subir o serviço
cd python-ai
uv pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

Se `ollama serve` falhar com erro de bind em `127.0.0.1:11434`, o servidor ja esta ativo e nao precisa subir de novo.

> Rodar sempre de dentro de `python-ai/` para que os imports absolutos funcionem corretamente.