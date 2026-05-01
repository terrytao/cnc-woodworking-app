'use strict'

// ─── Constants ───────────────────────────────────────────────────────────────
const BIT_DIAMETER       = 0.25
const KERF               = 0.125
const KERF_COMPENSATION  = 0.0625
const DOG_BONE_RADIUS    = 0.0625
const GLUE_CLEARANCE     = 0.003
const SHOULDER_SIZE      = 0.25
const MORTISE_DEPTH      = 1.0

// ─── Lumber lookup ───────────────────────────────────────────────────────────
const LUMBER_TABLE = [
  { nominal: '1x2',  t: 0.75, w: 1.5   },
  { nominal: '1x3',  t: 0.75, w: 2.5   },
  { nominal: '1x4',  t: 0.75, w: 3.5   },
  { nominal: '1x6',  t: 0.75, w: 5.5   },
  { nominal: '1x8',  t: 0.75, w: 7.25  },
  { nominal: '2x2',  t: 1.5,  w: 1.5   },
  { nominal: '2x4',  t: 1.5,  w: 3.5   },
  { nominal: '2x6',  t: 1.5,  w: 5.5   },
  { nominal: '2x8',  t: 1.5,  w: 7.25  },
  { nominal: '2x10', t: 1.5,  w: 9.25  },
  { nominal: '2x12', t: 1.5,  w: 11.25 },
  { nominal: '4x4',  t: 3.5,  w: 3.5   },
  { nominal: '4x6',  t: 3.5,  w: 5.5   },
]

function snapToLumber(thickness, width) {
  let best = null
  let bestDist = Infinity
  // Normalize so the smaller dim is treated as thickness — lets a 3.5×3.5
  // input match a 4x4 entry regardless of which arg holds which value.
  const a = Math.min(thickness, width)
  const b = Math.max(thickness, width)
  for (const entry of LUMBER_TABLE) {
    const et = Math.min(entry.t, entry.w)
    const ew = Math.max(entry.t, entry.w)
    const dist = Math.abs(et - a) + Math.abs(ew - b)
    if (dist < bestDist) {
      bestDist = dist
      // Preserve the caller's orientation: thickness arg → thickness slot
      const wantThick = thickness <= width ? et : ew
      const wantWide  = thickness <= width ? ew : et
      best = { nominal: entry.nominal, actual: { thickness: wantThick, width: wantWide } }
    }
  }
  return best
}

// ─── Rounding ─────────────────────────────────────────────────────────────────
function roundTo64th(value) {
  return Math.round(value * 64) / 64
}

function fmt(value) {
  return roundTo64th(value).toFixed(4)
}

// ─── Part classification ──────────────────────────────────────────────────────
// Flat parts get no mortise/tenon joinery — they're tabletops, panels, shelves,
// breadboards, cleats. Checked AFTER rail/leg so "Top Rail" still classifies as
// a rail (rail keyword wins).
const FLAT_REGEX = /\b(top|tabletop|breadboard|cleat|shelf|panel)\b/

function classifyPart(part) {
  // Accept both 'name' (Claude output) and 'partName' (engine output) so
  // re-processing already-enriched parts doesn't break classification.
  const name = (part.name || part.partName || '').toLowerCase()

  const isLeg  = /\b(leg|post|stile|column)\b/.test(name)
  const isRail = /\b(rail|stretcher|apron|crosspiece|beam|brace)\b/.test(name)
  const isFlat = FLAT_REGEX.test(name)

  console.log(`[classifyPart] "${part.name || part.partName}" → isLeg=${isLeg} isRail=${isRail} isFlat=${isFlat}`)

  if (isLeg)  return 'leg'
  if (isRail) return 'rail'
  if (isFlat) return 'flat'

  // Heuristic: square stock → leg
  const t = part.thickness || 1
  const w = part.width     || 1
  const ratio = Math.max(t, w) / Math.min(t, w)
  if (ratio < 1.2) return 'leg'

  // Wide and thin (panel-like) → flat (no joinery)
  if (w > 12 && t < 2) return 'flat'

  // Long, thin stock → rail
  const l = part.length || 1
  if (l / Math.max(t, w) > 4) return 'rail'

  console.log(`[classifyPart] "${part.name || part.partName}" fell through to 'unknown' (t=${t} w=${w} l=${l})`)
  return 'unknown'
}

