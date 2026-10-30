"""Optional AI mode: group photos by content and pick the best one with local models.

Install with `make setup-ai` (pip extra `ai`). Everything runs on this machine; the models are
downloaded once from Hugging Face (~700 MB) into ~/.cache/huggingface. Photos are never uploaded.

- Grouping: DINOv2-small image embeddings (CLS token + mean patch token), compared with cosine
  similarity and clustered with complete linkage, so every pair in a group is similar (no chains).
- Best photo: CLIP-IQA style zero-shot quality, i.e. how strongly CLIP prefers "Good photo." over
  "Bad photo." (plus sharp/blurry, well/poorly exposed, beautiful/ugly), averaged to 0..1.
- Content categories: CLIP zero-shot against the prompts in categories.py (same image pass).
"""

from __future__ import annotations

import importlib.util
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Protocol

from .categories import BACKGROUND_PROMPTS, CATEGORIES, PROMPTS_VERSION

if TYPE_CHECKING:
    from PIL import Image

    from .analysis import Photo

GROUP_MODEL = "facebook/dinov2-small"
QUALITY_MODEL = "openai/clip-vit-base-patch32"
QUALITY_PROMPTS = [
    ("Good photo.", "Bad photo."),
    ("Sharp photo.", "Blurry photo."),
    ("Well-exposed photo.", "Poorly exposed photo."),
    ("Beautiful photo.", "Ugly photo."),
]
# Calibrated on GoPro bursts: 0.97 = near-identical, 0.95 = same pose, 0.90 = same place.
DEFAULT_SIMILARITY = 0.95
# Cached features are only reused when produced by the same models and prompts.
FEATURES_VERSION = f"{GROUP_MODEL}|{QUALITY_MODEL}|prompts-{PROMPTS_VERSION}"
INSTALL_HINT = "AI mode is not installed. Run `make setup-ai` and restart the app."


def available() -> bool:
    return all(importlib.util.find_spec(m) for m in ("torch", "transformers", "numpy", "scipy"))


@dataclass
class Features:
    embedding: list[float]  # L2-normalised
    quality: float  # 0..1, higher is better
    # softmax scores per content category (categories.CATEGORY_IDS order) + background; empty
    # when the analyzer does not classify
    categories: list[float] = field(default_factory=list)


class Analyzer(Protocol):
    models: list[str]

    def load(self) -> None: ...

    def analyse(self, images: Sequence[Image.Image]) -> list[Features]: ...


class LocalModels:
    """DINOv2 + CLIP on the best local device (Apple GPU, CUDA or CPU). Loaded on first use."""

    models = [GROUP_MODEL, QUALITY_MODEL]

    def __init__(self) -> None:
        self._loaded = False

    def load(self) -> None:
        if self._loaded:
            return
        import torch
        import transformers
        from transformers import AutoImageProcessor, AutoModel, CLIPModel, CLIPProcessor

        transformers.logging.set_verbosity_error()
        if torch.backends.mps.is_available():
            self.device = "mps"
        elif torch.cuda.is_available():
            self.device = "cuda"
        else:
            self.device = "cpu"
        self._dino_proc = AutoImageProcessor.from_pretrained(GROUP_MODEL)
        self._dino = AutoModel.from_pretrained(GROUP_MODEL).to(self.device).eval()
        self._clip_proc = CLIPProcessor.from_pretrained(QUALITY_MODEL)
        self._clip = CLIPModel.from_pretrained(QUALITY_MODEL).to(self.device).eval()
        with torch.no_grad():
            pairs = self._text_embeds([t for pair in QUALITY_PROMPTS for t in pair])
            self._quality_text = pairs
            # one embedding per category: the normalised mean of its prompts
            groups = [c.prompts for c in CATEGORIES] + [BACKGROUND_PROMPTS]
            emb = self._text_embeds([t for g in groups for t in g])
            cats, i = [], 0
            for g in groups:
                cats.append(torch.nn.functional.normalize(emb[i : i + len(g)].mean(0), dim=-1))
                i += len(g)
            self._category_text = torch.stack(cats)
        self._loaded = True

    def _text_embeds(self, texts: list[str]):
        import torch

        tok = self._clip_proc(text=texts, return_tensors="pt", padding=True).to(self.device)
        out = self._clip.text_model(**tok)  # stable across transformers 4.x and 5.x
        return torch.nn.functional.normalize(self._clip.text_projection(out.pooler_output), dim=-1)

    def analyse(self, images: Sequence[Image.Image]) -> list[Features]:
        import torch

        self.load()
        with torch.no_grad():
            pixels = self._dino_proc(images=list(images), return_tensors="pt").to(self.device)
            h = self._dino(**pixels).last_hidden_state
            emb = torch.nn.functional.normalize(torch.cat([h[:, 0], h[:, 1:].mean(1)], 1), dim=1)

            pixels = self._clip_proc(images=list(images), return_tensors="pt").to(self.device)
            out = self._clip.vision_model(pixel_values=pixels["pixel_values"])
            img = self._clip.visual_projection(out.pooler_output)
            img = torch.nn.functional.normalize(img, dim=-1)
            scale = self._clip.logit_scale.exp()
            logits = scale * img @ self._quality_text.T
            pos = logits.view(len(images), len(QUALITY_PROMPTS), 2).softmax(-1)[..., 0]
            quality = pos.mean(-1)
            cats = (scale * img @ self._category_text.T).softmax(-1)
        return [
            Features(
                embedding=e.tolist(),
                quality=round(float(q), 4),
                categories=[round(float(x), 4) for x in c],
            )
            for e, q, c in zip(emb.cpu(), quality.cpu(), cats.cpu(), strict=True)
        ]


def group_by_embedding(
    photos: list[Photo], embeddings: dict[str, list[float]], min_similarity: float
) -> list[list[Photo]]:
    """Complete-linkage clusters: every pair in a group has cosine similarity >= min_similarity."""
    if len(photos) < 2:
        return [[p] for p in photos]
    import numpy as np
    from scipy.cluster.hierarchy import fcluster, linkage
    from scipy.spatial.distance import squareform

    e = np.array([embeddings[p.id] for p in photos], dtype=np.float32)
    dist = np.clip(1.0 - e @ e.T, 0.0, 2.0)
    np.fill_diagonal(dist, 0.0)
    labels = fcluster(
        linkage(squareform(dist, checks=False), "complete"),
        t=1.0 - min_similarity,
        criterion="distance",
    )
    buckets: dict[int, list[Photo]] = {}
    for p, label in zip(photos, labels, strict=True):
        buckets.setdefault(int(label), []).append(p)
    groups = [sorted(g, key=lambda p: p.date) for g in buckets.values()]
    groups.sort(key=lambda g: (-len(g), g[0].date))
    return groups
