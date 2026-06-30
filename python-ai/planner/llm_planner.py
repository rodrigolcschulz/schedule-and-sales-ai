# python-ai/planner/llm_planner.py
import json
from contracts.planner import (
    PlannerRequest, PlannerResponse, MissingField, PlanStep,
    ExecuteRequest, ExecuteResponse,
    ReflectRequest, ReflectResponse
)
from rules.rules_engine import RuleEngine
from memory.memory_store import MemoryStore
from guardrails.guardrails import Guardrails
from providers.adapter import ProviderAdapter

INTENT_STEPS = {
    "book": [
        PlanStep(id="slots.list", title="Consultar horários disponíveis", toolName="list_available_slots", toolArgs={}),
        PlanStep(id="booking.create", title="Criar agendamento", toolName="create_booking", toolArgs={}),
    ],
    "cancel": [
        PlanStep(id="booking.find", title="Localizar agendamento", toolName="find_booking", toolArgs={}),
        PlanStep(id="booking.delete", title="Cancelar agendamento", toolName="delete_booking", toolArgs={}),
    ],
    "query": [
        PlanStep(id="appointments.list", title="Listar consultas do paciente", toolName="list_appointments", toolArgs={}),
    ],
    "faq": [],
}

REQUIRED_FIELDS = {
    "book":   ["name", "phone", "service", "date"],
    "cancel": ["phone"],
    "query":  ["phone"],
    "faq":    [],
}

class LLMPlanner:
    def __init__(self):
        self.rule_engine = RuleEngine()
        self.memory_store = MemoryStore()
        self.guardrails = Guardrails()
        self.llm = ProviderAdapter()

    def create_plan(self, request: PlannerRequest) -> PlannerResponse:
        # 1. Recupera memória da sessão
        memory = self.memory_store.get(request.sessionId) if request.sessionId else {}

        # 2. LLM extrai intenção + dados do paciente
        extracted = self._extract(request.message, memory)
        intent = extracted.get("intent", "unknown")
        confidence = extracted.get("confidence", 0.5)
        patient = extracted.get("patient", {})

        # 3. Merge com memória existente (não sobrescreve com null)
        merged = {**memory, **{k: v for k, v in patient.items() if v}}
        if request.sessionId:
            self.memory_store.set(request.sessionId, merged)

        # 4. Descobre campos faltando
        required = REQUIRED_FIELDS.get(intent, [])
        missing = [
            MissingField(**self._missing_field_info(f))
            for f in required if not merged.get(f)
        ]

        # 5. Monta steps com args preenchidos
        steps = self._build_steps(intent, merged)

        # 6. Valida regras de negócio
        needs_clarification = len(missing) > 0
        suggested_reply = self._ask_next(missing) if missing else self._confirm_summary(intent, merged)

        plan = PlannerResponse(
            domainId=request.domainId,
            summary=f"Plano para intenção '{intent}'.",
            intent=intent,
            confidence=confidence,
            needsClarification=needs_clarification,
            missingFields=missing,
            steps=steps,
            suggestedReply=suggested_reply,
        )

        # 7. Valida regras
        rule_result = self.rule_engine.check(plan)
        if not rule_result.valid:
            plan.needsClarification = True
            plan.suggestedReply = rule_result.errors[0]

        return plan

    def execute_plan(self, request: ExecuteRequest) -> ExecuteResponse:
        # O Fastify executa as tools — aqui só validamos guardrails antes
        check = self.guardrails.validate_plan(request.plan)
        if not check["ok"]:
            return ExecuteResponse(success=False, error=check["reason"])
        # Retorna ok; a execução real das tools é feita no Fastify
        return ExecuteResponse(success=True, result={"steps": len(request.plan.steps)})

    def reflect_on_result(self, request: ReflectRequest) -> ReflectResponse:
        # LLM gera a resposta final em linguagem natural
        context = {
            "intent": request.plan.intent,
            "patient": self.memory_store.get(request.plan.domainId) or {},
            "result": request.executeResult.result,
        }
        final_reply = self._generate_reply(context)
        approved = self.guardrails.validate_reply(final_reply)

        return ReflectResponse(
            approved=approved,
            finalReply=final_reply if approved else "Desculpe, não consegui processar sua solicitação. Pode repetir?",
            insights=[{"intent": request.plan.intent, "success": request.executeResult.success}],
        )

    # --- helpers privados ---

    def _extract(self, message: str, memory: dict) -> dict:
        prompt = f"""
Analise a mensagem de um paciente de clínica odontológica.
Dados já conhecidos: {json.dumps(memory, ensure_ascii=False)}

Mensagem: "{message}"

Responda APENAS com JSON válido:
{{
  "intent": "book|cancel|query|faq|unknown",
  "confidence": 0.0,
  "patient": {{
    "name": null,
    "phone": null,
    "service": "limpeza|avaliacao|retorno|restauracao|extracao|emergencia|clareamento|ortodontia|null",
    "date": null
  }}
}}
"""
        raw = self.llm.complete(prompt)
        try:
            return json.loads(raw)
        except Exception:
            return {"intent": "unknown", "confidence": 0.3, "patient": {}}

    def _missing_field_info(self, field: str) -> dict:
        info = {
            "name":    {"field": "name",    "reason": "Nome do paciente não informado.", "question": "Qual o seu nome?"},
            "phone":   {"field": "phone",   "reason": "Telefone não informado.",         "question": "Qual o seu telefone?"},
            "service": {"field": "service", "reason": "Serviço não identificado.",       "question": "Qual serviço você precisa? (limpeza, avaliação, extração...)"},
            "date":    {"field": "date",    "reason": "Data não informada.",             "question": "Qual data prefere para a consulta?"},
        }
        return info.get(field, {"field": field, "reason": f"{field} não informado.", "question": f"Qual o {field}?"})

    def _build_steps(self, intent: str, merged: dict) -> list[PlanStep]:
        steps = INTENT_STEPS.get(intent, [])
        # Injeta os args conhecidos nos steps relevantes
        for step in steps:
            if step.toolName == "list_available_slots" and merged.get("date"):
                step.toolArgs = {"date": merged["date"]}
            elif step.toolName == "create_booking":
                step.toolArgs = {k: merged.get(k) for k in ["name", "phone", "service", "date"]}
            elif step.toolName in ("find_booking", "delete_booking", "list_appointments"):
                step.toolArgs = {"phone": merged.get("phone")}
        return steps

    def _ask_next(self, missing: list[MissingField]) -> str:
        return missing[0].question  # pergunta um campo por vez

    def _confirm_summary(self, intent: str, merged: dict) -> str:
        if intent == "book":
            return (f"Vou agendar {merged.get('service','consulta')} para {merged.get('name','você')} "
                    f"em {merged.get('date','a data informada')}. Confirma?")
        if intent == "cancel":
            return "Vou cancelar seu agendamento. Confirma?"
        if intent == "query":
            return "Vou buscar seus agendamentos."
        return "Como posso ajudar?"

    def _generate_reply(self, context: dict) -> str:
        prompt = f"""
Você é a assistente de uma clínica odontológica. Responda em português, de forma breve e cordial.
Contexto: {json.dumps(context, ensure_ascii=False)}
Gere apenas a mensagem final para o paciente, sem explicações adicionais.
"""
        return self.llm.complete(prompt).strip()