// ─── Dog bone positions ───────────────────────────────────────────────────────
function dogBonesForMortise(originX, originY, mWidth, mLength) {
  // Four corners of the mortise pocket
  return [
    { x: roundTo64th(originX),          y: roundTo64th(originY),          radius: DOG_BONE_RADIUS },
    { x: roundTo64th(originX + mWidth), y: roundTo64th(originY),          radius: DOG_BONE_RADIUS },
    { x: roundTo64th(originX),          y: roundTo64th(originY + mLength), radius: DOG_BONE_RADIUS },
    { x: roundTo64th(originX + mWidth), y: roundTo64th(originY + mLength), radius: DOG_BONE_RADIUS },
  ]
}

// ─── Validation ───────────────────────────────────────────────────────────────
// clearance must be computed from raw (pre-rounding, pre-kerf) dimensions.
// GLUE_CLEARANCE (0.003") is smaller than 1/64" (0.0156"), so rounding either
// value to 64ths first collapses the difference to zero.
function validateJoint(clearance, rawTenonThickness, rawTenonWidth, rawTenonLength, mortiseDepth, stockThickness, stockWidth) {
  const warnings = []

  if (clearance < 0.001 || clearance > 0.008) {
    warnings.push(`Fit clearance ${clearance.toFixed(4)}" is outside 0.001–0.008" range`)
  }
  if (rawTenonThickness > stockThickness) {
    warnings.push(`Tenon thickness ${rawTenonThickness.toFixed(4)}" exceeds stock thickness ${stockThickness}"`)
  }
  if (rawTenonWidth > stockWidth) {
    warnings.push(`Tenon width ${rawTenonWidth.toFixed(4)}" exceeds stock width ${stockWidth}"`)
  }
  if (rawTenonLength > mortiseDepth) {
    warnings.push(`Tenon length ${rawTenonLength.toFixed(4)}" exceeds mortise depth ${mortiseDepth}"`)
  }
  return { clearance, warnings }
}

// ─── Grain direction check ────────────────────────────────────────────────────
function grainWarning(type, jointDimensions, partLength) {
  const warnings = []
  if (type === 'tenon') {
    if (jointDimensions.width > partLength * 0.9) {
      warnings.push('Tenon width may not run parallel to grain — verify orientation')
    }
  }
  if (type === 'mortise') {
    // Mortise long axis should run with grain (length > width)
    if (!(jointDimensions.length > jointDimensions.width * 2)) {
      warnings.push('Mortise long axis should run with grain — verify orientation')
    }
  }
  return warnings
}

// ─── G-code generation ───────────────────────────────────────────────────────
function generateGcode(partName, mortise, stockThickness) {
  const { x: ox, y: oy } = mortise.position
  const { width, length, depth } = mortise.dimensions
  const passes    = Math.ceil(depth / 0.25)
  const safeZ     = 0.1
  const lines     = []

  lines.push(`; =========================================`)
  lines.push(`; Mortise: ${partName}`)
  lines.push(`; Width=${fmt(width)}" Length=${fmt(length)}" Depth=${fmt(depth)}"`)
  lines.push(`; =========================================`)
  lines.push(`G20 G17 G90`)
  lines.push(`S18000 M3`)
  lines.push(`G0 Z${safeZ.toFixed(4)}`)

  for (let pass = 1; pass <= passes; pass++) {
    const cutZ = -(pass * 0.25)
    lines.push(`; --- Pass ${pass} ---`)
    lines.push(`G0 X${fmt(ox)} Y${fmt(oy)}`)
    lines.push(`G1 Z${cutZ.toFixed(4)} F50`)
    // Pocket raster: step over by BIT_DIAMETER * 0.4
    const step  = BIT_DIAMETER * 0.4
    let   yPos  = oy
    let   dir   = 1
    while (yPos <= oy + length) {
      const xEnd = dir === 1 ? ox + width : ox
      const xStart = dir === 1 ? ox : ox + width
      lines.push(`G1 X${fmt(xStart)} Y${fmt(yPos)} F100`)
      lines.push(`G1 X${fmt(xEnd)} F100`)
      yPos = roundTo64th(yPos + step)
      dir  = -dir
    }
    lines.push(`G0 Z${safeZ.toFixed(4)}`)
  }

  // Dog bone moves
  lines.push(`; --- Dog bone corners ---`)
  for (const db of mortise.dogBones) {
    lines.push(`G0 X${fmt(db.x)} Y${fmt(db.y)}`)
    lines.push(`G1 Z${(-(depth)).toFixed(4)} F50`)
    lines.push(`G2 X${fmt(db.x)} Y${fmt(db.y)} I${fmt(db.radius)} J0 F100`)
    lines.push(`G0 Z${safeZ.toFixed(4)}`)
  }

  lines.push(`M5`)
  lines.push(`G0 Z1.0`)
  lines.push(`; End ${partName}`)
  lines.push(``)

  return lines.join('\n')
}

