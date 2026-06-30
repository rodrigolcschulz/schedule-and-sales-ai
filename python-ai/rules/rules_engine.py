# python-ai/rules/rules_engine.py
from datetime import datetime, time
from contracts.planner import PlannerResponse, RuleCheckResponse

# Configuração da clínica — futuramente vem do domínio/banco
BUSINESS_HOURS = {
    0: (time(8, 0), time(18, 0)),   # segunda
    1: (time(8, 0), time(18, 0)),   # terça
    2: (time(8, 0), time(18, 0)),   # quarta
    3: (time(8, 0), time(18, 0)),   # quinta
    4: (time(8, 0), time(17, 0)),   # sexta
    5: None,                         # sábado — fechado
    6: None,                         # domingo — fechado
}

SUPPORTED_DOMAINS = {"dental"}

class RuleEngine:
    def check(self, plan: PlannerResponse) -> RuleCheckResponse:
        errors = []

        errors += self._check_domain(plan)
        errors += self._check_has_steps(plan)
        errors += self._check_date(plan)
        errors += self._check_business_hours(plan)
        errors += self._check_required_args(plan)

        return RuleCheckResponse(valid=len(errors) == 0, errors=errors)

    # --- regras individuais ---

    def _check_domain(self, plan: PlannerResponse) -> list[str]:
        if plan.domainId not in SUPPORTED_DOMAINS:
            return [f"Domínio '{plan.domainId}' não suportado."]
        return []

    def _check_has_steps(self, plan: PlannerResponse) -> list[str]:
        if plan.intent not in ("faq", "unknown") and not plan.steps:
            return ["Plano sem etapas para uma intenção que requer ação."]
        return []

    def _check_date(self, plan: PlannerResponse) -> list[str]:
        date_str = self._get_arg(plan, "date")
        if not date_str:
            return []  # campo faltando já é tratado pelo planner
        try:
            date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return [f"Data '{date_str}' em formato inválido. Use YYYY-MM-DD."]
        if date < datetime.now().date():
            return ["Não é possível agendar em uma data passada."]
        return []

    def _check_business_hours(self, plan: PlannerResponse) -> list[str]:
        date_str = self._get_arg(plan, "date")
        if not date_str:
            return []
        try:
            date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            return []
        hours = BUSINESS_HOURS.get(date.weekday())
        if hours is None:
            day_name = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"][date.weekday()]
            return [f"A clínica não atende aos {day_name}s."]
        return []

    def _check_required_args(self, plan: PlannerResponse) -> list[str]:
        """Garante que create_booking tem todos os args antes de executar."""
        errors = []
        for step in plan.steps:
            if step.toolName == "create_booking":
                for field in ("name", "phone", "service", "date"):
                    if not step.toolArgs.get(field):
                        errors.append(f"Campo '{field}' ausente nos args de create_booking.")
        return errors

    # --- helper ---

    def _get_arg(self, plan: PlannerResponse, field: str):
        """Busca um campo nos toolArgs de qualquer step do plano."""
        for step in plan.steps:
            if val := step.toolArgs.get(field):
                return val
        return None