# python-ai/main.py
from fastapi import FastAPI
from routers.ai import router as ai_router

app = FastAPI(title="schedule-ai python service")
app.include_router(ai_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)