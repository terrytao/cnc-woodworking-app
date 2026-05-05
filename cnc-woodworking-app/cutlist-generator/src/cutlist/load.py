"""Pydantic models matching joineryEngine.js -> processPartsArray output.

Fields are derived from the canonical example in
examples/coffee_table_cutlist.json. The JSON itself is a top-level
JSON array, so load_cutlist wraps it in a Cutlist container.

All input dimensions are inches (matching the JS engine's convention).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class StockActual(BaseModel):
    model_config = ConfigDict(extra="ignore")
    thickness: float
    width: float


class Stock(BaseModel):
    model_config = ConfigDict(extra="ignore")
    nominal: str
    actual: StockActual


class CutDimensions(BaseModel):
    model_config = ConfigDict(extra="ignore")
    length: float
    width: float
    thickness: float


class JointPosition(BaseModel):
    model_config = ConfigDict(extra="ignore")
    x: float
    y: float
    face: str


class MortiseDimensions(BaseModel):
    """Mortise dimensions in two reference frames.

    `width` / `length` are the kerf-compensated CNC toolpath dims emitted
    by joineryEngine.js for use by the gcode generator. `finishedWidth` /
    `finishedLength` are the pre-comp values — what the actual mortise
    measures with calipers, and what hand-tool consumers should read.
    The finished* fields are optional for backwards compatibility with
    pre-fix-#2 JSON; the loader transparently falls back to the toolpath
    values when they are absent (and the renderer flags it).
    """

    model_config = ConfigDict(extra="ignore")
    width: float
    length: float
    depth: float
    finishedWidth: Optional[float] = None
    finishedLength: Optional[float] = None

    @property
    def display_width(self) -> float:
        return self.finishedWidth if self.finishedWidth is not None else self.width

    @property
    def display_length(self) -> float:
        return self.finishedLength if self.finishedLength is not None else self.length

    @property
    def has_finished_fields(self) -> bool:
        return self.finishedWidth is not None and self.finishedLength is not None


class TenonDimensions(BaseModel):
    """Tenon dimensions in two reference frames.

    `thickness` is already the finished value (the engine never
    kerf-compensates thickness). `width` is kerf-compensated for the
    bandsaw / table-saw kerf and is wider than the actual tenon.
    `finishedWidth` is the pre-comp value, what the tenon should
    actually measure. `finishedThickness` mirrors `thickness` for
    field-name symmetry with the mortise side.
    """

    model_config = ConfigDict(extra="ignore")
    thickness: float
    width: float
    length: float
    finishedThickness: Optional[float] = None
    finishedWidth: Optional[float] = None

    @property
    def display_thickness(self) -> float:
        return self.finishedThickness if self.finishedThickness is not None else self.thickness

    @property
    def display_width(self) -> float:
        return self.finishedWidth if self.finishedWidth is not None else self.width

    @property
    def has_finished_fields(self) -> bool:
        return self.finishedWidth is not None and self.finishedThickness is not None


class DogBone(BaseModel):
    model_config = ConfigDict(extra="ignore")
    x: float
    y: float
    radius: float


class MortiseJoint(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: Literal["mortise"]
    label: Optional[str] = None
    position: JointPosition
    dimensions: MortiseDimensions
    dogBones: list[DogBone] = Field(default_factory=list)
    grainDirection: Optional[str] = None
    fitClearance: Optional[float] = None
    warnings: list[str] = Field(default_factory=list)


class TenonJoint(BaseModel):
    model_config = ConfigDict(extra="ignore")
    type: Literal["tenon"]
    label: Optional[str] = None
    position: JointPosition
    dimensions: TenonDimensions
    grainDirection: Optional[str] = None
    fitClearance: Optional[float] = None
    warnings: list[str] = Field(default_factory=list)


Joint = Annotated[Union[MortiseJoint, TenonJoint], Field(discriminator="type")]


class Part(BaseModel):
    model_config = ConfigDict(extra="ignore")
    partName: str
    qty: int = 1
    stock: Stock
    cutDimensions: CutDimensions
    joints: list[Joint] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    # gcode is preserved by the engine; we deliberately don't model it
    # here -- the cutlist generator never reads it.


class Cutlist(BaseModel):
    """Wrapper for the top-level JSON array."""

    model_config = ConfigDict(extra="ignore")
    parts: list[Part]


class CutlistLoadError(ValueError):
    """Raised when the cut list cannot be read, parsed, or validated."""


def load_cutlist(path: str | Path) -> Cutlist:
    """Read a cut-list JSON file and return a validated Cutlist.

    Raises CutlistLoadError on missing files, malformed JSON, or
    schema violations.
    """
    p = Path(path)
    if not p.exists():
        raise CutlistLoadError(f"cut list not found: {p}")
    try:
        raw = json.loads(p.read_text())
    except json.JSONDecodeError as e:
        raise CutlistLoadError(f"invalid JSON in {p}: {e}") from e
    if not isinstance(raw, list):
        raise CutlistLoadError(
            f"expected a top-level JSON array in {p}, got {type(raw).__name__}"
        )
    try:
        return Cutlist(parts=[Part.model_validate(item) for item in raw])
    except ValidationError as e:
        raise CutlistLoadError(f"invalid cut list in {p}:\n{e}") from e
