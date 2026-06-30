"""Claude layer — the art-direction + shader + renderer + assembly domain.

This is the half of the pipeline Claude owns: turning a brief into a structured,
validated scene plan, compiling its sky to GLSL, and assembling a self-contained
hero site. The open-source models (services/generator) own the other half — the
actual pixels and geometry.
"""
from .compile import load_baked, compile_live, list_baked
from .sky_glsl import compile_sky
from .assemble import assemble_site

__all__ = ["load_baked", "compile_live", "list_baked", "compile_sky", "assemble_site"]
