"""The Scene Compiler — the one component that turns a free-text brief into a
fully art-directed, structured GenerationPlan using Claude.

This is where the product's thesis lives: it is NOT a template engine. Sky,
lighting, camera choreography and interaction are *designed per brief* by the
model, as structured JSON, then validated. The compiler never reaches for a
fixed look — every value (sun direction, palette, kelvin temperatures, camera
keyframes, easing, fog) is a decision the model makes for this specific site.
"""
from __future__ import annotations

import json
import re
import uuid

from anthropic import Anthropic

from .config import settings
from .schema import GenerationPlan, plan_json_schema

SYSTEM = """\
You are the Scene Compiler for a high-end generative 3D web studio whose bar is \
Active Theory and Resn — cinematic, tactile, "expensive-feeling" WebGL hero scenes.

You receive a short brief describing a single 3D hero scene and you output a \
complete, internally-consistent GenerationPlan as structured JSON. You are the \
technical art director: every field is a deliberate design decision tailored to \
THIS brief. There is no house style, no default look, no template. Two different \
briefs must yield visibly different skies, palettes, light rigs and camera moves.

Decompose the scene into independently-generated parts and make them cohere:

1. scene — normalize the brief: the hero (subject, material family, silhouette, \
real-world scale in meters), the ground-bearing background (never a full world — \
an island/tundra/dunes/etc. with a sane extent in meters), the sky brief, the \
interaction mood, and the camera intent. Pick a short project_id slug.

2. main_image / background_image — the T2I directives that downstream SDXL + \
ControlNet + IP-Adapter will run. The MAIN prompt must be object-centric on a \
clean/neutral seamless background (so single-image 3D reconstruction is clean), \
richly describing material, form and lighting. The BACKGROUND prompt describes a \
ground/terrain concept suitable for depth-based heightfield extrusion. Choose \
ControlNet conditioning ('depth' is the safe default; 'canny'/'normal' when form \
matters) and a sensible guidance_scale. Leave seed null unless reproducibility is \
implied.

3. sky — a constrained sky DSL that compiles to GLSL. CHOOSE the timeOfDay (0=mid\
night, 0.25=dawn, 0.5=noon, 0.75=dusk), a physically-plausible sunDirection unit \
vector, and a palette in LINEAR space (zenith/horizon/ground/sun colors as RGB \
0..1) that matches the mood. Decide whether clouds, aurora and stars belong here \
at all — a noon desert has no aurora; a polar night does. Tune coverage, fog \
density and color to sit the hero in the scene.

4. lighting — a PBR light rig SEPARATE from the sky shader, but consistent with \
it: the key light's direction should agree with the sun; color temperatures \
(kelvin) and intensities should express the same hour and mood (warm low sun vs \
cold overcast). Always include at least a key and a rim; add fill/point/spot when \
the look calls for it. Set exposure and post-fx (tone mapping, bloom, vignette, \
chromatic aberration, grain) to taste — restrained for premium, never blown out. \
fog color should relate to the sky horizon.

5. timeline — camera choreography as keyframes in METERS. The hero's base sits at \
y=0 and is centered near the origin; frame it for its scale and silhouette. Author \
3–5 keyframes (position, target, fov) with per-segment easing that realizes the \
described reveal. Then bind interactions: scroll usually 'scrub's the camera over \
a page range; pointer drives 'micro_parallax'; idle can 'auto_orbit'. Use only the \
axes the brief implies. Keep duration_sec in the 8–16s range unless told otherwise.

Coordinate everything: a stormy dusk means low warm key + heavy fog + dim bloom + \
slow heavy camera; a bright alien noon means high cold key + crisp shadows + tight \
energetic moves. Respect the constraints block (triangle/payload budgets, 60fps \
desktop). Output ONLY the JSON for the schema — no prose outside the 'notes' field, \
where you briefly explain the art-direction choices you made.
"""


class CompilerError(RuntimeError):
    pass


def _extract_json(text: str) -> dict:
    text = text.strip()
    # tolerate a fenced block if the model wraps it
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    return json.loads(text)


def _v3(v, fallback):
    if not isinstance(v, list) or len(v) != 3:
        return list(fallback)
    return [float(x) for x in v[:3]]


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, float(x)))


def _normalize(plan: GenerationPlan) -> GenerationPlan:
    """Enforce the numeric ranges the Structured-Outputs schema could not express,
    and repair degenerate keyframe arrays — without overriding the model's *choices*."""
    s = plan.sky
    s.timeOfDay = _clamp(s.timeOfDay, 0.0, 1.0)
    s.sunDirection = _v3(s.sunDirection, [0.4, 0.2, -0.9])
    for attr in ("zenithColor", "horizonColor", "groundColor", "sunColor"):
        setattr(s, attr, [_clamp(c, 0.0, 4.0) for c in _v3(getattr(s, attr), [0.5, 0.5, 0.5])])
    s.sunSize = _clamp(s.sunSize, 0.0005, 0.5)
    s.clouds.coverage = _clamp(s.clouds.coverage, 0.0, 1.0)
    s.clouds.height = _clamp(s.clouds.height, 0.0, 1.0)
    s.stars.density = _clamp(s.stars.density, 0.0, 1.0)

    for lt in plan.lighting.lights:
        lt.color_kelvin = _clamp(lt.color_kelvin, 1000, 20000)
        lt.intensity = max(0.0, lt.intensity)
        if lt.direction:
            lt.direction = _v3(lt.direction, [0, -1, 0])
        if lt.position:
            lt.position = _v3(lt.position, [0, 5, 0])
    plan.lighting.exposure = _clamp(plan.lighting.exposure, 0.1, 4.0)

    for track in plan.timeline.camera_tracks:
        n = min(len(track.times), len(track.position), len(track.target))
        if n < 1:
            raise CompilerError("camera track has no keyframes")
        track.times = [float(t) for t in track.times[:n]]
        track.position = [_v3(p, [0, 1, 4]) for p in track.position[:n]]
        track.target = [_v3(t, [0, 1, 0]) for t in track.target[:n]]
        track.easing = track.easing[: max(0, n - 1)]
        track.fov = _clamp(track.fov, 10, 100)
    plan.timeline.duration_sec = _clamp(plan.timeline.duration_sec, 2, 60)
    return plan


def compile_scene(prompt: str, *, client: Anthropic | None = None) -> GenerationPlan:
    """Brief → validated GenerationPlan, authored by Claude with full discretion."""
    if not settings.has_anthropic_key:
        raise CompilerError(
            "No Anthropic credentials. Set ANTHROPIC_API_KEY (or run `ant auth login`) "
            "so the Scene Compiler can author the plan."
        )
    client = client or Anthropic()
    schema = plan_json_schema()

    resp = client.messages.create(
        model=settings.compiler_model,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        system=SYSTEM,
        messages=[{"role": "user", "content": prompt}],
        output_config={"format": {"type": "json_schema", "schema": schema}},
    )
    if resp.stop_reason == "refusal":
        raise CompilerError("Scene Compiler request was declined by safety classifiers.")

    text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
    if not text.strip():
        raise CompilerError("Scene Compiler returned no JSON.")

    data = _extract_json(text)
    # stamp a unique project id if the model reused one
    pid = data.get("scene", {}).get("project_id") or "hero"
    data.setdefault("scene", {})["project_id"] = f"{pid}-{uuid.uuid4().hex[:6]}"

    plan = GenerationPlan.model_validate(data)
    return _normalize(plan)
