# cutlist-generator

A printable cut list (HTML + PDF) for **hand-tool woodworkers**, built
from the JSON the JS `joineryEngine.js` already produces. Pure
data-to-document — no 3D, no g-code, no CNC.

## Who this is for

A woodworker who has a furniture project sized and joinery-spec'd by
the upstream pipeline, and wants to **cut everything by hand**: hand
saws, chisels, mallet, marking gauge. They need:

- A clear shopping list ("buy this much of that")
- Final part dimensions in fractional inches
- Per-part joinery specs in language that makes sense at a bench
- A single at-a-glance reference page they can take to the workbench
- An assembly sequence that doesn't assume CNC fixturing

## How it fits with the JS pipeline

`backend/joineryEngine.js -> processPartsArray(parts)` emits a JSON
array of part dicts with `cutDimensions`, `joints` (mortise/tenon),
`stock`, and `gcode`. This service consumes that JSON unmodified and
produces:

- `cutlist.html` — printable from any browser
- `cutlist.pdf`  — same content rendered via WeasyPrint

The `gcode` field is preserved by the engine but **not used** by this
service.

## Setup

```bash
cd cutlist-generator
python3.12 -m venv .venv
.venv/bin/pip install -e ".[dev]"
```

WeasyPrint depends on Pango/cairo system libraries. On macOS:

```bash
brew install pango
```

## Run

```bash
.venv/bin/python -m cutlist examples/coffee_table_cutlist.json output/
```

Writes:

- `output/cutlist.html`
- `output/cutlist.pdf`

## Public API

```python
from cutlist import (
    load_cutlist,     # (path) -> Cutlist (validated Pydantic models)
    aggregate_stock,  # (cutlist) -> shopping list
    render_html,      # (cutlist, project_title=...) -> str
    to_fraction,      # decimal inches -> "22-9/16" style
)
from cutlist.pdf import html_to_pdf
```

## Tests

```bash
.venv/bin/pytest
```

## Document structure

The rendered cut list has seven sections, each starting on its own page:

1. **Project summary** — title, largest-part dims, joinery type, generation date.
2. **Stock list** — what to buy, in standard lumber lengths, with waste left over.
3. **Cut list overview** — one row per part: name, qty, stock, T × W × L.
4. **Per-part details** — final dims, stock callout, joinery specs (one block per joint), notes & warnings, placeholder for a future diagram.
5. **Joinery summary** — bench-side reference: every mortise/tenon pair, side-by-side dimensions, clearance.
6. **Assembly order** — dry-fit, glue ends, connect with long parts, cure, top last with movement allowance.
7. **Notes & caveats** — wood movement, grain orientation, finishing, scrap-test, order of operations.

## Known limitations (v1)

- **No per-part diagrams.** Sections are text-only. The placeholder
  block is wired up so a later patch can drop SVGs in without
  restructuring the template.
- **Generic assembly order.** The narrative is correct for
  four-leg-and-apron tables but doesn't adapt to other piece types
  (cabinets, bookshelves, planters). A future revision can branch on
  inferred topology.
- **Stock waste rounded to one board size per group.** No bin-packing,
  no mixed-length recommendations. If the chosen board has < 10%
  waste, the template surfaces that so the user can decide whether
  to bump up.
- **No species suggestion, no finish recipe.** That's a level of
  guidance the JSON doesn't carry today.
- **One known upstream issue** is documented in
  `JOINERY_BUG_INVESTIGATION.md` and surfaced as a "Fit warning" in
  the rendered Joinery Summary table when present.
