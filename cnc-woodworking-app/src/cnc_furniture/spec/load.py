from __future__ import annotations

import json
from pathlib import Path

from pydantic import ValidationError

from .schema import FurnitureSpec


class SpecError(ValueError):
    """Raised when a spec file cannot be read, parsed, or validated."""


def load_spec(path: str | Path) -> FurnitureSpec:
    """Load a furniture spec from a JSON file and return a validated model.

    Raises SpecError on missing files, malformed JSON, or schema violations.
    """
    p = Path(path)
    if not p.exists():
        raise SpecError(f"spec file not found: {p}")
    try:
        raw = json.loads(p.read_text())
    except json.JSONDecodeError as e:
        raise SpecError(f"invalid JSON in {p}: {e}") from e
    try:
        return FurnitureSpec.model_validate(raw)
    except ValidationError as e:
        raise SpecError(f"invalid spec in {p}:\n{e}") from e
