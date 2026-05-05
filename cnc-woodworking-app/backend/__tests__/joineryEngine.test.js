'use strict'

// Run with: `node --test backend/__tests__/joineryEngine.test.js`
// Uses the built-in node:test runner (Node 20+).

const test = require('node:test')
const assert = require('node:assert/strict')
const { processPartsArray, snapToLumber, roundTo64th } = require('../joineryEngine')

const GLUE_CLEARANCE = 0.003
const KERF_COMPENSATION = 0.0625  // 1/16"
const ONE_64TH = 1 / 64

const COFFEE_TABLE_PARTS = [
  { name: 'Leg',         qty: 4, length: 22.5, width: 1.75, thickness: 1.75 },
  { name: 'Long Apron',  qty: 2, length: 70.5, width: 3.5,  thickness: 0.75 },
  { name: 'Short Apron', qty: 2, length: 22.5, width: 3.5,  thickness: 0.75 },
  { name: 'Top',         qty: 1, length: 72,   width: 24,   thickness: 1.5 },
]

function processed() {
  return processPartsArray(COFFEE_TABLE_PARTS)
}

function findMortise(parts, mortiseLabel) {
  const leg = parts.find(p => p.partName === 'Leg')
  return leg.joints.find(j => j.type === 'mortise' && j.label === mortiseLabel)
}

function findTenon(parts, partName) {
  const part = parts.find(p => p.partName === partName)
  return part.joints.find(j => j.type === 'tenon')
}

test('mortise.dimensions exposes both toolpath and finished fields', () => {
  const parts = processed()
  const mortise = findMortise(parts, 'Long Apron')
  const d = mortise.dimensions

  // Toolpath fields (CNC consumers — must be unchanged)
  assert.equal(typeof d.width, 'number')
  assert.equal(typeof d.length, 'number')
  assert.equal(typeof d.depth, 'number')

  // New finished fields (hand-tool consumers)
  assert.equal(typeof d.finishedWidth, 'number')
  assert.equal(typeof d.finishedLength, 'number')

  // Finished width = toolpath width + kerf compensation
  assert.ok(
    Math.abs(d.finishedWidth - (d.width + KERF_COMPENSATION)) < ONE_64TH,
    `finishedWidth ${d.finishedWidth} should equal width ${d.width} + ${KERF_COMPENSATION}`
  )
  assert.ok(
    Math.abs(d.finishedLength - (d.length + KERF_COMPENSATION)) < ONE_64TH,
    `finishedLength ${d.finishedLength} should equal length ${d.length} + ${KERF_COMPENSATION}`
  )
})

test('tenon.dimensions exposes both toolpath and finished fields', () => {
  const parts = processed()
  const tenon = findTenon(parts, 'Long Apron')
  const d = tenon.dimensions

  // Toolpath fields (CNC consumers — must be unchanged)
  assert.equal(typeof d.thickness, 'number')
  assert.equal(typeof d.length, 'number')
  assert.equal(typeof d.width, 'number')

  // New finished fields
  assert.equal(typeof d.finishedThickness, 'number')
  assert.equal(typeof d.finishedWidth, 'number')

  // Tenon thickness has no kerf comp, so finishedThickness === thickness
  assert.equal(d.finishedThickness, d.thickness)

  // Tenon width has kerf compensation ADDED in the toolpath value:
  //   width = finishedWidth + KERF_COMPENSATION  (within 1/64 rounding)
  assert.ok(
    Math.abs(d.width - (d.finishedWidth + KERF_COMPENSATION)) < ONE_64TH,
    `tenon.width ${d.width} should equal finishedWidth ${d.finishedWidth} + ${KERF_COMPENSATION}`
  )
})

test('mortise.finishedWidth equals tenon.finishedThickness + GLUE_CLEARANCE (within rounding)', () => {
  const parts = processed()
  for (const railName of ['Long Apron', 'Short Apron']) {
    const mortise = findMortise(parts, railName)
    const tenon   = findTenon(parts, railName)
    const diff = mortise.dimensions.finishedWidth - tenon.dimensions.finishedThickness
    // diff should be GLUE_CLEARANCE; rounding to 1/64 may collapse it to 0.
    // Allow tolerance of one 1/64 tick.
    assert.ok(
      Math.abs(diff - GLUE_CLEARANCE) < ONE_64TH,
      `${railName}: finishedWidth - finishedThickness = ${diff}, expected ≈ ${GLUE_CLEARANCE} (±1/64)`
    )
  }
})

test('toolpath fields are unchanged from the pre-fix output (CNC consumers continue to work)', () => {
  // These exact numeric values are what the engine emitted before fix #2 was
  // applied. They are the kerf-compensated CNC toolpath dimensions; the gcode
  // generator and any existing CNC consumer reads these. If this test fails,
  // we have inadvertently broken the CNC contract.
  const parts = processed()
  const mortise = findMortise(parts, 'Long Apron')
  const tenon   = findTenon(parts, 'Long Apron')

  assert.equal(mortise.dimensions.width,  0.515625, 'toolpath mortise width')
  assert.equal(mortise.dimensions.length, 0.8125,   'toolpath mortise length')
  assert.equal(mortise.dimensions.depth,  1,        'mortise depth')

  assert.equal(tenon.dimensions.thickness, 0.578125, 'tenon thickness')
  assert.equal(tenon.dimensions.length,    1,        'tenon length')
  assert.equal(tenon.dimensions.width,     0.9375,   'toolpath tenon width')
})

test('finished values for the canonical 24x24x72 coffee table land near 0.5781"', () => {
  const parts = processed()
  const mortise = findMortise(parts, 'Long Apron')
  const tenon   = findTenon(parts, 'Long Apron')

  // Pre-comp values: rawMortiseWidth = legThickness/3 = 0.5833 → roundTo64th = 0.5781 (37/64)
  //                  rawTenonThickness = idealMortiseWidth - 0.003 = 0.5803 → roundTo64th = 0.5781
  assert.equal(mortise.dimensions.finishedWidth,  0.578125, 'mortise finishedWidth = 37/64')
  assert.equal(tenon.dimensions.finishedThickness, 0.578125, 'tenon finishedThickness = 37/64')
})

test('snapToLumber and roundTo64th still behave as expected', () => {
  // Sanity check that the helpers we depend on are reachable and unchanged.
  assert.equal(snapToLumber(3.5, 3.5).nominal, '4x4')
  assert.equal(roundTo64th(0.5833333), 0.578125)
})
