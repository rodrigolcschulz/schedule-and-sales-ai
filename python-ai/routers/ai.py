# python-ai/routers/ai.py
import logging
from fastapi import APIRouter, HTTPException
from planner.llm_planner import LLMPlanner
from contracts.planner import (
    PlannerRequest, PlannerResponse,
    ExecuteRequest, ExecuteResponse,
    ReflectRequest, ReflectResponse,
)
from providers.adapter import ProviderAdapter

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai")

planner = LLMPlanner()
adapter = ProviderAdapter()

@router.get("/health")
def health():
    provider_status = adapter.health()
    return {
        "status": "ok",
        "provider": provider_status,
    }

@router.post("/plan", response_model=PlannerResponse)
def plan(request: PlannerRequest):
    try:
        return planner.create_plan(request)
    except Exception as e:
        logger.error(f"[/ai/plan] {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/execute", response_model=ExecuteResponse)
def execute(request: ExecuteRequest):
    try:
        return planner.execute_plan(request)
    except Exception as e:
        logger.error(f"[/ai/execute] {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/reflect", response_model=ReflectResponse)
def reflect(request: ReflectRequest):
    try:
        return planner.reflect_on_result(request)
    except Exception as e:
        logger.error(f"[/ai/reflect] {e}")
        raise HTTPException(status_code=500, detail=str(e))