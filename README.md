# Hero Forge

Research-phase tooling for generating **Active-Theory / Resn-grade 3D website
heroes** from a single brief. Not a template engine — the scene is *decomposed*
and each part is generated independently, then assembled into one cinematic hero.

> Research phase: the productized web studio (Vite app) has been removed. What
> remains is the two-layer generation pipeline and a Colab notebook that drives
> it. Commercialization comes later.

## Two layers

```
 brief
   │
   ▼  Layer 1 · CLAUDE  ── art-direction, shader, renderer, assembly
 ┌──────────────────────────────────────────────────────────────┐
 │ services/generator/app/scene_compiler.py   live compiler      │
 │ colab/claude_layer/                         baked plan + tools │
 │   → GenerationPlan { scene, sky, lighting, camera, prompts }  │
 │   → sky.frag/vert (GLSL)  → standalone Three.js renderer       │
 └───────────────┬──────────────────────────────────────────────┘
                 │ plan + image directives
                 ▼  Layer 2 · OPEN-SOURCE MODELS ── pixels & geometry
 ┌──────────────────────────────────────────────────────────────┐
 │ services/generator/app/{t2i,i23d,terrain,bake}.py             │
 │   SDXL+ControlNet+IP-Adapter → concepts                       │
 │   TripoSR / InstantMesh      → main.glb                        │
 │   SDXL + Depth Anything      → background.glb                  │
 └───────────────┬──────────────────────────────────────────────┘
                 ▼
            hero_site/  — self-contained, open anywhere
```

Sky, lighting and camera are **per-brief generative outputs**, authored by Claude
as validated structured JSON — never a fixed look. Two briefs yield visibly
different skies, palettes, light rigs and camera moves.

## Layout

| Path | What |
|---|---|
| `colab/` | the research notebook + **Claude's layer** (baked plan, sky-DSL→GLSL, standalone renderer, assembly). See `colab/README.md`. |
| `services/generator/` | the **backend**: Scene Compiler (Claude) + the open-source model wrappers (SDXL / TripoSR / InstantMesh / Depth Anything) + FastAPI. See its README. |

## Quick start (Colab)

Open `colab/HeroForge_research.ipynb` in Colab with a GPU runtime and run top to
bottom. It clones this repo, installs the model stack, loads Claude's baked plan,
generates the GLBs, and assembles + previews a `hero_site/`.

## Quick start (Claude layer only, no GPU)

```bash
pip install pydantic
PYTHONPATH=colab python -c "from claude_layer import load_baked, assemble_site; \
  assemble_site(load_baked('obsidian_monolith'), 'hero_site', \
  main_fail='no GPU', background_fail='no GPU')"
# serve hero_site/ and open index.html — sky/lighting/camera render; model slots are empty
```

## Backend service (compile-only, no GPU)

```bash
cd services/generator
pip install fastapi uvicorn pydantic anthropic
export ANTHROPIC_API_KEY=...      # authors the full scene incl. sky/light/camera
uvicorn app.main:app --port 8000  # POST /compile, POST /generate, GET /jobs/{id}
```

## Honesty contract

No model output is faked to keep a demo alive. A stage that can't run (no
GPU/weights) marks its asset slot `failed` with the real reason; the
Claude-authored sky/lighting/camera always render, so the designed environment
shows regardless. There is no procedural stand-in geometry.
