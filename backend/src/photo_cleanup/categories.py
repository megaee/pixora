"""Content categories ("what is in this photo"), scored with CLIP zero-shot in AI mode.

Each category is described by several short prompts; CLIP compares the photo with the averaged
prompt embedding of every category and a softmax turns that into one score per category (0..1,
summing to 1). This is separate from visual similarity: two coffee photos from different cafés
share a category without being near-duplicates.

Thresholds were calibrated on real photos and on generated screenshots/receipts/chats; see
`classify` for how ambiguous photos end up in "Other / Unclassified" instead of getting a guess.
"""

from __future__ import annotations

from dataclasses import dataclass

# Bump when prompts change: cached scores from older versions are recomputed.
PROMPTS_VERSION = 1

# Hidden "nothing in particular" class: without it the softmax pushes abstract images, noise or
# blank frames into some real category. If it wins, the photo is Other / Unclassified.
BACKGROUND_PROMPTS = (
    "an abstract pattern",
    "a blank or blurry image of nothing in particular",
    "random noise texture",
    "a solid color background",
)

OTHER = "other"
OTHER_LABEL = "Other / Unclassified"


@dataclass(frozen=True)
class Category:
    id: str
    label: str
    prompts: tuple[str, ...]


CATEGORIES: tuple[Category, ...] = (
    Category(
        "selfies",
        "Selfies & Talking",
        (
            "a selfie",
            "a close-up portrait of a person's face",
            "a person talking to the camera",
            "a vlog frame of someone speaking",
        ),
    ),
    Category(
        "outfits",
        "Outfits",
        (
            "a photo of an outfit",
            "a mirror selfie showing clothes",
            "a full-body fashion photo of what someone is wearing",
            "clothes and shoes laid out",
        ),
    ),
    Category(
        "food",
        "Food & Cafés",
        (
            "a photo of food",
            "a meal on a plate",
            "a cup of coffee in a café",
            "a restaurant table with dishes and drinks",
        ),
    ),
    Category(
        "travel",
        "Travel & Vibes",
        (
            "a travel photo",
            "a famous landmark",
            "a person posing at a scenic viewpoint on holiday",
            "a city street while travelling",
        ),
    ),
    Category(
        "nature",
        "Nature",
        (
            "a landscape photo of nature",
            "mountains and hills",
            "a beach and the sea",
            "a forest with trees",
            "plants and flowers",
        ),
    ),
    Category(
        "spaces",
        "Aesthetic Spaces",
        (
            "a beautiful interior design",
            "a cozy aesthetic room",
            "modern architecture",
            "a stylish café or hotel interior",
        ),
    ),
    Category(
        "sports",
        "Sports & Wellness",
        (
            "people exercising",
            "a gym workout",
            "running outdoors",
            "a sports game",
            "yoga or meditation",
        ),
    ),
    Category(
        "music",
        "Music & Hobby",
        (
            "a musical instrument",
            "a concert on stage",
            "music equipment and headphones",
            "a person painting or doing a craft hobby",
        ),
    ),
    Category(
        "wfh",
        "Work From Home",
        (
            "a laptop on a desk",
            "a home office workstation",
            "a computer setup with a monitor and keyboard",
            "a video call on a laptop",
        ),
    ),
    Category(
        "text",
        "Text & Emails",
        (
            "a photo of text messages",
            "an email open on a screen",
            "a chat conversation with message bubbles",
            "handwritten notes on paper",
        ),
    ),
    Category(
        "screenshots",
        "Screenshots",
        (
            "a screenshot of a phone app",
            "a screenshot of a website",
            "a screen capture of a user interface",
            "a mobile phone screenshot with a status bar",
        ),
    ),
    Category(
        "documents",
        "Documents & Receipts",
        (
            "a scanned document",
            "a paper receipt from a shop",
            "a bill or an invoice",
            "a printed form with text",
        ),
    ),
    Category(
        "pets",
        "Pets & Animals",
        (
            "a photo of a pet dog",
            "a photo of a cat",
            "a pet animal at home",
            "an animal close up",
        ),
    ),
    Category(
        "friends",
        "Friends & Social",
        (
            "a group of friends",
            "people hanging out together",
            "a group photo of several people smiling",
        ),
    ),
    Category(
        "events",
        "Events & Celebrations",
        (
            "a birthday party",
            "a wedding",
            "a celebration with decorations and balloons",
            "a festival crowd at an event",
        ),
    ),
)

CATEGORY_IDS: tuple[str, ...] = tuple(c.id for c in CATEGORIES)
LABELS: dict[str, str] = {c.id: c.label for c in CATEGORIES} | {OTHER: OTHER_LABEL}

# A primary category needs at least this score, and a clear lead over the runner-up;
# otherwise the photo is "Other / Unclassified". Extra labels need LABEL_MIN.
MIN_CONFIDENCE = 0.35
MIN_MARGIN = 0.08
LABEL_MIN = 0.15
SCORES_LEN = len(CATEGORY_IDS) + 1  # categories + background, as produced by the model


def classify(scores: list[float] | None, override: str | None = None) -> dict:
    """Primary category, confidence and all labels for one photo.

    `scores` are softmax scores in CATEGORY_IDS order followed by the background score
    (None = not analysed or unreadable). A user override always wins: it becomes the only label.
    """
    labels: list[dict] = []
    primary, confidence = OTHER, 0.0
    if scores and len(scores) == SCORES_LEN:
        background = scores[-1]
        ranked = sorted(zip(CATEGORY_IDS, scores[:-1], strict=True), key=lambda t: -t[1])
        (top, top_s), (_, second_s) = ranked[0], ranked[1]
        confidence = top_s
        # labels only for a confident primary: an unsure photo gets none rather than a guess
        if background < top_s and top_s >= MIN_CONFIDENCE and top_s - second_s >= MIN_MARGIN:
            primary = top
            labels = [{"id": c, "score": round(s, 3)} for c, s in ranked if s >= LABEL_MIN]
    if override:
        primary, labels = override, [{"id": override, "score": 1.0}]
    return {
        "category": primary,
        "confidence": round(confidence, 3),
        "labels": labels,
        "overridden": bool(override),
    }
