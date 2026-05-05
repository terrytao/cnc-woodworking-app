"""Aggregate the cut list into a buy-this-much shopping list.

Strategy:
- Group parts by stock.nominal.
- Per group, length needed = sum of (cutDimensions.length * qty).
- Pick a board length L from the standard set such that L >= the
  longest single piece in the group AND L is the smallest standard
  that holds the total. If the total exceeds the largest standard
  (16 ft), use multiple 16 ft boards.
- Report the per-board waste so the user knows whether to bump the
  next size up for a real 10% safety margin.
"""

from __future__ import annotations

from math import ceil

from .load import Cutlist

# Standard lumber lengths in inches (6, 8, 10, 12, 14, 16 ft).
STANDARD_LENGTHS_IN: tuple[int, ...] = (72, 96, 120, 144, 168, 192)
WASTE_TARGET = 0.10  # informational; actual waste is reported per group


def aggregate_stock(cutlist: Cutlist) -> list[dict]:
    """Return one dict per unique stock nominal with buying info.

    Each dict has::

        {
            "nominal": "2x12",
            "count": 1,
            "min_length_in": 96,
            "for_parts": ["Top (x1)"],
            "actual": {"thickness": 1.5, "width": 11.25},
            "total_part_length_in": 72.0625,
            "actual_waste_in": 23.9375,
        }
    """
    groups: dict[str, dict] = {}

    for part in cutlist.parts:
        nom = part.stock.nominal
        if nom not in groups:
            groups[nom] = {
                "nominal": nom,
                "actual": {
                    "thickness": part.stock.actual.thickness,
                    "width": part.stock.actual.width,
                },
                "for_parts": [],
                "total_part_length_in": 0.0,
                "max_piece_in": 0.0,
            }
        per_part = part.cutDimensions.length * part.qty
        groups[nom]["total_part_length_in"] += per_part
        groups[nom]["max_piece_in"] = max(
            groups[nom]["max_piece_in"], part.cutDimensions.length
        )
        groups[nom]["for_parts"].append(f"{part.partName} (x{part.qty})")

    result: list[dict] = []
    for g in groups.values():
        length, count, waste = _pick_lumber(
            max_piece_in=g["max_piece_in"],
            total_in=g["total_part_length_in"],
        )
        result.append(
            {
                "nominal": g["nominal"],
                "count": count,
                "min_length_in": length,
                "for_parts": g["for_parts"],
                "actual": g["actual"],
                "total_part_length_in": round(g["total_part_length_in"], 4),
                "actual_waste_in": round(waste, 4),
            }
        )

    # Sort by largest stock first (heuristic: longest needed first).
    result.sort(key=lambda r: -r["min_length_in"] * r["count"])
    return result


def _pick_lumber(
    max_piece_in: float, total_in: float
) -> tuple[int, int, float]:
    """Return (length_in, count, waste_in) using standard lumber lengths.

    Each board must be at least as long as the longest single piece in
    the group. The chosen length is the smallest standard that holds
    max(max_piece_in, total_in). If total exceeds the largest standard
    (16 ft), use multiple 16 ft boards.
    """
    candidates = [L for L in STANDARD_LENGTHS_IN if L >= max_piece_in]
    if not candidates:
        # Piece is longer than 16 ft: pin to 16 ft and let count cover it.
        # The user will see the waste field is misleading here; in
        # practice this should never happen for furniture-scale parts.
        L = STANDARD_LENGTHS_IN[-1]
        n = max(1, ceil(total_in / L))
        return L, n, n * L - total_in

    for L in candidates:
        if L >= total_in:
            return L, 1, L - total_in

    # Total exceeds every candidate: use the largest and bump count.
    L = candidates[-1]
    n = max(1, ceil(total_in / L))
    return L, n, n * L - total_in