// ─── Core joint calculator ────────────────────────────────────────────────────
function calculateJoints(legPart, railPart, legStock, railStock) {
  const legThickness  = legStock.actual.thickness
  const railThickness = railStock.actual.thickness
  const railWidth     = railStock.actual.width
  const mortiseDepth  = MORTISE_DEPTH
  const notes         = []  // informational — expected, normal behavior

  // Tenon thickness must never exceed the rail's stock thickness minus 0.125"
  // (cheek material on each side). For thin aprons this clamp dominates the
  // leg/3 proportional rule; the mortise must then be re-derived to match the
  // clamped tenon so the joint actually fits.
  const idealMortiseWidth = legThickness / 3
  const idealTenonThick   = idealMortiseWidth - GLUE_CLEARANCE
  const maxTenonThick     = railThickness - 0.125

  let rawTenonThickness = idealTenonThick
  if (rawTenonThickness > maxTenonThick) {
    rawTenonThickness = maxTenonThick
    notes.push(`Note: tenon sized to rail stock (${maxTenonThick.toFixed(4)}")`)
  }
  const rawMortiseWidth = rawTenonThickness + GLUE_CLEARANCE

  const rawMortiseLength = railWidth - SHOULDER_SIZE * 2
  const rawTenonLength   = mortiseDepth
  // Clamp tenon width to rail stock width less a 0.5" total shoulder allowance.
  const rawTenonWidth    = Math.min(rawMortiseLength, railWidth - 0.5)
  const clearance        = rawMortiseWidth - rawTenonThickness  // = GLUE_CLEARANCE

  // CNC dimensions — rounded to nearest 1/64"
  const mortiseWidth   = roundTo64th(rawMortiseWidth)
  const mortiseLength  = roundTo64th(rawMortiseLength)
  const tenonThickness = roundTo64th(rawTenonThickness)
  const tenonWidth     = roundTo64th(rawTenonWidth)

  // Kerf compensation only on X-Y router-plane dimensions (length, width).
  // Thickness gets none — it's set by the stock, not a router cut.
  const mortiseWidthComp  = roundTo64th(mortiseWidth  - KERF_COMPENSATION)
  const mortiseLengthComp = roundTo64th(mortiseLength - KERF_COMPENSATION)
  const tenonThickComp    = tenonThickness  // no kerf on thickness
  const tenonWidthComp    = roundTo64th(tenonWidth   + KERF_COMPENSATION)

  const { warnings: fitWarnings } = validateJoint(
    clearance, rawTenonThickness, rawTenonWidth, rawTenonLength,
    mortiseDepth, legStock.actual.thickness, legStock.actual.width
  )

  // Positions (centered on leg face)
  const mortiseX = roundTo64th((legThickness - mortiseWidth) / 2)
  const mortiseY = roundTo64th(SHOULDER_SIZE)

  const mortiseDims = { width: mortiseWidthComp, length: mortiseLengthComp, depth: mortiseDepth }
  const tenonDims   = { thickness: tenonThickComp, length: rawTenonLength, width: tenonWidthComp }

  const dogBones = dogBonesForMortise(mortiseX, mortiseY, mortiseWidthComp, mortiseLengthComp)

  const mortiseGrainWarns = grainWarning('mortise', mortiseDims, legPart.length || 30)
  const tenonGrainWarns   = grainWarning('tenon',   tenonDims,   railPart.length || 20)

  const label = `${railPart.name || railPart.partName || 'rail'}`

  const mortiseJoint = {
    type: 'mortise',
    label,
    position: { x: mortiseX, y: mortiseY, face: 'front' },
    dimensions: mortiseDims,
    dogBones,
    grainDirection: 'parallel',
    fitClearance: clearance,
    warnings: [...fitWarnings, ...mortiseGrainWarns],
  }

  const tenonJoint = {
    type: 'tenon',
    position: { x: 0, y: 0, face: 'end' },
    dimensions: tenonDims,
    grainDirection: 'parallel',
    fitClearance: clearance,
    warnings: [...fitWarnings, ...tenonGrainWarns],
  }

  return { mortiseJoint, tenonJoint, notes }
}

