"""Claude layer — assemble a finished, self-contained hero site.

Takes a GenerationPlan (my art-direction) plus whatever asset slots the
open-source models produced, and writes a folder you can open anywhere:

    hero_site/
      index.html  hero.js          (the standalone renderer — my domain)
      package.json                 (the ScenePackage the renderer consumes)
      sky.frag  sky.vert           (GLSL compiled from the plan's SkySpec)
      assets/main.glb  background.glb   (only the slots that succeeded)

No model output is invented: a slot the models couldn't fill is written as
`pending`/`failed` and the renderer simply leaves that part of the stage empty.
"""
from __future__ import annotations

import json
import os
import shutil
from typing import Any, Dict, Optional

from .sky_glsl import compile_sky

_RUNTIME_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "runtime")


def _slot(glb_path: Optional[str], assets_dir: str, name: str,
          triangles: int = 0, fail_reason: Optional[str] = None) -> Dict[str, Any]:
    if glb_path and os.path.isfile(glb_path):
        dst = os.path.join(assets_dir, name)
        if os.path.abspath(glb_path) != os.path.abspath(dst):
            shutil.copyfile(glb_path, dst)
        return {"kind": "glb", "url": f"assets/{name}", "triangles": triangles}
    if fail_reason:
        return {"kind": "failed", "reason": fail_reason}
    return {"kind": "pending"}


def assemble_site(
    plan: Dict[str, Any],
    out_dir: str,
    *,
    main_glb: Optional[str] = None,
    main_triangles: int = 0,
    main_fail: Optional[str] = None,
    background_glb: Optional[str] = None,
    background_triangles: int = 0,
    background_fail: Optional[str] = None,
    provenance: Optional[Dict[str, Any]] = None,
) -> str:
    """Write a complete hero site to ``out_dir`` and return its path."""
    os.makedirs(out_dir, exist_ok=True)
    assets_dir = os.path.join(out_dir, "assets")
    os.makedirs(assets_dir, exist_ok=True)

    # 1. compile the sky shader from the plan's SkySpec
    compiled = compile_sky(plan["sky"])
    with open(os.path.join(out_dir, "sky.frag"), "w") as f:
        f.write(compiled["fragment"])
    with open(os.path.join(out_dir, "sky.vert"), "w") as f:
        f.write(compiled["vertex"])

    # 2. copy the standalone renderer (my domain)
    for fn in ("index.html", "hero.js"):
        shutil.copyfile(os.path.join(_RUNTIME_DIR, fn), os.path.join(out_dir, fn))

    # 3. place the model assets the open-source layer produced
    main_slot = _slot(main_glb, assets_dir, "main.glb", main_triangles, main_fail)
    bg_slot = _slot(background_glb, assets_dir, "background.glb", background_triangles, background_fail)

    # 4. the ScenePackage the renderer consumes
    package = {
        "project_id": plan["scene"]["project_id"],
        "assets": {"main_model": main_slot, "background_model": bg_slot},
        "scene": {
            "main_scale_meters": plan["scene"]["main"]["scale_meters"],
            "background_extent_meters": plan["scene"]["background"]["extent_meters"],
        },
        "sky": {
            "frag": "sky.frag",
            "vert": "sky.vert",
            "uniforms": compiled["uniforms"],
            "features": compiled["features"],
            "fog": plan["sky"]["fog"],
        },
        "lighting": plan["lighting"],
        "timeline": plan["timeline"],
        "provenance": provenance or {},
    }
    with open(os.path.join(out_dir, "package.json"), "w") as f:
        json.dump(package, f, indent=2)

    return out_dir
