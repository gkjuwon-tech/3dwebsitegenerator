"""Asset optimization: Draco geometry + meshopt + KTX2/Basis textures via
gltfpack. Falls back to copying the raw GLB when gltfpack isn't installed, so
the pipeline still delivers a usable (if larger) asset.
"""
from __future__ import annotations

import os
import shutil
import subprocess

from .config import settings


def optimize_glb(src: str, dst: str) -> str:
    """Compress a GLB for web delivery. Returns the output path actually written."""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if shutil.which(settings.gltfpack_bin):
        try:
            subprocess.run(
                [settings.gltfpack_bin, "-i", src, "-o", dst, "-cc", "-tc", "-mi"],
                check=True, capture_output=True,
            )
            return dst
        except subprocess.CalledProcessError:
            pass  # fall through to a plain copy
    shutil.copyfile(src, dst)
    return dst