// Pull qty out of the notes string when it isn't an explicit field — Claude's
// SYSTEM_PROMPT puts quantity hints like "x4" or "qty 2" in `notes`, not in a
// dedicated `qty` field, so a notes-based fallback is necessary in production.
function extractQty(part) {
  if (part.qty != null && part.qty !== '') return Number(part.qty) || 1
  const notes = (part.notes || '').toString()
  // Match: "x4", "x 4", "(x4)", "4x", "qty 2", "qty: 2", "quantity: 4"
  const m = notes.match(/(?:\bx\s*|\bqty\s*[:=]?\s*|\bquantity\s*[:=]?\s*)(\d+)|\b(\d+)\s*x\b/i)
  if (m) return parseInt(m[1] || m[2], 10) || 1
  return 1
}

// ─── Process a single part ────────────────────────────────────────────────────
function processPart(part) {
  const thickness = part.thickness || 1.5
  const width     = part.width     || 3.5
  const length    = part.length    || 24

  const stock = snapToLumber(thickness, width)
  const role  = classifyPart(part)

  // Kerf compensation only applies in the X-Y router plane (length and width).
  // Thickness is the stock dimension — not a router cut — so leave it alone.
  const cutLength    = roundTo64th(length              + KERF_COMPENSATION)
  const cutWidth     = roundTo64th(stock.actual.width  + KERF_COMPENSATION)
  const cutThickness = roundTo64th(stock.actual.thickness)

  return {
    _raw: part,
    partName: part.name || 'Part',
    qty: extractQty(part),
    role,
    stock,
    cutDimensions: { length: cutLength, width: cutWidth, thickness: cutThickness },
    joints: [],
    gcode: '',
  }
}

// Aggregate warnings and notes across all joints on a single part into a
// single deduplicated list at the part level. After this runs, per-joint
// `warnings` arrays are emptied so the frontend has one source of truth and
// can't double-render. `notes` is informational (e.g. tenon-clamp); `warnings`
// is anomalies.
function aggregatePartMessages(part) {
  const warnings = []
  const notes    = []
  for (const joint of part.joints) {
    for (const w of (joint.warnings || [])) {
      if (!warnings.includes(w)) warnings.push(w)
    }
    joint.warnings = []
  }
  // pull notes off any extra carrier (set by processPartsArray)
  for (const n of (part._pendingNotes || [])) {
    if (!notes.includes(n)) notes.push(n)
  }
  delete part._pendingNotes
  part.warnings = warnings
  part.notes    = notes
}

// ─── Main entry point ─────────────────────────────────────────────────────────
function processPartsArray(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return []

  const processed = parts.map(processPart)

  console.log('[processPartsArray] part roles:', processed.map(p => `${p.partName}=${p.role}`).join(', '))

  const legs  = processed.filter(p => p.role === 'leg')
  const rails = processed.filter(p => p.role === 'rail')

  console.log(`[processPartsArray] ${legs.length} leg(s), ${rails.length} rail(s)`)

  // Pair EVERY rail with EVERY leg so each combination gets correct joint dims.
  // A table leg, for example, gets one mortise per rail (long apron ≠ short apron).
  if (legs.length > 0 && rails.length > 0) {
    for (const rail of rails) {
      const legRef = legs[0]
      const { mortiseJoint, tenonJoint, notes } = calculateJoints(
        legRef._raw, rail._raw,
        legRef.stock, rail.stock
      )

      for (const leg of legs) {
        leg.joints.push({ ...mortiseJoint, warnings: [...mortiseJoint.warnings] })
        ;(leg._pendingNotes ||= []).push(...notes)
      }
      rail.joints.push({ ...tenonJoint, warnings: [...tenonJoint.warnings] })
      ;(rail._pendingNotes ||= []).push(...notes)
    }

    // Rebuild G-code for each leg covering all its mortises
    for (const leg of legs) {
      leg.gcode = leg.joints
        .filter(j => j.type === 'mortise')
        .map(j => generateGcode(leg.partName, j, leg.stock.actual.thickness))
        .join('\n')
    }

    // Assign tenon to ambiguous parts using the first rail's joint as a template.
    // 'flat' parts (tabletops, panels, shelves) are explicitly excluded.
    const fallbackTenon = rails[0].joints[0]
    for (const p of processed) {
      if (p.role === 'unknown') {
        p.joints.push({
          type: 'tenon',
          position: { x: 0, y: 0, face: 'end' },
          dimensions: fallbackTenon.dimensions,
          grainDirection: 'parallel',
          fitClearance: fallbackTenon.fitClearance,
          warnings: ['Part type ambiguous — tenon assigned by default'],
        })
      }
    }
  }

  // Aggregate per-joint warnings into one deduplicated part-level list,
  // and emit the part-level `notes` (informational) the same way.
  for (const p of processed) aggregatePartMessages(p)

  return processed.map(p => ({
    partName:      p.partName,
    qty:           p.qty,
    stock:         p.stock,
    cutDimensions: p.cutDimensions,
    joints:        p.joints,
    warnings:      p.warnings,
    notes:         p.notes,
    gcode:         p.gcode,
  }))
}

