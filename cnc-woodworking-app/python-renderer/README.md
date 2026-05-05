# python-renderer

Renders furniture parts as 3D geometry (STEP + GLB) from the cut list JSON
emitted by `backend/joineryEngine.js`. This is a parallel rendering layer:
the JS engine remains the source of truth for design and g-code in this
phase. The Python service does **not** write g-code and does **not**
replace the JS engine.

## How it fits with `joineryEngine.js`

`backend/joineryEngine.js -> processPartsArray(parts)` produces a JSON
array of part dicts with `cutDimensions`, `joints` (mortise + tenon),
`stock`, and `gcode`. This service consumes that JSON unmodified and
produces:

- `parts.step` — exact CAD geometry (BREP), for downstream CAD tools
- `parts.glb`  — tessellated mesh, for web preview / glTF viewers

The renderer reads exactly what the engine emits and does not reach for
extra fields. To regenerate the canonical example cut list:

```bash
node -e "
const { processPartsArray } = require('./backend/joineryEngine.js');
const fs = require('fs');
const parts = [
  { name: 'Leg',         qty: 4, length: 22.5, width: 1.75, thickness: 1.75 },
  { name: 'Long Apron',  qty: 2, length: 70.5, width: 3.5,  thickness: 0.75 },
  { name: 'Short Apron', qty: 2, length: 22.5, width: 3.5,  thickness: 0.75 },
  { name: 'Top',         qty: 1, length: 72,   width: 24,   thickness: 1.5 },
];
fs.writeFileSync(
  'python-renderer/examples/coffee_table_cutlist.json',
  JSON.stringify(processPartsArray(parts), null, 2)
);"
```

## Setup

```bash
cd python-renderer
python3.12 -m venv .venv
.venv/bin/pip install -e ".[dev]"
```

## Run

```bash
.venv/bin/python render.py examples/coffee_table_cutlist.json output/
```

Writes:

- `output/parts.step` — exact BREP, multi-body
- `output/parts.glb`  — tessellated, viewable in any glTF viewer
  (e.g. [gltf-viewer.donmccurdy.com](https://gltf-viewer.donmccurdy.com))

## Tests

```bash
.venv/bin/pytest
```

## Public API

```python
from render import (
    load_cutlist,    # (path) -> list[dict]
    build_part,      # (part_dict) -> build123d.Part (a Solid wrapper)
    build_assembly,  # (cutlist) -> build123d.Compound (parts gallery)
    export_step,     # (assembly, path) -> None
    export_glb,      # (step_path, glb_path) -> None  (via trimesh)
)
```

All input units are inches (matching the engine's contract); all
internal/output geometry is in millimetres.

## Known limitations (v1)

- **Parts gallery layout, not assembled view.** Pieces are laid side by
  side along +X with 50 mm gaps, one solid per piece (per `qty`).
  Building the assembled table — legs at corners, aprons spanning between
  them, top floating — is a v2 concern.
- **No g-code.** This service does not produce GRBL output; the JS
  engine continues to do that.
- **Engine quirks pass through faithfully.** A 24"-wide top is mapped by
  the JS engine to a `2x12` (11.3125") because the lumber table has no
  sheet-goods awareness; the renderer renders what the engine emits.
- **Two mortises on the same leg overlap.** The JS engine emits both
  rail mortises at the same `(x, y)` position because it uses `legs[0]`
  as the reference for joint geometry. The renderer faithfully cuts both
  pockets at that position; visually they appear as a single pocket.
- **One tenon per rail.** The engine emits one tenon entry per rail at
  `face='end'`. The renderer adds one protruding tenon at the +X end.
  Real rails have tenons at both ends — this is an engine-side
  simplification we don't fix here.
- **Coordinate convention is a renderer choice.** The engine's joint
  position fields (`face: 'front'` / `'end'`, `x`, `y`) are 2D
  face-local. The renderer maps mortises to the +Z face and tenons to
  the +X end face. See `render.py` docstring for details.
- **Unknown joint types are silently skipped** so a partial cut list
  still renders. Today the engine only emits `mortise` and `tenon`.
