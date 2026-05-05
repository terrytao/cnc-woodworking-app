import { useEffect, useMemo, useRef, useState } from 'react'

const THREE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'

const CANVAS_HEIGHT = 420
const BIT_DIAMETER = 0.25
const BIT_RADIUS = BIT_DIAMETER / 2
const BASE_MOVES_PER_SEC = 4
const SPEED_OPTIONS = [1, 5, 10, 50]

const COLOR = {
  stock:    0xC8A882,
  bit:      0xAAAAAA,
  void:     0x8B5E3C,
  pass1:    0xB5D4F4,
  pass2:    0x378ADD,
  pass3:    0x185FA5,
  pass4:    0x0C447C,
  dogbone:  0xE24B4A,
  rapid:    0x999999,
  tenon:    0xD4A574,
  grid:     0xc8c8c8,
}

// Shared CDN loader — dedupes against three.min.js already injected by sibling
// components (JointViewer3D, TableViewer3D) so the script loads exactly once.
let threePromise = null
function loadThree() {
  if (typeof window === 'undefined') return Promise.reject(new Error('SSR'))
  if (window.THREE) return Promise.resolve(window.THREE)
  if (threePromise) return threePromise
  threePromise = new Promise((resolve, reject) => {
    const onErr = () => { threePromise = null; reject(new Error('Failed to load Three.js')) }
    const existing = document.querySelector('script[src*="three.min.js"]')
    if (existing) {
      if (window.THREE) { resolve(window.THREE); return }
      existing.addEventListener('load', () => resolve(window.THREE))
      existing.addEventListener('error', onErr)
      return
    }
    const s = document.createElement('script')
    s.src = THREE_CDN
    s.async = true
    s.onload = () => resolve(window.THREE)
    s.onerror = onErr
    document.head.appendChild(s)
  })
  return threePromise
}

function colorForMove(mv) {
  if (mv.type === 'rapid')   return COLOR.rapid
  if (mv.type === 'dogbone') return COLOR.dogbone
  if (mv.pass === 1) return COLOR.pass1
  if (mv.pass === 2) return COLOR.pass2
  if (mv.pass === 3) return COLOR.pass3
  return COLOR.pass4
}

// Walk the engine's G-code and emit a flat array of motion moves with the
// active operation context (pass index / dog-bone phase / mortise label) so
// the simulator can color and label each segment without re-parsing on tick.
function parseGcode(gcode) {
  const moves = []
  let curX = 0, curY = 0, curZ = 0.1
  let pass = 0
  let inDogBone = false
  let mortiseLabel = ''

  // Seed initial pose so segment[0] has a "from" vertex.
  moves.push({ x: 0, y: 0, z: 0.1, type: 'rapid', pass: 0, opLabel: 'Setup', mortise: '' })

  const lines = (gcode || '').split('\n')
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    if (line.startsWith(';')) {
      const passMatch = line.match(/---\s*Pass\s+(\d+)/i)
      if (passMatch) { pass = parseInt(passMatch[1], 10); inDogBone = false; continue }
      if (/Dog\s*bone/i.test(line)) { inDogBone = true; continue }
      const mortMatch = line.match(/^;\s*Mortise:\s*(.+)/)
      if (mortMatch) { mortiseLabel = mortMatch[1].trim(); pass = 0; inDogBone = false }
      continue
    }

    const codeMatch = line.match(/^G0*([0-9]+)\b/)
    if (!codeMatch) continue
    const codeNum = parseInt(codeMatch[1], 10)
    if (codeNum > 3) continue

    const xMatch = line.match(/X(-?\d+\.?\d*)/)
    const yMatch = line.match(/Y(-?\d+\.?\d*)/)
    const zMatch = line.match(/Z(-?\d+\.?\d*)/)
    if (!xMatch && !yMatch && !zMatch) continue

    const newX = xMatch ? parseFloat(xMatch[1]) : curX
    const newY = yMatch ? parseFloat(yMatch[1]) : curY
    const newZ = zMatch ? parseFloat(zMatch[1]) : curZ

    let type = 'rapid'
    if (codeNum === 0) type = 'rapid'
    else if (inDogBone) type = 'dogbone'
    else type = 'cut'

    let opLabel
    if (inDogBone)     opLabel = mortiseLabel ? `${mortiseLabel}: Dog bone corners` : 'Dog bone corners'
    else if (pass > 0) opLabel = mortiseLabel ? `${mortiseLabel}: Pass ${pass}` : `Pass ${pass}`
    else               opLabel = mortiseLabel ? `Mortise: ${mortiseLabel}` : 'Setup'

    moves.push({ x: newX, y: newY, z: newZ, type, pass, opLabel, mortise: mortiseLabel })
    curX = newX; curY = newY; curZ = newZ
  }

  // Mortise gcode places cuts in the middle of the leg face; centering its
  // bbox on the world origin keeps the bit visible inside the stock. Tenon
  // gcode places cuts at one END of the rail — preserve those coordinates so
  // the toolpath lands at the rail's end face when mapped to 3D.
  if (!isTenonGcode(gcode)) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const m of moves) {
      if (m.type === 'rapid') continue
      if (m.x < minX) minX = m.x
      if (m.x > maxX) maxX = m.x
      if (m.y < minY) minY = m.y
      if (m.y > maxY) maxY = m.y
    }
    if (Number.isFinite(minX)) {
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      for (const m of moves) { m.x -= cx; m.y -= cy }
    }
  }

  return moves
}

