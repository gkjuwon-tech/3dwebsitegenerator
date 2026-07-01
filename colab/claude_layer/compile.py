"""Claude layer — produce a GenerationPlan.

Two paths, same output (a validated plan dict):

  load_baked(name)   — load a plan I authored offline (in plans/). This is me
                       "being" the Scene Compiler so the notebook runs with no
                       Anthropic key — the Claude layer is baked in.
  compile_live(prompt) — call the live Scene Compiler (services/generator) so a
                       fresh brief is art-directed on the spot. Needs
                       ANTHROPIC_API_KEY.

Either way the plan is validated against the same Pydantic schema the backend
uses, so the open-source layer and the renderer receive a guaranteed shape.
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict

_HERE = os.path.dirname(__file__)
_PLANS = os.path.join(_HERE, "plans")
_GENERATOR = os.path.normpath(os.path.join(_HERE, "..", "..", "services", "generator"))


def _ensure_generator_on_path() -> None:
    if _GENERATOR not in sys.path:
        sys.path.insert(0, _GENERATOR)


def _validate(plan: Dict[str, Any]) -> Dict[str, Any]:
    """Validate + normalize through the backend's Pydantic schema if available."""
    try:
        _ensure_generator_on_path()
        from app.schema import GenerationPlan  # type: ignore
        return GenerationPlan.model_validate(plan).model_dump()
    except Exception:
        # schema not importable (pydantic missing) — return as-is; the renderer
        # still consumes the raw dict. Validation is a guard, not a hard dep.
        return plan


def list_baked() -> list[str]:
    return sorted(f[:-5] for f in os.listdir(_PLANS) if f.endswith(".json"))


DEFAULT_BAKED_PLAN = os.environ.get("HERO_BAKED_PLAN", "soccer_boot_ad")


def load_baked(name: str = DEFAULT_BAKED_PLAN) -> Dict[str, Any]:
    path = os.path.join(_PLANS, name + ".json")
    with open(path) as f:
        plan = json.load(f)
    return _validate(plan)


def compile_live(prompt: str) -> Dict[str, Any]:
    _ensure_generator_on_path()
    from app.scene_compiler import compile_scene  # type: ignore
    return compile_scene(prompt).model_dump()
