"""Runtime configuration for the generator service.

Everything is environment-driven so the same image runs on a laptop (compile
only) or a GPU box (full pipeline). Nothing here hardcodes scene content — the
*scene* is always authored by the compiler from the user's brief.
"""
from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    # Claude scene compiler
    compiler_model: str = os.getenv("HERO_COMPILER_MODEL", "claude-opus-4-8")
    # Where finished packages + assets are written and served from
    output_dir: str = os.getenv("HERO_OUTPUT_DIR", "./_packages")
    public_base: str = os.getenv("HERO_PUBLIC_BASE", "/assets")

    # Image / 3D model identifiers (HF repos). Used by the diffusers wrappers.
    t2i_model: str = os.getenv("HERO_T2I_MODEL", "stabilityai/stable-diffusion-xl-base-1.0")
    t2i_refiner: str = os.getenv("HERO_T2I_REFINER", "stabilityai/stable-diffusion-xl-refiner-1.0")
    controlnet_depth: str = os.getenv("HERO_CONTROLNET_DEPTH", "diffusers/controlnet-depth-sdxl-1.0")
    ip_adapter: str = os.getenv("HERO_IP_ADAPTER", "h94/IP-Adapter")
    depth_model: str = os.getenv("HERO_DEPTH_MODEL", "depth-anything/Depth-Anything-V2-Base-hf")
    triposr_model: str = os.getenv("HERO_TRIPOSR_MODEL", "stabilityai/TripoSR")
    instantmesh_repo: str = os.getenv("HERO_INSTANTMESH_REPO", "TencentARC/InstantMesh")

    device: str = os.getenv("HERO_DEVICE", "cuda")
    # gltfpack binary for Draco/meshopt/KTX2 optimization (optional)
    gltfpack_bin: str = os.getenv("HERO_GLTFPACK", "gltfpack")

    @property
    def has_anthropic_key(self) -> bool:
        return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN"))


settings = Settings()
