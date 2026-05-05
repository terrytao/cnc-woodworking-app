from __future__ import annotations

import json
from pathlib import Path

import pytest

from cutlist import (
    Cutlist,
    aggregate_stock,
    load_cutlist,
    render_html,
    to_fraction,
)
from cutlist.cli import main as cli_main
from cutlist.load import CutlistLoadError
from cutlist.render import _collect_joint_pairs

EXAMPLE = Path(__file__).resolve().parent.parent / "examples" / "coffee_table_cutlist.json"


# ---------- load -----------------------------------------------------------

def test_load_cutlist_succeeds_on_example():
    cl = load_cutlist(EXAMPLE)
    assert isinstance(cl, Cutlist)
    assert len(cl.parts) == 4
    assert {p.partName for p in cl.parts} == {"Leg", "Long Apron", "Short Apron", "Top"}


def test_load_cutlist_raises_on_missing_file(tmp_path):
    with pytest.raises(CutlistLoadError):
        load_cutlist(tmp_path / "nope.json")


def test_load_cutlist_raises_on_non_array(tmp_path):
    p = tmp_path / "bad.json"
    p.write_text(json.dumps({"parts": []}))
    with pytest.raises(CutlistLoadError):
        load_cutlist(p)


# ---------- to_fraction ----------------------------------------------------

@pytest.mark.parametrize(
    "value,expected",
    [
        (0.0, "0"),
        (0.5, "1/2"),
        (0.25, "1/4"),
        (0.125, "1/8"),
        (0.0625, "1/16"),
        (0.53125, "17/32"),
        (1.0, "1"),
        (1.25, "1-1/4"),
        (1.75, "1-3/4"),
        (22.5625, "22-9/16"),
        (0.515625, "33/64"),
        (0.578125, "37/64"),
    ],
)
def test_to_fraction_common_values(value, expected):
    assert to_fraction(value) == expected


def test_to_fraction_handles_none():
    assert to_fraction(None) == ""


def test_to_fraction_handles_negative():
    assert to_fraction(-0.5) == "-1/2"


# ---------- aggregate_stock -----------------------------------------------

def test_aggregate_stock_for_coffee_table():
    cl = load_cutlist(EXAMPLE)
    items = aggregate_stock(cl)
    by_nominal = {it["nominal"]: it for it in items}

    # Three unique stock groups: 2x12 (top), 2x2 (ripped) (legs), 1x4 (aprons)
    assert set(by_nominal) == {"2x12", "2x2 (ripped)", "1x4"}

    # One row per nominal, each count == 1 (everything fits in a single board)
    for nom, item in by_nominal.items():
        assert item["count"] == 1, f"{nom} should fit in one board"
        assert item["min_length_in"] in {72, 96, 120, 144, 168, 192}
        assert item["min_length_in"] >= item["total_part_length_in"]

    # Both apron parts share the 1x4 stock
    one_x_four_for = " | ".join(by_nominal["1x4"]["for_parts"])
    assert "Long Apron" in one_x_four_for
    assert "Short Apron" in one_x_four_for


def test_aggregate_stock_handles_empty_cutlist():
    cl = Cutlist(parts=[])
    assert aggregate_stock(cl) == []


# ---------- render --------------------------------------------------------

def test_render_html_contains_all_part_names():
    cl = load_cutlist(EXAMPLE)
    html = render_html(cl, project_title="Coffee Table")
    for name in ("Leg", "Long Apron", "Short Apron", "Top"):
        assert name in html


def test_render_html_contains_expected_sections():
    cl = load_cutlist(EXAMPLE)
    html = render_html(cl, project_title="Coffee Table")
    for section_marker in (
        "Cut List",
        "Stock List",
        "Cut List Overview",
        "Joinery Summary",
        "Assembly Order",
        "Notes",
    ):
        assert section_marker in html, f"missing section: {section_marker}"


def test_render_html_includes_dimensions_as_fractions():
    cl = load_cutlist(EXAMPLE)
    html = render_html(cl)
    # 22.5625 -> 22-9/16, 1.75 -> 1-3/4 (leg cut dims)
    assert "22-9/16" in html
    assert "1-3/4" in html


def test_collect_joint_pairs_finds_two_pairs():
    cl = load_cutlist(EXAMPLE)
    pairs = _collect_joint_pairs(cl)
    # Each leg has 2 mortises (one labelled Long Apron, one Short Apron),
    # each pairs with the corresponding rail's tenon.
    assert len(pairs) == 2
    labels = {p["label"] for p in pairs}
    assert "Leg ↔ Long Apron" in labels
    assert "Leg ↔ Short Apron" in labels


def test_post_fix_pairs_have_no_fit_warning():
    """After joineryEngine.js fix #2, finishedWidth/finishedThickness
    align (within rounding) so apparent clearance is >= 0."""
    cl = load_cutlist(EXAMPLE)
    pairs = _collect_joint_pairs(cl)
    for p in pairs:
        assert not p["fit_warning"], (
            f"{p['label']}: apparent clearance "
            f"{p['apparent_clearance_in']:+.4f}\" is negative"
        )
        assert not p["legacy_json"], (
            f"{p['label']}: marked legacy but JSON should have finished* fields"
        )


def test_render_omits_fit_warning_class_for_post_fix_json():
    cl = load_cutlist(EXAMPLE)
    html = render_html(cl)
    # The CSS class definition `.warn-row { ... }` is allowed; what we
    # don't want is the class being applied to any <tr>.
    assert 'class="warn-row"' not in html
    assert "Legacy JSON detected" not in html


def test_legacy_json_without_finished_fields_triggers_banner_and_warn_row(tmp_path):
    """Loading a pre-fix JSON should activate the legacy banner and the
    fit-warning row in the joinery summary."""
    cl = load_cutlist(EXAMPLE)
    raw = json.loads(EXAMPLE.read_text())
    # Strip the new fields to simulate a pre-fix engine output
    for part in raw:
        for joint in part.get("joints", []):
            for k in ("finishedWidth", "finishedLength", "finishedThickness"):
                joint.get("dimensions", {}).pop(k, None)
    legacy_path = tmp_path / "legacy.json"
    legacy_path.write_text(json.dumps(raw))
    legacy_cl = load_cutlist(legacy_path)
    html = render_html(legacy_cl)
    assert "Legacy JSON detected" in html
    assert 'class="warn-row"' in html


# ---------- pdf + cli -----------------------------------------------------

def test_pdf_generation_produces_non_empty_file(tmp_path):
    rc = cli_main([str(EXAMPLE), str(tmp_path)])
    assert rc == 0
    pdf = tmp_path / "cutlist.pdf"
    html = tmp_path / "cutlist.html"
    assert html.exists() and html.stat().st_size > 4096
    assert pdf.exists() and pdf.stat().st_size > 4096
    # Valid PDF magic
    assert pdf.read_bytes()[:4] == b"%PDF"


def test_cli_returns_non_zero_on_missing_args():
    rc = cli_main([])
    assert rc != 0
