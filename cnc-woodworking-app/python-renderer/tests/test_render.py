from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Make `render` importable when running pytest from the python-renderer dir
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from render import (  # noqa: E402
    GALLERY_SPACING_MM,
    build_assembly,
    build_part,
    export_glb,
    export_step,
    load_cutlist,
)

EXAMPLE = Path(__file__).resolve().parent.parent / "examples" / "coffee_table_cutlist.json"


def _stub_part(qty=1, joints=None, length=10.0, width=4.0, thickness=0.75):
    p = {
        "partName": "Stub",
        "qty": qty,
        "cutDimensions": {
            "length": length,
            "width": width,
            "thickness": thickness,
        },
    }
    if joints is not None:
        p["joints"] = joints
    return p


def test_load_cutlist_returns_list_of_parts():
    parts = load_cutlist(EXAMPLE)
    assert isinstance(parts, list)
    assert len(parts) == 4
    assert {p["partName"] for p in parts} == {"Leg", "Long Apron", "Short Apron", "Top"}


def test_build_part_runs_for_every_entry_in_example():
    cutlist = load_cutlist(EXAMPLE)
    for part in cutlist:
        solid = build_part(part)
        assert solid.volume > 0, f"{part['partName']} produced zero volume"


def test_assembly_piece_count_equals_sum_of_qty():
    cutlist = load_cutlist(EXAMPLE)
    asm = build_assembly(cutlist)
    expected = sum(int(p.get("qty", 1)) for p in cutlist)
    assert len(asm.solids()) == expected
    # Sanity: 4 legs + 2 long aprons + 2 short aprons + 1 top = 9
    assert expected == 9


def test_assembly_pieces_are_laid_out_along_x():
    cutlist = load_cutlist(EXAMPLE)
    asm = build_assembly(cutlist)
    bb = asm.bounding_box()
    # Gallery is wider than any single piece, and Y/Z stay modest.
    assert bb.size.X > bb.size.Y
    assert bb.size.X > bb.size.Z
    # Spacing means total X >= sum(piece_lengths) + (n-1) * spacing
    n = len(asm.solids())
    assert bb.size.X >= GALLERY_SPACING_MM * (n - 1)


def test_step_export_writes_non_empty_file(tmp_path):
    cutlist = load_cutlist(EXAMPLE)
    asm = build_assembly(cutlist)
    step_path = tmp_path / "parts.step"
    export_step(asm, step_path)
    assert step_path.exists()
    assert step_path.stat().st_size > 1024  # STEP files have substantial header


def test_glb_export_writes_non_empty_file(tmp_path):
    cutlist = load_cutlist(EXAMPLE)
    asm = build_assembly(cutlist)
    step_path = tmp_path / "parts.step"
    glb_path = tmp_path / "parts.glb"
    export_step(asm, step_path)
    export_glb(step_path, glb_path)
    assert glb_path.exists()
    assert glb_path.stat().st_size > 0
    # GLB binary header starts with magic b"glTF"
    assert glb_path.read_bytes()[:4] == b"glTF"


def test_missing_joints_array_is_treated_as_no_joints():
    part = _stub_part(qty=1)
    assert "joints" not in part
    solid = build_part(part)
    # No joints applied -> volume equals raw stock box
    expected_vol = (10.0 * 25.4) * (4.0 * 25.4) * (0.75 * 25.4)
    assert solid.volume == pytest.approx(expected_vol, rel=1e-9)


def test_joints_explicit_none_is_treated_as_no_joints():
    part = _stub_part(qty=1, joints=None)
    part["joints"] = None
    solid = build_part(part)
    assert solid.volume > 0


def test_qty_zero_contributes_no_pieces_to_assembly():
    cutlist = [_stub_part(qty=0)]
    asm = build_assembly(cutlist)
    assert len(asm.solids()) == 0


def test_unknown_joint_type_is_skipped_without_error():
    bogus_joint = {
        "type": "fictional_joint",
        "position": {"x": 0, "y": 0, "face": "front"},
        "dimensions": {"width": 0.5, "length": 1.0, "depth": 0.25},
    }
    part = _stub_part(qty=1, joints=[bogus_joint])
    solid = build_part(part)
    # Stock box volume is unchanged because the unknown joint is a no-op
    expected_vol = (10.0 * 25.4) * (4.0 * 25.4) * (0.75 * 25.4)
    assert solid.volume == pytest.approx(expected_vol, rel=1e-9)


def test_empty_cutlist_yields_empty_assembly():
    asm = build_assembly([])
    assert len(asm.solids()) == 0
