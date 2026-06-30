"""FastAPI entrypoint for the generator service.

  POST /compile   {prompt}        → GenerationPlan   (Claude authors the scene)
  POST /generate  GenerationPlan  → {job_id}         (runs the asset pipeline)
  GET  /jobs/{id}                 → JobStatus(+package)
  GET  /assets/...                → static package files
"""
from __future__ import annotations

import os
import threading

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import settings
from .pipeline import JOBS, run_job
from .scene_compiler import CompilerError, compile_scene
from .schema import GenerationPlan

app = FastAPI(title="Hero Forge — Generator", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

os.makedirs(settings.output_dir, exist_ok=True)
app.mount(settings.public_base, StaticFiles(directory=settings.output_dir), name="assets")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "compiler_ready": settings.has_anthropic_key, "device": settings.device}


@app.post("/compile")
def compile_endpoint(body: dict) -> dict:
    prompt = (body or {}).get("prompt", "").strip()
    if not prompt:
        raise HTTPException(400, "missing 'prompt'")
    try:
        plan = compile_scene(prompt)
    except CompilerError as e:
        raise HTTPException(503, str(e))
    return plan.model_dump()


@app.post("/generate")
def generate_endpoint(plan_body: dict) -> dict:
    try:
        plan = GenerationPlan.model_validate(plan_body)
    except Exception as e:
        raise HTTPException(400, f"invalid plan: {e}")
    job = JOBS.create()
    threading.Thread(
        target=run_job, args=(job, plan, settings.compiler_model), daemon=True
    ).start()
    return {"job_id": job.job_id}


@app.get("/jobs/{job_id}")
def job_endpoint(job_id: str) -> dict:
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job")
    return {
        "job_id": job.job_id,
        "status": job.status,
        "stage": job.stage,
        "progress": job.progress,
        "package": job.package,
        "error": job.error,
    }
