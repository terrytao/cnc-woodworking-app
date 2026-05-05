> **RESOLUTION (2026-05-05):** Fix #2 from §6 has been applied. The
> engine now emits `finishedWidth` / `finishedLength` /
> `finishedThickness` alongside the existing kerf-compensated
> `width` / `length` / `thickness` fields. CNC consumers (the
> frontend, `python-renderer`, the gcode generator) keep reading the
> toolpath values they always have. Hand-tool consumers (the
> `cutlist-generator`) now read the `finished*` values. The cut
> list's "Fit warning" is gone for any newly generated JSON; a
> "Legacy JSON detected" banner now shows when an old-shape JSON is
> rendered, so a stale file is obvious. See §8 below for what was
> changed.

# Joinery dimension contract — investigation

**TL;DR:** The mortise/tenon dimensions in the engine's JSON output are
not in the same reference frame, so a downstream consumer that compares
`mortise.dimensions.width` to `tenon.dimensions.thickness` sees the
tenon as larger than the mortise. The engine internally produces a
correct-by-design joint, but the per-axis kerf-compensation logic is
applied **only** to the mortise side of the output, leaving the
contract ambiguous and the UI's apparent display wrong.

This is **finding (b)**: a real dimensional contract bug in the engine.
The UI is not mislabelling — it is faithfully showing
`mortise.dimensions.width` (labelled "W") and
`tenon.dimensions.thickness` (labelled "T"), and these two fields are
*not* directly comparable.

No fix has been applied. The cut-list template surfaces a "Fit warning"
when the apparent clearance is negative.

---

## 1. What the UI actually displays

`frontend/src/App.jsx` lines 57–87 (`<JointDetail>`) reads
`joint.dimensions` straight from the JSON and passes individual fields
through `toFraction()`:

```jsx
{isMortise ? (
  <>
    <span><span>W</span>{toFraction(d.width)}</span>
    <span><span>L</span>{toFraction(d.length)}</span>
    <span><span>D</span>{toFraction(d.depth)}</span>
  </>
) : (
  <>
    <span><span>T</span>{toFraction(d.thickness)}</span>
    <span><span>L</span>{toFraction(d.length)}</span>
    <span><span>W</span>{toFraction(d.width)}</span>
  </>
)}
```

`frontend/src/utils/fractions.js` rounds to the nearest **1/32"**
(`TICKS_PER_INCH = 32`).

The labels `W` (mortise width) and `T` (tenon thickness) are correct
names for the underlying engine fields — the UI is not swapping or
mislabelling them.

## 2. What the JSON values actually are

For the canonical 24×24×72 coffee table
(`examples/coffee_table_cutlist.json`):

| Joint                         | Field                          | JSON value | Frontend display (1/32) | Cutlist display (1/64) |
|-------------------------------|--------------------------------|-----------:|------------------------:|-----------------------:|
| Leg, mortise for Long Apron   | `dimensions.width`             |  0.515625" |          17/32"          |               33/64"   |
| Long Apron, tenon             | `dimensions.thickness`         |  0.578125" |          19/32"          |               37/64"   |
| Difference (tenon − mortise)  |                                | +0.062500" |        +1/16" larger     |             +1/16" larger |
| `tenon.fitClearance` (engine) |                                |   0.003"   |                          |                        |

