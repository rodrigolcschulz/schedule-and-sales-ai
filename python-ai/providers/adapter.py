# python-ai/providers/adapter.py
import os
import requests
import logging

logger = logging.getLogger(__name__)

class ProviderAdapter:
    def __init__(self):
        self.provider = os.getenv("LLM_PROVIDER", "ollama")
        self.model    = os.getenv("OLLAMA_MODEL", os.getenv("LLM_MODEL", "llama3.1"))
        self.base_url = os.getenv("OLLAMA_URL", "http://localhost:11434")
        self.timeout  = int(os.getenv("LLM_TIMEOUT_SECONDS", "30"))

    def complete(self, prompt: str) -> str:
        try:
            if self.provider == "ollama":
                return self._ollama(prompt)
            raise NotImplementedError(f"Provider '{self.provider}' não implementado.")
        except NotImplementedError:
            raise
        except Exception as e:
            logger.error(f"[adapter] Erro ao chamar {self.provider}: {e}")
            return ""  # retorno seguro — o planner trata string vazia

    def health(self) -> dict:
        """Usado pelo /ai/health para checar se o provider está acessível."""
        try:
            if self.provider == "ollama":
                res = requests.get(f"{self.base_url}/api/tags", timeout=5)
                models = [m["name"] for m in res.json().get("models", [])]
                # Ollama costuma expor tags como "model:latest".
                available = any(name == self.model or name.startswith(f"{self.model}:") for name in models)
                return {
                    "provider": "ollama",
                    "model": self.model,
                    "available": available,
                    "models": models,
                }
        except Exception as e:
            return {"provider": self.provider, "available": False, "error": str(e)}

    # --- providers ---

    def _ollama(self, prompt: str) -> str:
        res = requests.post(
            f"{self.base_url}/api/generate",
            json={"model": self.model, "prompt": prompt, "stream": False},
            timeout=self.timeout,
        )
        res.raise_for_status()
        return res.json()["response"].strip()