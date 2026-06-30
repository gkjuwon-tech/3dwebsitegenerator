"""Generation orchestrator. Turns a compiled GenerationPlan into a ScenePackage
by running the specialized generators, then assembles the runtime package.

Per-asset honesty: if a model stage can't run (no GPU/weights), that slot is
marked `failed` with the real reason and the others still proceed. The sky,
lighting and camera — all authored by the compiler — are always delivered, so
the runtime renders the designed environment even when geometry is unavailable.
"""
from __future__ import annotations

import datetime as dt
import threading
import uuid
from dataclasses import dataclass, field
from typing import Callable, Dict, Optional

from . import bake, storage, terrain, t2i, i23d
from .schema import GenerationPlan


@dataclass
class Job:
    job_id: str
    status: str = "queued"          # queued | running | done | failed
    stage: str = "queued"
    progress: float = 0.0
    package: Optional[dict] = None
    error: Optional[str] = None


class JobStore:
    def __init__(self) -> None:
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self) -> Job:
        job = Job(job_id=uuid.uuid4().hex)
        with self._lock:
            self._jobs[job.job_id] = job
        return job

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)


JOBS = JobStore()


def _slot_failed(reason: str) -> dict:
    return {"kind": "failed", "reason": reason}


def _run_main(plan: GenerationPlan, out_dir: str, prov: dict) -> dict:
    """SDXL concept → TripoSR preview → bake → glb slot."""
    img = t2i.generate_image(plan.main_image)
    prov["t2i_model"] = img.model
    prov["seeds"]["main"] = img.seed
    mesh = i23d.reconstruct_preview(img.image, out_dir)
    prov["main_i23d"] = mesh.model
    baked = bake.optimize_glb(mesh.glb_path, mesh.glb_path.replace(".glb", ".opt.glb"))
    url = storage.place_asset(plan.scene.project_id, baked, "main.glb")
    return {"kind": "glb", "url": url, "triangles": mesh.triangles}


def _run_background(plan: GenerationPlan, out_dir: str, prov: dict) -> dict:
    """SDXL terrain concept → Depth Anything heightfield → bake → glb slot."""
    img = t2i.generate_image(plan.background_image)
    terr = terrain.build_terrain(img.image, plan.scene.background, out_dir,
                                 max_triangles=int(plan.scene.constraints.max_background_triangles))
    prov["background_pipeline"] = terr.model
    baked = bake.optimize_glb(terr.glb_path, terr.glb_path.replace(".glb", ".opt.glb"))
    url = storage.place_asset(plan.scene.project_id, baked, "background.glb")
    return {"kind": "glb", "url": url, "triangles": terr.triangles}


def run_job(job: Job, plan: GenerationPlan, compiler_model: str) -> None:
    job.status = "running"
    pid = plan.scene.project_id
    out_dir = storage.project_dir(pid)
    prov: dict = {
        "compiler_model": compiler_model,
        "image_control": plan.main_image.control,
        "licenses": ["OpenRAIL++-M", "Apache-2.0", "MIT"],
        "seeds": {},
        "created_at": dt.datetime.utcnow().isoformat() + "Z",
    }

    def step(stage: str, p: float, fn: Callable[[], dict]) -> dict:
        job.stage, job.progress = stage, p
        try:
            return fn()
        except Exception as e:  # ModelUnavailable or any stage error → honest fail
            return _slot_failed(f"{stage}: {e}")

    main_slot = step("main_model", 0.2, lambda: _run_main(plan, out_dir, prov))
    background_slot = step("background_model", 0.7, lambda: _run_background(plan, out_dir, prov))

    package = {
        "version": "0.1",
        "project_id": pid,
        "assets": {"main_model": main_slot, "background_model": background_slot},
        "sky": plan.sky.model_dump(),
        "lighting": plan.lighting.model_dump(),
        "timeline": plan.timeline.model_dump(),
        "provenance": prov,
    }
    storage.write_package(pid, package)
    job.package = package
    job.stage = "done"
    job.progress = 1.0
    job.status = "done"
