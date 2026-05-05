"""Render furniture parts from joineryEngine.js cut list output.

Input contract: JSON array of part dicts as produced by
backend/joineryEngine.js -> processPartsArray. All input units are inches;
all internal/output geometry is in millimetres.

Coordinate convention for build_part:
    X = part length, Y = part width, Z = part thickness.
    Stock box anchored at the origin (corner at 0, 0, 0).
    Mortises are cut into the +Z face. The engine's mortise
    position.(x, y) is taken as the (X, Y) offset of the pocket's
    minimum corner on that face; dimensions.depth extends into -Z.
    Tenons are added as a protruding block at the +X end face,
    centred on the Y-Z cross section.

Coordinate convention for build_assembly:
    Parts gallery: each piece (per qty) is placed sitting on the XY
    plane (Z=0), translated along +X with GALLERY_SPACING_MM gaps.
    This is NOT an assembled-table view -- assembled positioning is
    deferred to v2.
"""

from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

from build123d import (
    Align,
    Box,
    Compound,
    Cylinder,
    Location,
    Part,
)
from build123d import export_step as _b3d_export_step
from build123d import export_stl as _b3d_export_stl
from build123d import import_step as _b3d_import_step

INCH_TO_MM = 25.4
GALLERY_SPACING_MM = 50.0


def _in(x: float) -> float:
    return float(x) * INCH_TO_MM


def load_cutlist(path: str | Path) -> list[dict]:
    """Read and return the engine's cut-list JSON as a list of part dicts."""
    p = Path(path)
    raw = json.loads(p.read_text())
    if not isinstance(raw, list):
        raise ValueError(
            f"expected top-level array in {p}, got {type(raw).__name__}"
        )
    return raw


def build_part(part: dict) -> Part:
    """Build a single part as a build123d Part.

    Stock is a rectangular box at the part's cutDimensions. Mortise
    joints are subtracted as rectangular pockets with cylindrical
    dog-bone reliefs at the four corner positions from joint.dogBones.
    Tenon joints are fused on as a protruding block at the +X end,
    leaving shoulders implicit. Unknown joint types are silently
    skipped so a partial cut list still renders.
    """
    cd = part["cutDimensions"]
    L, W, T = _in(cd["length"]), _in(cd["width"]), _in(cd["thickness"])

    solid: Part = Box(L, W, T, align=(Align.MIN, Align.MIN, Align.MIN))

    for joint in (part.get("joints") or []):
        jtype = joint.get("type")
        if jtype == "mortise":
            solid = solid - _mortise_pocket(joint, T)
        elif jtype == "tenon":
            solid = solid + _tenon_protrusion(joint, L, W, T)
        # Unknown joint types are skipped without raising; the engine
        # currently emits only mortise/tenon, so anything else is either
        # a future engine feature or a malformed entry.

    return solid


def _mortise_pocket(joint: dict, stock_T_mm: float) -> Part:
    pos = joint["position"]
    dim = joint["dimensions"]
    px, py = _in(pos["x"]), _in(pos["y"])
    mw, ml, md = _in(dim["width"]), _in(dim["length"]), _in(dim["depth"])

    rect = Box(mw, ml, md, align=(Align.MIN, Align.MIN, Align.MIN))
    pocket: Part = Location((px, py, stock_T_mm - md)) * rect

    for db in joint.get("dogBones", []) or []:
        dx, dy = _in(db["x"]), _in(db["y"])
        r = _in(db["radius"])
        cyl = Cylinder(r, md, align=(Align.CENTER, Align.CENTER, Align.MIN))
        pocket = pocket + Location((dx, dy, stock_T_mm - md)) * cyl

    return pocket


def _tenon_protrusion(joint: dict, L_mm: float, W_mm: float, T_mm: float) -> Part:
    dim = joint["dimensions"]
    tt, tl, tw = _in(dim["thickness"]), _in(dim["length"]), _in(dim["width"])
    block = Box(tl, tw, tt, align=(Align.MIN, Align.CENTER, Align.CENTER))
    return Location((L_mm, W_mm / 2, T_mm / 2)) * block


def build_assembly(cutlist: list[dict]) -> Compound:
    """Lay out one solid per piece (per qty) as a parts-gallery row.

    Each part is built once; per-qty translated copies are placed at
    increasing X positions with GALLERY_SPACING_MM gaps between
    bounding boxes. Y/Z origins are normalised so each piece sits at
    Y=0, Z=0. qty <= 0 contributes no pieces; an empty cutlist
    produces an empty Compound.
    """
    pieces: list[Part] = []
    cursor_x = 0.0

    for part in cutlist:
        try:
            qty = int(part.get("qty", 1))
        except (TypeError, ValueError):
            qty = 1
        if qty <= 0:
            continue

        solid = build_part(part)
        bb = solid.bounding_box()
        sx = bb.size.X
        # Normalise so the part's (min X, min Y, min Z) sits at the cursor.
        for _ in range(qty):
            placed = Location(
                (cursor_x - bb.min.X, -bb.min.Y, -bb.min.Z)
            ) * solid
            pieces.append(placed)
            cursor_x += sx + GALLERY_SPACING_MM

    return Compound(label="parts_gallery", children=pieces)


def export_step(assembly: Compound | Part, path: str | Path) -> None:
    """Write a STEP file (exact BREP) of the assembly."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    _b3d_export_step(assembly, str(p))


def export_glb(step_path: str | Path, glb_path: str | Path) -> None:
    """Convert STEP to GLB via STL tessellation + trimesh.

    trimesh has no native STEP reader, so we round-trip through a
    temporary STL. Tolerances are tuned for furniture-scale parts
    (mm precision is overkill for visualisation).
    """
    import trimesh

    sp = Path(step_path)
    gp = Path(glb_path)
    gp.parent.mkdir(parents=True, exist_ok=True)

    shape = _b3d_import_step(str(sp))

    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as tmp:
            tmp_path = Path(tmp.name)
        _b3d_export_stl(
            shape, str(tmp_path), tolerance=0.1, angular_tolerance=0.2
        )
        mesh = trimesh.load_mesh(str(tmp_path))
        mesh.export(str(gp))
    finally:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) < 2:
        print(
            "usage: python render.py <cutlist.json> <out_dir>",
            file=sys.stderr,
        )
        return 2

    cutlist_path = Path(args[0])
    out_dir = Path(args[1])
    out_dir.mkdir(parents=True, exist_ok=True)

    cutlist = load_cutlist(cutlist_path)
    asm = build_assembly(cutlist)

    step_path = out_dir / "parts.step"
    glb_path = out_dir / "parts.glb"
    export_step(asm, step_path)
    export_glb(step_path, glb_path)

    n_pieces = len(asm.solids())
    print(f"parts gallery: {n_pieces} piece(s) from {len(cutlist)} part row(s)")
    print(f"  STEP: {step_path}  ({step_path.stat().st_size:,} bytes)")
    print(f"  GLB:  {glb_path}   ({glb_path.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
