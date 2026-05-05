"""Render a hand-tool cut list as HTML via Jinja2."""

from __future__ import annotations

from datetime import datetime
from fractions import Fraction
from pathlib import Path
from typing import Optional

from jinja2 import Environment, FileSystemLoader, StrictUndefined, select_autoescape

from .load import Cutlist, MortiseJoint, TenonJoint
from .stock_aggregator import aggregate_stock

TEMPLATES_DIR = Path(__file__).resolve().parent.parent.parent / "templates"


def to_fraction(decimal_in: Optional[float], denom: int = 64) -> str:
    """Convert decimal inches to a reduced fractional string.

    Rounds to 1/`denom` (default 1/64") and reduces. Uses a hyphen
    between the whole and the fraction so the value never breaks
    across a soft wrap in narrow table cells.

        >>> to_fraction(0.53125)
        '17/32'
        >>> to_fraction(1.75)
        '1-3/4'
        >>> to_fraction(22.5625)
        '22-9/16'
    """
    if decimal_in is None:
        return ""
    sign = "-" if decimal_in < 0 else ""
    abs_val = abs(float(decimal_in))
    ticks = round(abs_val * denom)
    if ticks == 0:
        return f"{sign}0" if abs_val == 0 else f"{sign}~0"
    f = Fraction(ticks, denom)  # auto-reduces
    whole, rem_num, rem_den = f.numerator // f.denominator, 0, 1
    rem = f - whole
    if rem != 0:
        rem_num, rem_den = rem.numerator, rem.denominator
    if rem_num == 0:
        return f"{sign}{whole}"
    if whole == 0:
        return f"{sign}{rem_num}/{rem_den}"
    return f"{sign}{whole}-{rem_num}/{rem_den}"


def _format_inches(value: Optional[float]) -> str:
    if value is None:
        return ""
    return f'{to_fraction(value)}"'


def _length_str(inches: int | float) -> str:
    """Render a length in inches as a feet-and-inches string."""
    if inches >= 12:
        feet, rem = divmod(inches, 12)
        if rem == 0:
            return f'{int(feet)} ft ({int(inches)}")'
        return f'{int(feet)} ft {int(rem)}" ({int(inches)}")'
    return f'{int(inches)}"'


def _collect_joint_pairs(cutlist: Cutlist) -> list[dict]:
    """For each leg-side mortise, find the rail's tenon by partName label.

    Reads the finished* fields from JOINERY_BUG_INVESTIGATION fix #2
    when present; falls back to the toolpath fields for legacy JSON.
    The pair's `legacy_jsons` flag is set when the fallback was used,
    so the template can surface a "regenerate your cut list" notice.
    """
    tenons: dict[str, tuple[str, TenonJoint]] = {}
    for part in cutlist.parts:
        for j in part.joints:
            if isinstance(j, TenonJoint):
                tenons[part.partName] = (part.partName, j)
                break

    pairs: list[dict] = []
    for part in cutlist.parts:
        for j in part.joints:
            if isinstance(j, MortiseJoint) and j.label and j.label in tenons:
                _rail_name, tenon = tenons[j.label]
                legacy = not (
                    j.dimensions.has_finished_fields
                    and tenon.dimensions.has_finished_fields
                )
                m_w = j.dimensions.display_width
                m_l = j.dimensions.display_length
                t_t = tenon.dimensions.display_thickness
                t_w = tenon.dimensions.display_width
                apparent = m_w - t_t
                pairs.append(
                    {
                        "label": f"{part.partName} ↔ {j.label}",
                        "mortise_on": part.partName,
                        "tenon_on": j.label,
                        "mortise_w": m_w,
                        "mortise_l": m_l,
                        "mortise_d": j.dimensions.depth,
                        "tenon_t": t_t,
                        "tenon_w": t_w,
                        "tenon_l": tenon.dimensions.length,
                        "engine_clearance": j.fitClearance,
                        "apparent_clearance_in": apparent,
                        "fit_warning": apparent < 0,
                        "legacy_json": legacy,
                    }
                )
    return pairs


def _has_legacy_dimensions(cutlist: Cutlist) -> bool:
    """True when any joint in the cutlist lacks fix-#2 finished fields."""
    for part in cutlist.parts:
        for j in part.joints:
            if not j.dimensions.has_finished_fields:
                return True
    return False


def _build_env() -> Environment:
    env = Environment(
        loader=FileSystemLoader(TEMPLATES_DIR),
        autoescape=select_autoescape(["html"]),
        undefined=StrictUndefined,
        trim_blocks=True,
        lstrip_blocks=True,
    )
    env.filters["frac"] = to_fraction
    env.filters["inches"] = _format_inches
    env.filters["length_str"] = _length_str
    return env


def render_html(
    cutlist: Cutlist,
    *,
    project_title: str = "Cut List",
    css_inline: bool = True,
) -> str:
    """Render the full cut list document as a single HTML string."""
    env = _build_env()
    template = env.get_template("cutlist.html.jinja")

    stock_list = aggregate_stock(cutlist)
    joint_pairs = _collect_joint_pairs(cutlist)

    parts = list(cutlist.parts)
    overall_l = max((p.cutDimensions.length for p in parts), default=0.0)
    overall_w = max((p.cutDimensions.width for p in parts), default=0.0)
    overall_t = max((p.cutDimensions.thickness for p in parts), default=0.0)

    css_text = ""
    if css_inline:
        css_path = TEMPLATES_DIR / "cutlist.css"
        if css_path.exists():
            css_text = css_path.read_text()

    return template.render(
        project_title=project_title,
        generated_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
        parts=parts,
        stock_list=stock_list,
        joint_pairs=joint_pairs,
        overall_l=overall_l,
        overall_w=overall_w,
        overall_t=overall_t,
        css_text=css_text,
        legacy_json=_has_legacy_dimensions(cutlist),
    )