So the JSON itself reports a tenon thickness **1/16" greater than** the
mortise width — physically, that tenon will not fit. But the engine's
`fitClearance` is the intended-good value (0.003").

## 3. What the engine math actually does

`backend/joineryEngine.js`, lines 292–322 of `calculateJoints`:

```js
const idealMortiseWidth = legThickness / 3;        // 1.75 / 3   = 0.5833
const idealTenonThick   = idealMortiseWidth - GLUE_CLEARANCE;  // 0.5803
const maxTenonThick     = railThickness - 0.125;   // 0.75 − 0.125 = 0.625

let rawTenonThickness = idealTenonThick;           // 0.5803 (not clamped)
const rawMortiseWidth = rawTenonThickness + GLUE_CLEARANCE;  // 0.5833

// ... mortise length and tenon width clamps ...

// CNC dimensions — rounded to nearest 1/64"
const mortiseWidth   = roundTo64th(rawMortiseWidth);     // 0.5781 (37/64)
const tenonThickness = roundTo64th(rawTenonThickness);   // 0.5781 (37/64)

// Kerf compensation only on X-Y router-plane dimensions (length, width).
// Thickness gets none — it's set by the stock, not a router cut.
const mortiseWidthComp  = roundTo64th(mortiseWidth  - KERF_COMPENSATION); // 0.5156 (33/64)
const mortiseLengthComp = roundTo64th(mortiseLength - KERF_COMPENSATION);
const tenonThickComp    = tenonThickness;     // ← unchanged: 0.5781 (37/64)
const tenonWidthComp    = roundTo64th(tenonWidth + KERF_COMPENSATION);
```

Then the output objects (lines 347–375):

```js
const mortiseDims = { width: mortiseWidthComp, length: mortiseLengthComp, depth: mortiseDepth };
const tenonDims   = { thickness: tenonThickComp, length: rawTenonLength, width: tenonWidthComp };
```

### What this means

The engine has two distinct concepts of "mortise width" and treats them
inconsistently:

| Stage                      | Mortise width | Tenon thickness | Comparable? |
|----------------------------|--------------:|----------------:|:------------|
| `raw…` (pre-rounding)      |      0.5833"  |        0.5803"  | yes — diff is `GLUE_CLEARANCE` (0.003") |
| `mortiseWidth` / `tenonThickness` (rounded to 1/64) |  0.5781" |        0.5781" | yes — equal after rounding (clearance lost) |
| `…Comp` (kerf-compensated) **— THIS IS WHAT GETS WRITTEN TO JSON** |  0.5156" |        0.5781" | **no** |

The mortise width gets `KERF_COMPENSATION` (1/16") **subtracted** from
it because the mortise is cut by a router bit travelling along the
*centerline* of a programmed rectangle — to end up with a final
0.5781" pocket, the toolpath rect is programmed 1/16" smaller in each
dimension. The tenon thickness gets **no** compensation because, per
the inline comment, "thickness is set by the stock, not a router cut."

Both of those individual statements are reasonable. The bug is that
both end up in identically-named JSON fields
(`joint.dimensions.<dim>`) and there is **no marker** distinguishing
"this is a toolpath-frame number" from "this is a finished-material
number." A consumer (the UI, the new cut-list generator) reading two
fields from the same object reasonably assumes they live in the same
reference frame, and arrives at a tenon-too-fat-for-the-mortise
picture.

## 4. Why it appears to work in practice

If a CNC operator runs the emitted g-code, the bit traces the
kerf-comp'd toolpath, the actual pocket comes out 1/16" wider in each
axis (= the pre-comp `mortiseWidth` ≈ 0.5781"), and the tenon (cut by
a different process — table saw, bandsaw, or chisel — to
`tenonThickness` ≈ 0.5781") fits with the rounding-eaten 0.003"
clearance. The output is internally consistent **with the gcode**, just
not with the consumer reading dimension fields side-by-side.

## 5. Impact on this cut-list generator

For a hand-tool woodworker, kerf compensation is **meaningless** — they
are not driving a router bit, they are chopping with a chisel. The
correct mortise width to lay out is the **finished** value
(`mortiseWidth`, ≈ 0.5781" / 37/64"), not the toolpath value
(`mortiseWidthComp`, ≈ 0.5156" / 33/64").

If this cut list is used as-printed today, a hand-tool worker would:

- Mark and chop a mortise to 33/64" wide
- Cut a tenon to 37/64" thick
- Spend the rest of the day paring the tenon down by 1/16" so it fits

Per the task instructions, **no fix has been applied here.** The
cutlist template renders the JSON values verbatim, but the
**Joinery Summary** section now flags negative apparent clearance with
a `warn-row` highlight and a "Fit warning" paragraph that explains the
contract issue and recommends, until upstream is fixed, cutting both
parts to the larger value (37/64") with 0.003" shaved off the tenon.

## 6. Possible upstream fixes (for later — not applied)

Listed roughly in order of least-to-most invasive:

1. **Document the contract.** Rename the JSON fields so the reference
   frame is explicit, e.g.
   `mortise.toolpath.width` vs `mortise.finished.width`. Consumers
   either pick the one they need or fail loudly.
2. **Emit both values.** Keep the fields the engine currently writes,
   and add `mortise.dimensions.finishedWidth` and
   `tenon.dimensions.finishedThickness`. Hand-tool consumers read the
   "finished" pair; CNC consumers keep using what's there.
3. **Stop kerf-comping in `dimensions`.** Move the kerf-comp values
   into a separate `mortise.toolpath` block used only by
   `generateGcode`. The `dimensions` block always carries finished
   geometry. This is the right long-term shape but breaks the gcode
   pipeline until it's updated to read the new field path.
4. **Re-design the engine output for the new pipeline.** The Python
   pipeline is intended to replace the JS engine eventually; that's
   the natural place to fix this once. Until then, the
   "Fit warning" callout in the cutlist makes the issue visible at
   the bench so a careful builder won't miss it.

## 8. What changed when fix #2 was applied (2026-05-05)

### `backend/joineryEngine.js`

`calculateJoints` now writes the additional `finishedWidth`,
`finishedLength`, and `finishedThickness` fields onto
`mortiseDims` / `tenonDims` (around the line previously emitting
`{ width: mortiseWidthComp, length: mortiseLengthComp, depth: ... }`).
Mathematically:

- `mortise.dimensions.finishedWidth`  = pre-comp `mortiseWidth`  ≈ `width  + KERF_COMPENSATION`
- `mortise.dimensions.finishedLength` = pre-comp `mortiseLength` ≈ `length + KERF_COMPENSATION`
- `tenon.dimensions.finishedThickness` = `tenonThickness` (no kerf comp on thickness; equals existing `thickness`)
- `tenon.dimensions.finishedWidth`     = pre-comp `tenonWidth`   ≈ `width − KERF_COMPENSATION`

The kerf-compensated fields (`width`, `length`, `thickness`) are
**byte-for-byte unchanged**, so the frontend, `python-renderer`, the
gcode generator, and any other CNC consumer continues to work
exactly as before.

### `backend/__tests__/joineryEngine.test.js` (new)

Six tests using `node:test` verify that:

1. `mortise.dimensions` exposes both toolpath and finished fields.
2. `tenon.dimensions` exposes both toolpath and finished fields.
3. `mortise.finishedWidth` ≈ `tenon.finishedThickness + GLUE_CLEARANCE` within 1/64" rounding.
4. The toolpath values are pinned to their pre-fix numerics, so an accidental change to the CNC contract trips a test.
5. For the canonical 24×24×72 coffee table, `finishedWidth ≈ finishedThickness ≈ 0.5781"` (37/64").
6. `snapToLumber` and `roundTo64th` still behave as expected.

Run with `cd backend && npm test`.

### `cutlist-generator/src/cutlist/load.py`

`MortiseDimensions` and `TenonDimensions` now declare optional
`finishedWidth`, `finishedLength`, `finishedThickness` fields and
expose `display_width`, `display_length`, `display_thickness`
properties that prefer the finished value and fall back to the
toolpath value. A `has_finished_fields` property tells the renderer
whether the JSON is post-fix.

### `cutlist-generator/src/cutlist/render.py`

`_collect_joint_pairs` reads `display_*`. A new
`_has_legacy_dimensions(cutlist)` helper threads a `legacy_json`
boolean into the template so the render flags pre-fix JSON.

### `cutlist-generator/templates/cutlist.html.jinja`

- The per-part details render `joint.dimensions.display_width` /
  `display_length` / `display_thickness` instead of the toolpath
  fields.
- A "Legacy JSON detected" warning paragraph is conditionally
  rendered on the first page when the loaded JSON is missing
  `finished*` fields.
- The pre-existing "Fit warning" paragraph in the joinery summary is
  unchanged — it now simply doesn't fire for post-fix JSON because
  the apparent clearance is non-negative.

### `cutlist-generator/tests/test_cutlist.py`

Three new tests:

- `test_post_fix_pairs_have_no_fit_warning`
- `test_render_omits_fit_warning_class_for_post_fix_json`
- `test_legacy_json_without_finished_fields_triggers_banner_and_warn_row`
  (round-trips a stripped-down JSON to confirm the fallback code path)

### `cutlist-generator/examples/coffee_table_cutlist.json`

Regenerated by re-running the engine on the canonical coffee-table
input. Now includes `finishedWidth` / `finishedLength` /
`finishedThickness` on every joint.

### What did **not** change

- `frontend/` is untouched. The existing UI continues to read
  `joint.dimensions.width` / `.thickness` (the kerf-compensated
  toolpath values), and therefore continues to display the same
  17/32" mortise W / 19/32" tenon T values it always did. The UI is
  not broken, but it is not yet showing the corrected,
  hand-tool-friendly numbers — that requires reading the new
  `finishedWidth` / `finishedThickness` fields, which is a separate
  follow-up task.
- The gcode generator is untouched. It uses `mortise.dimensions.width`
  / `.length` (the toolpath values), as before.
- `python-renderer` is untouched. It uses `joint.dimensions.width`
  etc. as before; rendered geometry is byte-identical.

## 9. Reproducing this finding

```bash
# 1. Regenerate the example cut list
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
  'cutlist-generator/examples/coffee_table_cutlist.json',
  JSON.stringify(processPartsArray(parts), null, 2)
);"

# 2. Find the leg's first mortise and the long apron's tenon:
python3 -c "
import json
parts = json.load(open('cutlist-generator/examples/coffee_table_cutlist.json'))
leg = next(p for p in parts if p['partName'] == 'Leg')
apron = next(p for p in parts if p['partName'] == 'Long Apron')
m = leg['joints'][0]['dimensions']
t = apron['joints'][0]['dimensions']
print('mortise.width    :', m['width'])
print('tenon.thickness  :', t['thickness'])
print('apparent gap     :', m['width'] - t['thickness'])
print('engine clearance :', leg['joints'][0]['fitClearance'])
"
```

Expected output:

```
mortise.width    : 0.515625
tenon.thickness  : 0.578125
apparent gap     : -0.0625      ← tenon 1/16" too fat for mortise
engine clearance : 0.003        ← intended fit, but lost in the comp step
```
