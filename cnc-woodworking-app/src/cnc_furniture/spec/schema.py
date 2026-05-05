"""Spec schema for parametric CNC furniture.

All dimensions are millimetres. Parts are flat sheet-good rectangles cut
from a stock sheet on a Shapeoko-class router; thickness equals the sheet
thickness for every part.
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, PositiveFloat, PositiveInt, model_validator

# Machine cut envelope (Shapeoko 4x4). Parts must fit within this in some
# rotation; stock sheets may be larger and get split/nested downstream.
MACHINE_X_MM: float = 1220.0
MACHINE_Y_MM: float = 1220.0


class JoineryType(str, Enum):
    TAB_AND_SLOT = "tab_and_slot"
    FINGER_JOINT = "finger_joint"
    CROSS_LAP = "cross_lap"
    DADO = "dado"
    POCKET_TENON = "pocket_tenon"


class PieceType(str, Enum):
    TABLE = "table"
    STOOL = "stool"
    BENCH = "bench"
    BOOKSHELF = "bookshelf"
    SIDE_TABLE = "side_table"
    PLANTER = "planter"


class Dimensions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    length: PositiveFloat
    width: PositiveFloat
    thickness: PositiveFloat


class Stock(BaseModel):
    """A sheet of material as purchased. Default is a 4x8 ft baltic birch sheet."""

    model_config = ConfigDict(extra="forbid")

    sheet_length: PositiveFloat = 2440.0
    sheet_width: PositiveFloat = 1220.0
    thickness: PositiveFloat = 18.0
    material: str = "baltic_birch"


class Part(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    dimensions: Dimensions
    quantity: PositiveInt = 1
    notes: str | None = None


class Joint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    type: JoineryType
    parts: list[str] = Field(min_length=2)
    notes: str | None = None


class FurnitureSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1)
    piece_type: PieceType
    overall_dimensions: Dimensions
    parts: list[Part] = Field(min_length=1)
    joints: list[Joint] = Field(default_factory=list)
    stock: Stock = Field(default_factory=Stock)

    @model_validator(mode="after")
    def _check_unique_part_ids(self) -> "FurnitureSpec":
        seen: set[str] = set()
        for p in self.parts:
            if p.id in seen:
                raise ValueError(f"duplicate part id: {p.id!r}")
            seen.add(p.id)
        return self

    @model_validator(mode="after")
    def _check_parts_fit_machine(self) -> "FurnitureSpec":
        env_long = max(MACHINE_X_MM, MACHINE_Y_MM)
        env_short = min(MACHINE_X_MM, MACHINE_Y_MM)
        for p in self.parts:
            long_side = max(p.dimensions.length, p.dimensions.width)
            short_side = min(p.dimensions.length, p.dimensions.width)
            if long_side > env_long or short_side > env_short:
                raise ValueError(
                    f"part {p.id!r} ({p.dimensions.length}x{p.dimensions.width}mm) "
                    f"exceeds machine cut envelope ({MACHINE_X_MM}x{MACHINE_Y_MM}mm) "
                    f"in either rotation"
                )
        return self

    @model_validator(mode="after")
    def _check_joint_part_refs(self) -> "FurnitureSpec":
        valid_ids = {p.id for p in self.parts}
        for j in self.joints:
            missing = [pid for pid in j.parts if pid not in valid_ids]
            if missing:
                raise ValueError(
                    f"joint {j.id!r} references unknown part id(s): {missing}"
                )
        return self
