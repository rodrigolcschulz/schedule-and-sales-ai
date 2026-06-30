# python-ai/guardrails/guardrails.py
import re
from contracts.planner import PlannerResponse

SENSITIVE_PATTERNS = [
    r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b",  # CPF
    r"\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b",  # cartão
    r"\bsenha\b", r"\bpassword\b", r"\btoken\b",
]

VALID_TOOLS = {
    "list_available_slots",
    "create_booking",
    "find_booking",
    "delete_booking",
    "list_appointments",
}

VALID_INTENTS = {"book", "cancel", "query", "faq", "unknown"}

HALLUCINATED_PHRASES = [
    "como ia,", "como assistente", "sou um modelo",
    "não tenho acesso", "minha base de dados",
]

class Guardrails:
    def validate_plan(self, plan: PlannerResponse) -> dict:
        """Valida o plano antes de executar. Chamado pelo execute_plan."""
        errors = []

        if plan.intent not in VALID_INTENTS:
            errors.append(f"Intenção inválida: '{plan.intent}'.")

        for step in plan.steps:
            if step.toolName not in VALID_TOOLS:
                errors.append(f"Tool desconhecida: '{step.toolName}'.")

        if plan.confidence < 0.4:
            errors.append("Confiança muito baixa para executar o plano.")

        return {"ok": len(errors) == 0, "reason": errors[0] if errors else None}

    def validate_reply(self, reply: str) -> bool:
        """Valida a resposta final antes de enviar ao usuário."""
        lower = reply.lower()

        # Bloqueia dados sensíveis expostos
        for pattern in SENSITIVE_PATTERNS:
            if re.search(pattern, reply):
                return False

        # Bloqueia frases que indicam alucinação de identidade
        for phrase in HALLUCINATED_PHRASES:
            if phrase in lower:
                return False

        # Bloqueia resposta vazia ou muito curta
        if len(reply.strip()) < 5:
            return False

        return True