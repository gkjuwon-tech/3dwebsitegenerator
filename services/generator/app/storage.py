"""Filesystem-backed package store. In production these writes target an object
store + CDN (R2/S3); here they land under output_dir and are served statically.
"""
from __future__ import annotations

import json
import os
import shutil

from .config import settings


def project_dir(project_id: str) -> str:
    d = os.path.join(settings.output_dir, project_id)
    os.makedirs(d, exist_ok=True)
    return d


def place_asset(project_id: str, src_path: str, name: str) -> str:
    """Move a finished asset into the project dir and return its public URL."""
    d = project_dir(project_id)
    dst = os.path.join(d, name)
    if os.path.abspath(src_path) != os.path.abspath(dst):
        shutil.copyfile(src_path, dst)
    return f"{settings.public_base}/{project_id}/{name}"


def write_package(project_id: str, package: dict) -> str:
    d = project_dir(project_id)
    path = os.path.join(d, "package.json")
    with open(path, "w") as f:
        json.dump(package, f, indent=2)
    return path
