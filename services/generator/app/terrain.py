"""Background terrain: T2I concept → monocular depth (Depth Anything V2) →
heightfield → decimated, vertex-coloured mesh → GLB.

This is the report's recommended ground-background path: predictable scale and a
flat-ish, collision-stable horizontal plane, which generic object I23D models do
not give you. It is a real depth→geometry pipeline (Depth Anything is a real
model), not a procedural stand-in for a 3D generator.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

from .config import settings
from .schema import BackgroundSpec
from .t2i import ModelUnavailable


@dataclass
class TerrainResult:
    glb_path: str
    triangles: int
    model: str


@lru_cache(maxsize=1)
def _depth_pipe():
    try:
        import torch  # noqa: F401
        from transformers import pipeline
    except Exception as e:  # pragma: no cover
        raise ModelUnavailable(f"transformers/torch not importable for depth: {e}") from e
    device = 0 if settings.device == "cuda" else -1
    return pipeline("depth-estimation", model=settings.depth_model, device=device)


def build_terrain(concept_image, spec: BackgroundSpec, out_dir: str, *, grid: int = 192,
                  max_triangles: int = 50_000) -> TerrainResult:
    """Extrude a heightfield mesh from the concept image's estimated depth."""
    try:
        import numpy as np
        import trimesh
        from PIL import Image
    except Exception as e:  # pragma: no cover
        raise ModelUnavailable(f"numpy/trimesh/PIL missing for terrain: {e}") from e

    depth = _depth_pipe()(concept_image)["depth"]
    depth = np.asarray(depth.resize((grid, grid))).astype(np.float32)
    depth = (depth - depth.min()) / (depth.ptp() + 1e-6)

    extent = float(spec.extent_meters)
    relief = extent * 0.08  # vertical relief proportional to extent, kept gentle
    xs = np.linspace(-extent / 2, extent / 2, grid)
    zs = np.linspace(-extent / 2, extent / 2, grid)
    gx, gz = np.meshgrid(xs, zs)
    # depth near=high → invert so foreground reads as raised ground at the edges
    gy = (1.0 - depth) * relief
    # taper edges down so the island reads as ground-bearing, not a wall
    rad = np.sqrt(gx**2 + gz**2) / (extent / 2)
    gy *= np.clip(1.2 - rad, 0.0, 1.0)

    verts = np.stack([gx, gy, gz], axis=-1).reshape(-1, 3)
    faces = []
    for j in range(grid - 1):
        for i in range(grid - 1):
            a = j * grid + i
            b = a + 1
            c = a + grid
            d = c + 1
            faces.append([a, c, b])
            faces.append([b, c, d])
    faces = np.asarray(faces)

    color_src = np.asarray(Image.fromarray(np.asarray(concept_image)).resize((grid, grid)))
    if color_src.ndim == 2:
        color_src = np.repeat(color_src[..., None], 3, axis=-1)
    colors = color_src[:, :, :3].reshape(-1, 3).astype(np.uint8)

    mesh = trimesh.Trimesh(vertices=verts, faces=faces, vertex_colors=colors, process=True)
    if len(mesh.faces) > max_triangles:
        try:
            mesh = mesh.simplify_quadric_decimation(max_triangles)
        except Exception:
            pass  # decimation is best-effort; bake.py compresses regardless

    os.makedirs(out_dir, exist_ok=True)
    glb = os.path.join(out_dir, "background.glb")
    mesh.export(glb)
    return TerrainResult(glb_path=glb, triangles=int(len(mesh.faces)),
                         model=f"SDXL + {settings.depth_model} + heightfield")
