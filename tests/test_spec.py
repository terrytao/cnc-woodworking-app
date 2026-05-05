from __future__ import annotations

import json
from pathlib import Path

import pytest

from cnc_furniture.spec import (
    FurnitureSpec,
    JoineryType,
    MACHINE_X_MM,
    PieceType,
    SpecError,
    load_spec,
)

EXAMPLE_SPEC = Path(__file__).resolve().parent.parent / "examples" / "stool_spec.json"


def _mutate(tmp_path: Path, mutator) -> Path:
    raw = json.loads(EXAMPLE_SPEC.read_text())
    mutator(raw)
    p = tmp_path / "spec.json"
    p.write_text(json.dumps(raw))
    return p


def test_valid_spec_loads():
    spec = load_spec(EXAMPLE_SPEC)
    assert isinstance(spec, FurnitureSpec)
    assert spec.piece_type is PieceType.STOOL
    assert len(spec.parts) == 4
    assert len(spec.joints) == 4
    assert all(j.type is JoineryType.TAB_AND_SLOT for j in spec.joints)
    assert spec.stock.thickness == 18.0


def test_oversized_part_raises(tmp_path):
    def mutate(raw):
        raw["parts"][0]["dimensions"]["length"] = MACHINE_X_MM + 100
    bad = _mutate(tmp_path, mutate)
    with pytest.raises(SpecError) as ei:
        load_spec(bad)
    assert "envelope" in str(ei.value).lower()


def test_joint_with_unknown_part_raises(tmp_path):
    def mutate(raw):
        raw["joints"][0]["parts"] = ["seat", "ghost_part"]
    bad = _mutate(tmp_path, mutate)
    with pytest.raises(SpecError) as ei:
        load_spec(bad)
    assert "ghost_part" in str(ei.value)


def test_missing_required_field_raises(tmp_path):
    def mutate(raw):
        del raw["piece_type"]
    bad = _mutate(tmp_path, mutate)
    with pytest.raises(SpecError):
        load_spec(bad)


def test_missing_file_raises(tmp_path):
    with pytest.raises(SpecError):
        load_spec(tmp_path / "does_not_exist.json")


def test_malformed_json_raises(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text("{not valid json")
    with pytest.raises(SpecError):
        load_spec(p)


def test_duplicate_part_id_raises(tmp_path):
    def mutate(raw):
        raw["parts"][1]["id"] = raw["parts"][0]["id"]
    bad = _mutate(tmp_path, mutate)
    with pytest.raises(SpecError) as ei:
        load_spec(bad)
    assert "duplicate" in str(ei.value).lower()