function isTenonGcode(gcode) {
  return /^\s*;\s*Tenon:/im.test(gcode || '')
}

function maxPass(moves) {
  let m = 0
  for (const mv of moves) if (mv.pass > m) m = mv.pass
  return m
}

const styles = {
  panel:        { border: '1px solid #d0d0d0', borderRadius: 10, background: '#fff', overflow: 'hidden', marginTop: 12 },
  banner:       { background: '#fffbe6', borderBottom: '1px solid #ffe082', color: '#7a5c00', padding: '8px 14px', fontSize: 13, fontWeight: 600, textAlign: 'center' },
  header:       { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', background: '#f7f7f7', borderBottom: '1px solid #e0e0e0' },
  title:        { fontSize: 14, fontWeight: 700, color: '#2d4a22' },
  closeBtn:     { background: 'transparent', border: 'none', cursor: 'pointer', color: '#666', fontSize: 20, lineHeight: 1, padding: '0 4px' },
  wrap:         { position: 'relative', width: '100%', height: CANVAS_HEIGHT, background: '#fafafa' },
  canvas:       { display: 'block', width: '100%', height: '100%', cursor: 'grab', touchAction: 'none' },
  controls:     { padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, background: '#fff', borderTop: '1px solid #e0e0e0' },
  rowTop:       { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  playBtn:      (a) => ({ padding: '8px 22px', minWidth: 96, fontSize: 14, fontWeight: 700, border: 'none', borderRadius: 6, cursor: 'pointer', background: a ? '#cc6633' : '#2d4a22', color: '#fff' }),
  speedLabel:   { fontSize: 12, color: '#666', fontWeight: 600 },
  speedBtn:     (a) => ({ padding: '5px 10px', fontSize: 12, fontWeight: 600, border: `1px solid ${a ? '#2d4a22' : '#cfcfcf'}`, background: a ? '#2d4a22' : '#fff', color: a ? '#fff' : '#444', borderRadius: 4, cursor: 'pointer' }),
  stepBtn:      { padding: '5px 10px', fontSize: 12, fontWeight: 600, border: '1px solid #cfcfcf', background: '#fff', color: '#444', borderRadius: 4, cursor: 'pointer' },
  resetBtn:     { padding: '5px 12px', fontSize: 12, fontWeight: 600, border: '1px solid #cfcfcf', background: '#fff', color: '#cc3333', borderRadius: 4, cursor: 'pointer', marginLeft: 'auto' },
  progressBar:  { width: '100%', height: 8, background: '#e8e8e8', borderRadius: 4, overflow: 'hidden' },
  progressFill: (p) => ({ width: `${p}%`, height: '100%', background: '#2d4a22', transition: 'width 80ms linear' }),
  opLabel:      { textAlign: 'center', fontSize: 14, fontWeight: 600, color: '#2d4a22', minHeight: 18 },
  posReadout:   { textAlign: 'center', fontFamily: '"SF Mono", Menlo, Consolas, monospace', fontSize: 12, color: '#444', minHeight: 16 },
  legend:       { display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', fontSize: 11, color: '#555', marginTop: 2 },
  legendItem:   { display: 'inline-flex', alignItems: 'center', gap: 4 },
  legendSwatch: (c) => ({ display: 'inline-block', width: 12, height: 4, background: c, borderRadius: 2 }),
  hint:         { position: 'absolute', bottom: 6, right: 8, fontSize: 10, color: '#888', pointerEvents: 'none' },
  err:          { padding: '20px 14px', color: '#c00', fontSize: 13, textAlign: 'center' },
}

const fmtPos = (n) => Number.isFinite(n) ? n.toFixed(4) : '----'

export default function ToolpathSimulator({ gcode, partName, stockDimensions }) {
  const wrapRef    = useRef(null)
  const canvasRef  = useRef(null)
  const sceneRef   = useRef({})
  const stateRef   = useRef({ idx: 0, frac: 0, playing: false, speed: 5 })

  const moves = useMemo(() => parseGcode(gcode), [gcode])
  const totalPasses = useMemo(() => maxPass(moves), [moves])
  const isTenon = useMemo(() => isTenonGcode(gcode), [gcode])
  // Tenon length = max gcode-X across cut moves (shoulder depth in the
  // generator). Used to place the bit at the rail end and frame the camera.
  const tenonLength = useMemo(() => {
    if (!isTenon) return 0
    let m = 0
    for (const mv of moves) {
      if (mv.type === 'rapid') continue
      if (mv.x > m) m = mv.x
    }
    return m
  }, [moves, isTenon])
  // Tenon dimensions parsed from the gcode header — used to render the
  // post-completion tenon highlight (the shape that should remain after cuts).
  const tenonDims = useMemo(() => {
    if (!isTenon) return null
    const m = (gcode || '').match(/Thickness=([\d.]+)"\s+Width=([\d.]+)"\s+Length=([\d.]+)"/)
    if (!m) return null
    return {
      thickness: parseFloat(m[1]),
      width:     parseFloat(m[2]),
      length:    parseFloat(m[3]),
    }
  }, [gcode, isTenon])

  const [error, setError]             = useState(null)
  const [playing, setPlaying]         = useState(false)
  const [speed, setSpeed]             = useState(5)
  const [progress, setProgress]       = useState(0)
  const [currentMove, setCurrentMove] = useState(moves[0] || null)

  // Reset transport state whenever the move list changes (new part / new G-code).
  useEffect(() => {
    stateRef.current.idx = 0
    stateRef.current.frac = 0
    stateRef.current.playing = false
    stateRef.current.speed = 5
    setPlaying(false)
    setSpeed(5)
    setProgress(0)
    setCurrentMove(moves[0] || null)
  }, [moves])

  // Stock size primitives — extract so the dependency array can compare values
  // rather than the parent's freshly-allocated stockDimensions object.
  const T = Number(stockDimensions?.thickness) || 3.5
  const W = Number(stockDimensions?.width)     || 3.5
  const L = Number(stockDimensions?.length)    || 28.5

  useEffect(() => {
    if (!moves.length) return
    let cancelled = false
    let animId = 0
    const handlers = []

    const init = async () => {
      let THREE
      try { THREE = await loadThree() }
      catch (e) { if (!cancelled) setError(e.message); return }
      if (cancelled || !canvasRef.current) return

      const canvas = canvasRef.current
      const wrap = wrapRef.current
      const w0 = wrap.clientWidth || 600
      const maxDim = Math.max(T, W, L)

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0xfafafa)

      const camera = new THREE.PerspectiveCamera(35, w0 / CANVAS_HEIGHT, 0.05, maxDim * 12)
      // Explicit Y-up — Three.js's default, but pin it so a stale camera.up
      // from a previous mount can't flip the tenon view upside down.
      camera.up.set(0, 1, 0)
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(w0, CANVAS_HEIGHT, false)

      scene.add(new THREE.AmbientLight(0xffffff, 0.7))
      const key = new THREE.DirectionalLight(0xffffff, 0.55)
      key.position.set(maxDim, maxDim * 1.5, maxDim)
      scene.add(key)
      const fill = new THREE.DirectionalLight(0xffffff, 0.25)
      fill.position.set(-maxDim, maxDim * 0.5, -maxDim * 0.5)
      scene.add(fill)

      // Coordinate mapping depends on the joint type:
      // - Mortise (leg): long axis vertical (gcode Y → three.Y), cuts on +Z face
      //   so cut depth → three.Z. Stock = BoxGeometry(T, L, W).
      // - Tenon (rail): stock is a flat horizontal board with center at world
      //   origin. The tenon is cut at the +X end (rail end face at +L/2).
      //   gcode-X 0 maps to the shoulder line at world +L/2 - tenonLength;
      //   gcode-X = tenonLength maps to the rail end at world +L/2. Cut depth
      //   (gcode-Z) goes into the top face → three.Y.
      const positionFor = isTenon
        ? (mv) => [mv.x + L / 2 - tenonLength, T / 2 + mv.z, mv.y - W / 2]
        : (mv) => [mv.x, mv.y, W / 2 + mv.z]
      const interp = (a, b, t) => {
        const [ax, ay, az] = positionFor(a)
        const [bx, by, bz] = positionFor(b)
        return [ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t]
      }

      const stockGeom = isTenon
        ? new THREE.BoxGeometry(L, T, W)
        : new THREE.BoxGeometry(T, L, W)
      const stockMat  = new THREE.MeshStandardMaterial({
        color: COLOR.stock, roughness: 0.85, transparent: true,
        opacity: isTenon ? 0.7 : 0.5,
      })
      const stockMesh = new THREE.Mesh(stockGeom, stockMat)
      scene.add(stockMesh)

      // Red wireframe — the stock boundary. If the bit crosses this, that's an error.
      const stockEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(stockGeom),
        new THREE.LineBasicMaterial({ color: 0xff2222 })
      )
      scene.add(stockEdges)

      const gridSize = Math.ceil(Math.max(maxDim, L) * 1.4)
      const grid = new THREE.GridHelper(gridSize, gridSize, COLOR.grid, COLOR.grid)
      grid.position.set(0, isTenon ? -T / 2 - 0.02 : -L / 2 - 0.05, 0)
      scene.add(grid)

      // Bit cylinder — origin at the tip. For mortise, axis along +Z (cuts come
      // from the +Z face). For tenon, axis stays along +Y (cuts come from the
      // top face of the horizontal board).
      const bitHeight = Math.max(0.6, maxDim * 0.04)
      const bitGeom = new THREE.CylinderGeometry(BIT_RADIUS, BIT_RADIUS, bitHeight, 18)
      bitGeom.translate(0, bitHeight / 2, 0)
      if (!isTenon) bitGeom.rotateX(Math.PI / 2)
      const bitMat = new THREE.MeshStandardMaterial({ color: COLOR.bit, roughness: 0.4, metalness: 0.6 })
      const bit = new THREE.Mesh(bitGeom, bitMat)
      scene.add(bit)

      // Trail lines — split into two LineSegments so cut moves can use vertex
      // colors (per pass) while rapid moves use a dashed gray material. Both
      // buffers are preallocated and prefilled at init so we never reallocate
      // and never have to recompute line distances mid-playback; we just
      // animate setDrawRange.
      let cutSegCount = 0, rapidSegCount = 0
      for (let i = 1; i < moves.length; i++) {
        if (moves[i].type === 'rapid') rapidSegCount++
        else cutSegCount++
      }
      const cutPos = new Float32Array(cutSegCount * 6)
      const cutCol = new Float32Array(cutSegCount * 6)
      const rapidPos = new Float32Array(rapidSegCount * 6)

      // Map each move index to its position in the right buffer. Each type's
      // segments are stored in chronological order, so step-back of the most
      // recent move always lines up with the current end of its buffer.
      const moveSeg = new Array(moves.length)
      let cIdx = 0, rIdx = 0
      for (let i = 1; i < moves.length; i++) {
        const a = moves[i - 1], b = moves[i]
        const [ax, ay, az] = positionFor(a)
        const [bx, by, bz] = positionFor(b)
        if (b.type === 'rapid') {
          rapidPos[rIdx * 6 + 0] = ax; rapidPos[rIdx * 6 + 1] = ay; rapidPos[rIdx * 6 + 2] = az
          rapidPos[rIdx * 6 + 3] = bx; rapidPos[rIdx * 6 + 4] = by; rapidPos[rIdx * 6 + 5] = bz
          moveSeg[i] = { idx: rIdx, isRapid: true }
          rIdx++
        } else {
          cutPos[cIdx * 6 + 0] = ax; cutPos[cIdx * 6 + 1] = ay; cutPos[cIdx * 6 + 2] = az
          cutPos[cIdx * 6 + 3] = bx; cutPos[cIdx * 6 + 4] = by; cutPos[cIdx * 6 + 5] = bz
          const c = colorForMove(b)
          const r  = ((c >> 16) & 0xff) / 255
          const g  = ((c >> 8)  & 0xff) / 255
          const bl =  (c        & 0xff) / 255
          cutCol[cIdx * 6 + 0] = r; cutCol[cIdx * 6 + 1] = g; cutCol[cIdx * 6 + 2] = bl
          cutCol[cIdx * 6 + 3] = r; cutCol[cIdx * 6 + 4] = g; cutCol[cIdx * 6 + 5] = bl
          moveSeg[i] = { idx: cIdx, isRapid: false }
          cIdx++
        }
      }

      const cutGeom = new THREE.BufferGeometry()
      cutGeom.setAttribute('position', new THREE.BufferAttribute(cutPos, 3))
      cutGeom.setAttribute('color',    new THREE.BufferAttribute(cutCol, 3))
      cutGeom.setDrawRange(0, 0)
      const cutMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })
      const cutLine = new THREE.LineSegments(cutGeom, cutMat)
      scene.add(cutLine)

      const rapidGeom = new THREE.BufferGeometry()
      rapidGeom.setAttribute('position', new THREE.BufferAttribute(rapidPos, 3))
      rapidGeom.setDrawRange(0, 0)
      const rapidMat = new THREE.LineDashedMaterial({
        color: COLOR.rapid, dashSize: 0.18, gapSize: 0.1,
        transparent: true, opacity: 0.6,
      })
      const rapidLine = new THREE.LineSegments(rapidGeom, rapidMat)
      // computeLineDistances is required for LineDashedMaterial; positions are
      // already final so we call it once here.
      rapidLine.computeLineDistances()
      scene.add(rapidLine)

      // Material removal — InstancedMesh, one slot per cut/dogbone move that
      // dips below z=0. count starts at 0 and grows as cuts complete.
      const voxelSlot = new Array(moves.length).fill(-1)
      let voxelCapacity = 0
      for (let i = 0; i < moves.length; i++) {
        const m = moves[i]
        if (m.type !== 'rapid' && m.z < 0) voxelSlot[i] = voxelCapacity++
      }
      let voxels = null
      const voxTmp = new THREE.Object3D()
      if (voxelCapacity > 0) {
        // Tile sits on the cut surface — thin along the cut-depth axis.
        // Mortise cuts go into +Z, so thin in Z. Tenon cuts go into +Y (top
        // of the horizontal board), so thin in Y.
        const voxGeom = isTenon
          ? new THREE.BoxGeometry(BIT_DIAMETER, 0.06, BIT_DIAMETER)
          : new THREE.BoxGeometry(BIT_DIAMETER, BIT_DIAMETER, 0.06)
        const voxMat  = new THREE.MeshStandardMaterial({ color: COLOR.void, transparent: true, opacity: 0.7 })
        voxels = new THREE.InstancedMesh(voxGeom, voxMat, voxelCapacity)
        voxels.count = 0
        scene.add(voxels)
      }

      // Tenon highlight — the shape of material that should remain at the
      // rail end after all cuts complete. Hidden during playback, revealed
      // when the bit reaches the last move so the user can confirm the cut
      // matches the intended joinery.
      let tenonHighlight = null
      if (isTenon && tenonDims) {
        const hGeom = new THREE.BoxGeometry(tenonDims.length, tenonDims.thickness, tenonDims.width)
        const hMat  = new THREE.MeshStandardMaterial({
          color: COLOR.tenon, roughness: 0.7,
          transparent: true, opacity: 0.85,
        })
        tenonHighlight = new THREE.Mesh(hGeom, hMat)
        tenonHighlight.position.set(L / 2 - tenonDims.length / 2, 0, 0)
        tenonHighlight.visible = false
        scene.add(tenonHighlight)
      }

      // Camera orbits around a target point. Mortise: world origin.
      // Tenon: the middle of the tenon area at the rail end. Orbiting world
      // origin would frame the entire 60" rail and shrink the tenon to
      // nothing — by orbiting the rail end face the cut stays centered as
      // the user drags.
      const target = isTenon
        ? new THREE.Vector3(L / 2 - tenonLength / 2, 0, 0)
        : new THREE.Vector3(0, 0, 0)
      const orbit = isTenon
        ? { theta: Math.PI / 4, phi: Math.PI / 8, distance: W * 3.5 }
        : { theta: -Math.PI / 10, phi: Math.PI / 8, distance: maxDim * 1.6 }

      const updateCamera = () => {
        const cosPhi = Math.cos(orbit.phi)
        camera.position.set(
          target.x + orbit.distance * cosPhi * Math.sin(orbit.theta),
          target.y + orbit.distance * Math.sin(orbit.phi),
          target.z + orbit.distance * cosPhi * Math.cos(orbit.theta),
        )
        camera.lookAt(target)
      }
      updateCamera()

      // Drag-to-rotate (orbit).
      let dragging = false
      let lastX = 0, lastY = 0
      const ptr = (e) => e.touches?.[0]
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
        : { x: e.clientX, y: e.clientY }
      const onDown = (e) => {
        dragging = true
        const p = ptr(e); lastX = p.x; lastY = p.y
        canvas.style.cursor = 'grabbing'
      }
      const onMoveEv = (e) => {
        if (!dragging) return
        if (e.cancelable) e.preventDefault()
        const p = ptr(e)
        const dx = p.x - lastX, dy = p.y - lastY
        lastX = p.x; lastY = p.y
        orbit.theta -= dx * 0.01
        orbit.phi = Math.max(-1.4, Math.min(1.4, orbit.phi + dy * 0.01))
        updateCamera()
      }
      const onUp = () => { dragging = false; canvas.style.cursor = 'grab' }

      canvas.addEventListener('mousedown',  onDown)
      window.addEventListener('mousemove',  onMoveEv)
      window.addEventListener('mouseup',    onUp)
      canvas.addEventListener('touchstart', onDown,   { passive: true })
      canvas.addEventListener('touchmove',  onMoveEv, { passive: false })
      canvas.addEventListener('touchend',   onUp)
      handlers.push(
        () => canvas.removeEventListener('mousedown',  onDown),
        () => window.removeEventListener('mousemove',  onMoveEv),
        () => window.removeEventListener('mouseup',    onUp),
        () => canvas.removeEventListener('touchstart', onDown),
        () => canvas.removeEventListener('touchmove',  onMoveEv),
        () => canvas.removeEventListener('touchend',   onUp),
      )

      const resize = () => {
        const w = wrap.clientWidth
        if (!w) return
        renderer.setSize(w, CANVAS_HEIGHT, false)
        camera.aspect = w / CANVAS_HEIGHT
        camera.updateProjectionMatrix()
      }
      const ro = new ResizeObserver(resize)
      ro.observe(wrap)
      handlers.push(() => ro.disconnect())

      // Imperative scene operations — exposed via sceneRef so the React-level
      // control buttons can drive the scene without owning Three objects.
      // Trail positions are prefilled; completeMove just advances drawRange
      // on the relevant buffer (cut or rapid).
      const completeMove = (i) => {
        if (i <= 0 || i >= moves.length) return
        const seg = moveSeg[i]
        if (seg.isRapid) {
          rapidGeom.setDrawRange(0, (seg.idx + 1) * 2)
        } else {
          cutGeom.setDrawRange(0, (seg.idx + 1) * 2)
        }

        if (voxels && voxelSlot[i] >= 0) {
          const slot = voxelSlot[i]
          const [bx, by, bz] = positionFor(moves[i])
          voxTmp.position.set(bx, by, bz)
          voxTmp.updateMatrix()
          voxels.setMatrixAt(slot, voxTmp.matrix)
          if (slot + 1 > voxels.count) voxels.count = slot + 1
          voxels.instanceMatrix.needsUpdate = true
        }

        if (tenonHighlight && i >= moves.length - 1) tenonHighlight.visible = true
      }

      const undoMove = (i) => {
        if (i <= 0 || i >= moves.length) return
        const seg = moveSeg[i]
        if (seg.isRapid) {
          rapidGeom.setDrawRange(0, seg.idx * 2)
        } else {
          cutGeom.setDrawRange(0, seg.idx * 2)
        }
        if (voxels && voxelSlot[i] >= 0 && voxelSlot[i] + 1 === voxels.count) {
          voxels.count = voxelSlot[i]
          voxels.instanceMatrix.needsUpdate = true
        }
        if (tenonHighlight) tenonHighlight.visible = false
      }

      const resetAll = () => {
        cutGeom.setDrawRange(0, 0)
        rapidGeom.setDrawRange(0, 0)
        if (voxels) { voxels.count = 0; voxels.instanceMatrix.needsUpdate = true }
        if (tenonHighlight) tenonHighlight.visible = false
      }

      const setBitToMove = (idx, frac) => {
        const a = moves[Math.max(0, idx)]
        const b = moves[Math.min(moves.length - 1, idx + 1)] || a
        const t = a === b ? 0 : frac
        const [px, py, pz] = interp(a, b, t)
        bit.position.set(px, py, pz)
      }

      const sceneState = sceneRef.current
      sceneState.THREE = THREE
      sceneState.scene = scene
      sceneState.renderer = renderer
      sceneState.completeMove = completeMove
      sceneState.undoMove = undoMove
      sceneState.resetAll = resetAll
      sceneState.setBitToMove = setBitToMove

      setBitToMove(0, 0)
      // Prime HUD so first paint shows the initial position rather than null.
      setProgress(0)
      setCurrentMove(moves[0])

      let lastT = performance.now()
      let hudAccum = 0
      const tickFn = (now) => {
        const dt = Math.min(0.1, (now - lastT) / 1000)
        lastT = now

        const st = stateRef.current
        if (st.playing && st.idx < moves.length - 1) {
          const movesPerSec = BASE_MOVES_PER_SEC * st.speed
          st.frac += dt * movesPerSec
          while (st.frac >= 1 && st.idx < moves.length - 1) {
            st.frac -= 1
            st.idx += 1
            completeMove(st.idx)
          }
          if (st.idx >= moves.length - 1) {
            st.frac = 0
            st.playing = false
            setPlaying(false)
          }
        }

        setBitToMove(st.idx, st.frac)
        renderer.render(scene, camera)

        hudAccum += dt
        if (hudAccum > 0.08) {
          hudAccum = 0
          const denom = Math.max(1, moves.length - 1)
          setProgress(Math.min(100, ((st.idx + st.frac) / denom) * 100))
          setCurrentMove(moves[Math.min(moves.length - 1, st.idx + (st.frac > 0 ? 1 : 0))])
        }

        animId = requestAnimationFrame(tickFn)
      }
      animId = requestAnimationFrame(tickFn)
    }

    init()

    return () => {
      cancelled = true
      cancelAnimationFrame(animId)
      handlers.forEach(fn => { try { fn() } catch {} })
      const s = sceneRef.current
      if (s.renderer) try { s.renderer.dispose() } catch {}
      if (s.scene) {
        s.scene.traverse(obj => {
          if (obj.geometry) obj.geometry.dispose?.()
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose?.())
            else obj.material.dispose?.()
          }
        })
      }
      sceneRef.current = {}
    }
  }, [moves, T, W, L, isTenon, tenonLength, tenonDims])

  const onPlayPause = () => {
    if (stateRef.current.idx >= moves.length - 1) {
      // At end — reset then play.
      stateRef.current.idx = 0
      stateRef.current.frac = 0
      sceneRef.current.resetAll?.()
      sceneRef.current.setBitToMove?.(0, 0)
    }
    stateRef.current.playing = !stateRef.current.playing
    setPlaying(stateRef.current.playing)
  }

  const onSpeedSelect = (s) => {
    stateRef.current.speed = s
    setSpeed(s)
  }

  const onStepFwd = () => {
    const st = stateRef.current
    if (st.idx >= moves.length - 1) return
    st.playing = false
    setPlaying(false)
    st.idx += 1
    st.frac = 0
    sceneRef.current.completeMove?.(st.idx)
    sceneRef.current.setBitToMove?.(st.idx, 0)
    const denom = Math.max(1, moves.length - 1)
    setProgress(Math.min(100, (st.idx / denom) * 100))
    setCurrentMove(moves[st.idx])
  }

  const onStepBack = () => {
    const st = stateRef.current
    if (st.idx <= 0) return
    st.playing = false
    setPlaying(false)
    sceneRef.current.undoMove?.(st.idx)
    st.idx -= 1
    st.frac = 0
    sceneRef.current.setBitToMove?.(st.idx, 0)
    const denom = Math.max(1, moves.length - 1)
    setProgress(Math.min(100, (st.idx / denom) * 100))
    setCurrentMove(moves[st.idx])
  }

  const onReset = () => {
    const st = stateRef.current
    st.idx = 0; st.frac = 0; st.playing = false
    sceneRef.current.resetAll?.()
    sceneRef.current.setBitToMove?.(0, 0)
    setPlaying(false)
    setProgress(0)
    setCurrentMove(moves[0] || null)
  }

  const passLabel = currentMove
    ? (currentMove.type === 'dogbone'
        ? (currentMove.mortise ? `${currentMove.mortise}: Dog bone corners` : 'Dog bone corners')
        : (currentMove.pass > 0
            ? `${currentMove.mortise ? currentMove.mortise + ': ' : ''}Pass ${currentMove.pass}${totalPasses > 0 ? ` of ${totalPasses}` : ''}`
            : currentMove.opLabel))
    : '—'

  const legendItems = [
    { label: 'Pass 1',    color: '#B5D4F4' },
    { label: 'Pass 2',    color: '#378ADD' },
    { label: 'Pass 3',    color: '#185FA5' },
    { label: 'Pass 4',    color: '#0C447C' },
    { label: 'Dog bones', color: '#E24B4A' },
    { label: 'Rapid',     color: '#999999' },
    ...(isTenon ? [{ label: 'Tenon', color: '#D4A574' }] : []),
  ]

  return (
    <div style={styles.panel}>
      <div style={styles.banner}>
        ⚠ Simulation only — always verify G-code before running on CNC machine
      </div>

      <div style={styles.header}>
        <div style={styles.title}>{partName ? `${partName} — Toolpath` : 'Toolpath simulator'}</div>
      </div>

      <div ref={wrapRef} style={styles.wrap}>
        <canvas ref={canvasRef} style={styles.canvas} />
        <div style={styles.hint}>{error ? `error: ${error}` : 'drag to rotate'}</div>
      </div>

      <div style={styles.controls}>
        <div style={styles.opLabel}>{passLabel}</div>

        <div style={styles.posReadout}>
          {currentMove
            ? `X: ${fmtPos(currentMove.x)}"   Y: ${fmtPos(currentMove.y)}"   Z: ${fmtPos(currentMove.z)}"`
            : '—'}
        </div>

        <div style={styles.progressBar}>
          <div style={styles.progressFill(progress)} />
        </div>

        <div style={styles.rowTop}>
          <button style={styles.playBtn(playing)} onClick={onPlayPause} disabled={!moves.length}>
            {playing ? 'Pause' : 'Play'}
          </button>

          <span style={styles.speedLabel}>Speed</span>
          {SPEED_OPTIONS.map(s => (
            <button key={s} style={styles.speedBtn(speed === s)} onClick={() => onSpeedSelect(s)}>
              {s}x
            </button>
          ))}

          <button style={styles.stepBtn} onClick={onStepBack} title="Step back one move">◀ Step</button>
          <button style={styles.stepBtn} onClick={onStepFwd}  title="Step forward one move">Step ▶</button>
          <button style={styles.resetBtn} onClick={onReset}>Reset</button>
        </div>

        <div style={styles.legend}>
          {legendItems.map(it => (
            <span key={it.label} style={styles.legendItem}>
              <span style={styles.legendSwatch(it.color)} />
              {it.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
