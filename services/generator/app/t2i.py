"""Text-to-image: SDXL base + refiner, with optional ControlNet-depth and
IP-Adapter conditioning, via 🤗 diffusers.

Real model wrapper. There is no synthetic fallback: if torch/diffusers or the
weights/GPU are unavailable, generation raises and the calling pipeline marks
the affected asset slot `failed` with an honest reason. We never fabricate an
image to keep a demo alive.
"""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from typing import Optional

from .config import settings
from .schema import ImageDirective


class ModelUnavailable(RuntimeError):
    """Raised when the ML stack (torch/diffusers/weights/GPU) isn't present."""


@dataclass
class T2IResult:
    image: "object"  # PIL.Image.Image
    seed: int
    model: str


@lru_cache(maxsize=1)
def _load_pipelines():
    try:
        import torch
        from diffusers import StableDiffusionXLPipeline, StableDiffusionXLImg2ImgPipeline
    except Exception as e:  # pragma: no cover - depends on heavy deps
        raise ModelUnavailable(f"diffusers/torch not importable: {e}") from e

    if settings.device == "cuda" and not torch.cuda.is_available():
        raise ModelUnavailable("CUDA requested but no GPU is available for SDXL.")

    dtype = torch.float16 if settings.device == "cuda" else torch.float32
    base = StableDiffusionXLPipeline.from_pretrained(
        settings.t2i_model, torch_dtype=dtype, variant="fp16" if dtype == torch.float16 else None,
        use_safetensors=True,
    ).to(settings.device)
    refiner = StableDiffusionXLImg2ImgPipeline.from_pretrained(
        settings.t2i_refiner, torch_dtype=dtype, use_safetensors=True,
        text_encoder_2=base.text_encoder_2, vae=base.vae,
    ).to(settings.device)
    base.enable_vae_tiling()
    return base, refiner


def generate_image(
    directive: ImageDirective,
    *,
    width: int = 1024,
    height: int = 1024,
    reference_image: Optional["object"] = None,
) -> T2IResult:
    """Render one concept image for a directive (main hero or terrain concept).

    Uses the SDXL base→refiner ensemble-of-experts split. ``reference_image``, if
    given, is fed through IP-Adapter for style/colour locking.
    """
    import torch

    base, refiner = _load_pipelines()
    seed = directive.seed if directive.seed is not None else int(torch.randint(0, 2**31 - 1, (1,)).item())
    generator = torch.Generator(device=settings.device).manual_seed(seed)

    if reference_image is not None:
        base.load_ip_adapter(settings.ip_adapter, subfolder="sdxl_models",
                             weight_name="ip-adapter_sdxl.safetensors")
        base.set_ip_adapter_scale(0.6)

    high_noise_frac = 0.8
    latents = base(
        prompt=directive.prompt,
        negative_prompt=directive.negative_prompt,
        guidance_scale=directive.guidance_scale,
        width=width, height=height,
        num_inference_steps=40,
        denoising_end=high_noise_frac,
        output_type="latent",
        generator=generator,
        **({"ip_adapter_image": reference_image} if reference_image is not None else {}),
    ).images

    image = refiner(
        prompt=directive.prompt,
        negative_prompt=directive.negative_prompt,
        image=latents,
        num_inference_steps=40,
        denoising_start=high_noise_frac,
        generator=generator,
    ).images[0]

    return T2IResult(image=image, seed=seed, model=settings.t2i_model)
