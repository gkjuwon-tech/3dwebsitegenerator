# `colab/` — research notebook + the Claude layer

This folder is the research-phase entry point. It produces a finished website
hero from a brief by combining **two layers**:

```
                 ┌─────────────────────────────────────────────┐
 brief  ───────▶ │  Layer 1 · CLAUDE  (this folder)            │
                 │   claude_layer/  +  runtime/                 │
                 │   • GenerationPlan (scene/sky/light/camera)  │
                 │   • SkySpec → GLSL ES sky shader             │
                 │   • standalone Three.js renderer             │
                 │   • site assembly                            │
                 └───────────────┬─────────────────────────────┘
                                 │ plan + image directives
                                 ▼
                 ┌─────────────────────────────────────────────┐
                 │  Layer 2 · OPEN-SOURCE MODELS (../services)  │
                 │   SDXL → TripoSR/InstantMesh → main.glb      │
                 │   SDXL → Depth Anything   → background.glb   │
                 └───────────────┬─────────────────────────────┘
                                 ▼
                          hero_site/  (open anywhere)
```

Layer 1 is **Claude's domain** and is baked into this folder — Claude already
authored a plan, the shader transpiler, and the renderer, so the notebook runs
with no Anthropic key. Layer 2 is **the open-source models' domain** and lives in
`../services/generator`; the notebook drives it on a GPU.

## Contents

| Path | Layer | What |
|---|---|---|
| `HeroForge_research.ipynb` | — | the Colab notebook that runs both layers end-to-end |
| `claude_layer/compile.py` | 1 | load a baked plan, or live-compile a brief via the backend's Scene Compiler |
| `claude_layer/plans/*.json` | 1 | concrete `GenerationPlan`s Claude authored (the compiler's output, baked) |
| `claude_layer/sky_glsl.py` | 1 | `SkySpec` → GLSL ES transpiler (conditional emission) |
| `claude_layer/assemble.py` | 1 | assemble a self-contained `hero_site/` from a plan + asset slots |
| `runtime/index.html` + `hero.js` | 1 | no-build Three.js renderer (CDN three.js): sky+PMREM, PBR rig, post-fx, keyframe camera |

## Run in Colab

1. Open `HeroForge_research.ipynb` in Colab, set Runtime → **GPU**.
2. Run the cells top to bottom. Cell 2 clones the repo; the install cell pulls
   the model stack; layer 1 loads the baked plan; layer 2 generates the GLBs;
   the last cells assemble `hero_site/`, preview it inline, and zip it.
3. To art-direct a *new* brief live, set `USE_LIVE = True` and provide
   `ANTHROPIC_API_KEY`.

## Run layer 1 locally (no GPU)

```bash
pip install pydantic
PYTHONPATH=colab python -c "
from claude_layer import load_baked, assemble_site
plan = load_baked('obsidian_monolith')
assemble_site(plan, 'hero_site',
              main_fail='no GPU here', background_fail='no GPU here')
print('wrote hero_site/ — open index.html via a static server')
"
```

The site renders the AI-designed sky, lighting and camera immediately; the model
slots show `failed` until layer 2 fills them on a GPU.
