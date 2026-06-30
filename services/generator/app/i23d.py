"""Image-to-3D: TripoSR for fast preview reconstruction, InstantMesh for the
final pass. Real wrappers around the published model APIs.

TripoSR exposes a clean Python API (the `tsr` package from the official repo).
InstantMesh ships as scripts, so the final pass shells out to its `run.py`.
Either path raises ModelUnavailable when its weights/runtime are missing — no
geometry is ever synthesized to fake a result.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
from dataclasses import dataclass
from functools import lru_cache

from .config import settings
from .t2i import ModelUnavailable


@dataclass
class MeshResult:
    glb_path: str
    triangles: int
    model: str


def _preprocess(image):
    """White-background removal + recentering, the standard I23D front-end."""
    try:
        import rembg
        from PIL import Image
        import numpy as np
        from tsr.utils import remove_background, resize_foreground
    except Exception as e:  # pragma: no cover
        raise ModelUnavailable(f"TripoSR preprocessing deps missing: {e}") from e
    session = rembg.new_session()
    img = remove_background(image, session)
    img = resize_foreground(img, 0.85)
    arr = np.array(img).astype(np.float32) / 255.0
    arr = arr[:, :, :3] * arr[:, :, 3:4] + (1 - arr[:, :, 3:4]) * 0.5
    return Image.fromarray((arr * 255.0).astype("uint8"))


@lru_cache(maxsize=1)
def _load_triposr():
    try:
        import torch
        from tsr.system import TSR
    except Exception as e:  # pragma: no cover
        raise ModelUnavailable(f"TripoSR (`tsr`) not importable: {e}") from e
    model = TSR.from_pretrained(
        settings.triposr_model, config_name="config.yaml", weight_name="model.ckpt",
    )
    model.renderer.set_chunk_size(8192)
    model.to(settings.device if torch.cuda.is_available() else "cpu")
    return model


def reconstruct_preview(image, out_dir: str, *, resolution: int = 256) -> MeshResult:
    """Fast single-image reconstruction with TripoSR (~sub-second on GPU)."""
    import torch

    model = _load_triposr()
    proc = _preprocess(image)
    with torch.no_grad():
        scene_codes = model([proc], device=model.device)
        meshes = model.extract_mesh(scene_codes, has_vertex_color=True, resolution=resolution)
    mesh = meshes[0]
    os.makedirs(out_dir, exist_ok=True)
    glb = os.path.join(out_dir, "main_preview.glb")
    mesh.export(glb)
    return MeshResult(glb_path=glb, triangles=int(len(mesh.faces)), model="VAST-AI-Research/TripoSR")


def reconstruct_final(image, out_dir: str) -> MeshResult:
    """High-quality reconstruction with InstantMesh (sparse-view → textured mesh).

    Invokes the official run.py; expects HERO_INSTANTMESH_DIR to point at a clone
    with weights present.
    """
    repo_dir = os.getenv("HERO_INSTANTMESH_DIR")
    if not repo_dir or not os.path.isdir(repo_dir):
        raise ModelUnavailable(
            "InstantMesh repo not found. Clone TencentARC/InstantMesh and set "
            "HERO_INSTANTMESH_DIR to enable the final reconstruction pass."
        )
    os.makedirs(out_dir, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        in_path = os.path.join(tmp, "input.png")
        image.save(in_path)
        cmd = [
            "python", os.path.join(repo_dir, "run.py"),
            os.path.join(repo_dir, "configs/instant-mesh-large.yaml"),
            in_path, "--output_path", out_dir, "--export_texmap",
        ]
        subprocess.run(cmd, cwd=repo_dir, check=True)
    # InstantMesh writes meshes/<name>.glb
    meshes_dir = os.path.join(out_dir, "meshes")
    glbs = [f for f in os.listdir(meshes_dir) if f.endswith(".glb")] if os.path.isdir(meshes_dir) else []
    if not glbs:
        raise ModelUnavailable("InstantMesh produced no GLB output.")
    glb = os.path.join(meshes_dir, glbs[0])
    tri = _count_triangles(glb)
    return MeshResult(glb_path=glb, triangles=tri, model="TencentARC/InstantMesh")


def _count_triangles(glb_path: str) -> int:
    try:
        import trimesh
        m = trimesh.load(glb_path, force="mesh")
        return int(len(m.faces))
    except Exception:
        return 0