// ─── Aggregate G-code for all parts ──────────────────────────────────────────
function buildFullGcode(enrichedParts) {
  const header = [
    `; CNC Woodworking - Full Cut Plan`,
    `; Generated ${new Date().toISOString()}`,
    `; Units: inches`,
    ``,
  ].join('\n')

  const body = enrichedParts
    .filter(p => p.gcode)
    .map(p => p.gcode)
    .join('\n')

  const footer = `; === End of program ===\nM30\n`
  return header + body + footer
}

module.exports = { processPartsArray, buildFullGcode, snapToLumber, roundTo64th }

// ─── Self-test (run: node joineryEngine.js) ───────────────────────────────────
if (require.main === module) {
  const testParts = [
    { name: 'Leg',         qty: 4, length: 28.5, width: 3.5, thickness: 3.5 },
    { name: 'Long Apron',  qty: 2, length: 60,   width: 4,   thickness: 0.75 },
    { name: 'Short Apron', qty: 2, length: 24,   width: 4,   thickness: 0.75 },
    { name: 'Top Panel',   qty: 1, length: 72,   width: 36,  thickness: 1.5 },
    // Production-shaped input: qty embedded in notes (no qty field)
    { name: 'Stretcher', notes: 'x3', length: 30, width: 2, thickness: 0.75 },
  ]

  console.log('\n=== snapToLumber spot checks ===')
  console.log('  3.5×3.5  →', snapToLumber(3.5, 3.5).nominal,  '(expect 4x4)')
  console.log('  1.75×1.75 →', snapToLumber(1.75, 1.75).nominal, '(expect 2x2)')
  console.log('  1.5×1.5  →', snapToLumber(1.5, 1.5).nominal,  '(expect 2x2)')

  console.log('\n=== classifyPart results ===')
  testParts.forEach(p => {
    const role = classifyPart(p)
    console.log(`  "${p.name}" → ${role}`)
  })

  console.log('\n=== processPartsArray ===')
  const result = processPartsArray(testParts)

  result.forEach(p => {
    console.log(`\n--- ${p.partName} (qty ${p.qty}) ---`)
    console.log(`  stock:         ${p.stock.nominal}  actual ${p.stock.actual.thickness}" × ${p.stock.actual.width}"`)
    console.log(`  cutDimensions: L=${p.cutDimensions.length.toFixed(4)}"  W=${p.cutDimensions.width.toFixed(4)}"  T=${p.cutDimensions.thickness.toFixed(4)}"`)
    if (p.joints.length === 0) {
      console.log('  (no joinery)')
    } else {
      p.joints.forEach((j, i) => {
        const d = j.dimensions
        if (j.type === 'mortise') {
          console.log(`  joint[${i}] mortise (for ${j.label || '?'}): W=${d.width.toFixed(4)}"  L=${d.length.toFixed(4)}"  D=${d.depth.toFixed(4)}"  clearance=${j.fitClearance.toFixed(4)}"`)
        } else {
          console.log(`  joint[${i}] tenon:   T=${d.thickness.toFixed(4)}"  L=${d.length.toFixed(4)}"  W=${d.width.toFixed(4)}"  clearance=${j.fitClearance.toFixed(4)}"`)
        }
        if ((j.warnings || []).length) console.log(`    [stale joint warnings — should be empty]: ${j.warnings.join(' | ')}`)
      })
    }
    if (p.notes && p.notes.length) {
      p.notes.forEach(n => console.log(`  ${n}`))
    }
    if (p.warnings && p.warnings.length) {
      p.warnings.forEach(w => console.log(`  ⚠ ${w}`))
    }
  })
}
