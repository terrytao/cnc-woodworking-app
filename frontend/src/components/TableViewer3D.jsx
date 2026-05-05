import { useEffect, useRef, useState } from 'react'

const THREE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'

const COLOR = {
  top:       '#C8A882',
  leg:       '#A0785A',
  rail:      '#B89060',
  stretcher: '#9A7050',
  dimL:      '#185FA5',
  dimW:      '#085041',
  dimH:      '#712B13',
  dimLeg:    '#666666',
}

const CANVAS_HEIGHT = 300
const VIEWS = ['3D', 'Top', 'Front', 'Side', 'Exploded']
const ROTATABLE = new Set(['3D', 'Exploded'])

// Shared loader: dedupes against any previously injected three.min.js script
// so this component coexists with JointViewer3D's loader.
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
    s.onload  = () => resolve(window.THREE)
    s.onerror = onErr
    document.head.appendChild(s)
  })
  return threePromise
}

const styles = {
  wrap:    { position: 'relative', width: '100%', height: CANVAS_HEIGHT, background: '#fafafa', border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden' },
  canvas:  { display: 'block', width: '100%', height: '100%', touchAction: 'none' },
  svg:     { position: 'absolute', inset: 0, pointerEvents: 'none', width: '100%', height: '100%' },
  toolbar: { position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 4, background: 'rgba(255,255,255,0.85)', padding: 4, borderRadius: 6 },
  btn: (a) => ({ padding: '4px 10px', fontSize: 11, fontWeight: 600, border: `1px solid ${a ? '#2d4a22' : '#cfcfcf'}`, background: a ? '#2d4a22' : '#fff', color: a ? '#fff' : '#444', borderRadius: 4, cursor: 'pointer' }),
  hint:    { position: 'absolute', bottom: 6, right: 8, fontSize: 10, color: '#888', pointerEvents: 'none' },
}

const fmtIn = (n) => Number.isFinite(n) ? `${n.toFixed(n >= 10 ? 1 : 2)}"` : ''

function classifyTablePart(part) {
  const name = (part?.partName || part?.name || '').toLowerCase()
  if (/\bstretcher\b/.test(name))                                          return 'stretcher'
  if (/\b(top|tabletop|table\s*top|panel|breadboard|seat)\b/.test(name))   return 'top'
  if (/\b(leg|post|stile|column)\b/.test(name))                            return 'leg'
  if (/\b(rail|apron|crosspiece|skirt|beam|brace)\b/.test(name))           return 'rail'
  if (/\b(shelf|board)\b/.test(name))                                      return 'top'
  return 'other'
}

// Engine emits { width, height, depth }; the spec for this component uses
// { length, width, height }. Accept either: prefer explicit length, otherwise
// use width as the long horizontal and depth as the short horizontal.
function normalizeDims(overall) {
  const o = overall || {}
  const length = Number(o.length ?? o.width)  || 48
  const width  = Number(o.length != null ? o.width : o.depth) || 24
  const height = Number(o.height) || 30
  return { length, width, height }
}

function buildModel(parts, overall) {
  const dims = normalizeDims(overall)
  const groups = { top: [], leg: [], rail: [], stretcher: [], other: [] }
  for (const p of (parts || [])) groups[classifyTablePart(p)].push(p)

  const stockOf = (part, key, dflt) => part?.stock?.actual?.[key] ?? dflt

  const topPart       = groups.top[0]
  const legPart       = groups.leg[0]
  const railPart      = groups.rail[0]
  const stretcherPart = groups.stretcher[0]

  return {
    ...dims,
    hasTop:          !!topPart,
    hasLeg:          !!legPart,
    hasRail:         !!railPart,
    hasStretcher:    !!stretcherPart,
    topThickness:    topPart       ? stockOf(topPart,       'thickness', 0.75) : 0.75,
    legCross:        legPart       ? stockOf(legPart,       'thickness', 1.5)  : 1.5,
    railHeight:      railPart      ? stockOf(railPart,      'width',     3.0)  : 3.0,
    railThick:       railPart      ? stockOf(railPart,      'thickness', 0.75) : 0.75,
    stretcherHeight: stretcherPart ? stockOf(stretcherPart, 'width',     2.5)  : 2.5,
    stretcherThick:  stretcherPart ? stockOf(stretcherPart, 'thickness', 0.75) : 0.75,
  }
}

export default function TableViewer3D({ parts, overallDimensions }) {
  const wrapRef   = useRef(null)
  const canvasRef = useRef(null)
  const sceneRef  = useRef({})
  const viewRef   = useRef('3D')
  const [view,   setView]   = useState('3D')
  const [labels, setLabels] = useState([])
  const [error,  setError]  = useState(null)

  useEffect(() => { viewRef.current = view }, [view])

  useEffect(() => {
    let cancelled = false
    let animId    = 0
    const cleanups = []

    const init = async () => {
      let THREE
      try { THREE = await loadThree() }
      catch (e) { if (!cancelled) setError(e.message); return }
      if (cancelled || !canvasRef.current) return

      const canvas = canvasRef.current
      const wrap   = wrapRef.current
      const w0 = Math.max(wrap.clientWidth || 600, 100)
      const h0 = CANVAS_HEIGHT

      const scene  = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(35, w0 / h0, 0.5, 5000)
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(w0, h0, false)

      scene.add(new THREE.AmbientLight(0xffffff, 0.6))
      const keyL  = new THREE.DirectionalLight(0xffffff, 0.75)
      keyL.position.set(40, 90, 40)
      scene.add(keyL)
      const fillL = new THREE.DirectionalLight(0xffffff, 0.25)
      fillL.position.set(-30, 20, -20)
      scene.add(fillL)

      const root = new THREE.Group()
      scene.add(root)

      const model = buildModel(parts, overallDimensions)
      const {
        length: L, width: W, height: H,
        topThickness: TT, legCross: LC,
        railHeight: RH, railThick: RT,
        hasTop, hasLeg, hasRail, hasStretcher,
        stretcherHeight: SH, stretcherThick: ST,
      } = model

      const legHeight = Math.max(H - (hasTop ? TT : 0), 1)

      const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0 })
      const addBox = (sx, sy, sz, color, role) => {
        const geom  = new THREE.BoxGeometry(sx, sy, sz)
        const mesh  = new THREE.Mesh(geom, mat(color))
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geom),
          new THREE.LineBasicMaterial({ color: 0x4a3a23, transparent: true, opacity: 0.3 })
        )
        mesh.add(edges)
        mesh.userData.role = role
        root.add(mesh)
        return mesh
      }

      if (hasTop) {
        const top = addBox(L, TT, W, COLOR.top, 'top')
        top.position.set(0, legHeight + TT / 2, 0)
      }
      if (hasLeg) {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const leg = addBox(LC, legHeight, LC, COLOR.leg, 'leg')
          leg.position.set(sx * (L / 2 - LC / 2), legHeight / 2, sz * (W / 2 - LC / 2))
        }
      }
      if (hasRail) {
        const railY    = legHeight - RH / 2
        const longLen  = Math.max(L - 2 * LC, 1)
        const shortLen = Math.max(W - 2 * LC, 1)
        for (const sz of [-1, 1]) {
          const r = addBox(longLen, RH, RT, COLOR.rail, 'rail')
          r.position.set(0, railY, sz * (W / 2 - RT / 2))
        }
        for (const sx of [-1, 1]) {
          const r = addBox(RT, RH, shortLen, COLOR.rail, 'rail')
          r.position.set(sx * (L / 2 - RT / 2), railY, 0)
        }
      }
      if (hasStretcher) {
        const sY      = SH / 2 + 4
        const longLen = Math.max(L - 2 * LC, 1)
        for (const sz of [-1, 1]) {
          const s = addBox(longLen, SH, ST, COLOR.stretcher, 'stretcher')
          s.position.set(0, sY, sz * (W / 2 - ST / 2))
        }
      }

      // Snapshot original Y for explosion
      root.children.forEach(c => { c.userData.origY = c.position.y })

      const target = new THREE.Vector3(0, H / 2, 0)

      const applyView = (mode) => {
        const max = Math.max(L, W, H)
        if (mode === '3D' || mode === 'Exploded') {
          camera.up.set(0, 1, 0)
          camera.position.set(L * 0.9, H * 1.4, W * 1.1 + max * 0.6)
        } else if (mode === 'Top') {
          camera.up.set(0, 0, -1)
          camera.position.set(0, max * 1.9, 0.0001)
        } else if (mode === 'Front') {
          camera.up.set(0, 1, 0)
          camera.position.set(0, H / 2, max * 1.9)
        } else if (mode === 'Side') {
          camera.up.set(0, 1, 0)
          camera.position.set(max * 1.9, H / 2, 0)
        }
        camera.lookAt(target)
        if (!ROTATABLE.has(mode)) root.rotation.set(0, 0, 0)

        const explode = mode === 'Exploded'
        for (const c of root.children) {
          if (c.userData?.origY === undefined) continue
          const role = c.userData.role
          const offset = !explode ? 0
            : role === 'top'       ?  H * 0.55
            : role === 'rail'      ?  H * 0.18
            : role === 'stretcher' ? -H * 0.12
            : 0
          c.position.y = c.userData.origY + offset
        }
      }
      applyView(viewRef.current)

      // Drag-to-rotate (only in rotatable views)
      let dragging = false
      let lastX = 0, lastY = 0
      const ptr = (e) => e.touches && e.touches[0]
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
        : { x: e.clientX, y: e.clientY }
      const onDown = (e) => {
        if (!ROTATABLE.has(viewRef.current)) return
        dragging = true
        const p = ptr(e); lastX = p.x; lastY = p.y
        canvas.style.cursor = 'grabbing'
      }
      const onMove = (e) => {
        if (!dragging) return
        if (e.cancelable) e.preventDefault()
        const p = ptr(e)
        const dx = p.x - lastX, dy = p.y - lastY
        lastX = p.x; lastY = p.y
        root.rotation.y += dx * 0.008
        root.rotation.x = Math.max(-1.0, Math.min(1.0, root.rotation.x + dy * 0.008))
      }
      const onUp = () => {
        dragging = false
        canvas.style.cursor = ROTATABLE.has(viewRef.current) ? 'grab' : 'default'
      }
      canvas.addEventListener('mousedown',  onDown)
      window.addEventListener('mousemove',  onMove)
      window.addEventListener('mouseup',    onUp)
      canvas.addEventListener('touchstart', onDown, { passive: true })
      canvas.addEventListener('touchmove',  onMove, { passive: false })
      canvas.addEventListener('touchend',   onUp)
      cleanups.push(
        () => canvas.removeEventListener('mousedown',  onDown),
        () => window.removeEventListener('mousemove',  onMove),
        () => window.removeEventListener('mouseup',    onUp),
        () => canvas.removeEventListener('touchstart', onDown),
        () => canvas.removeEventListener('touchmove',  onMove),
        () => canvas.removeEventListener('touchend',   onUp),
      )
      canvas.style.cursor = ROTATABLE.has(viewRef.current) ? 'grab' : 'default'

      // Resize observer
      const resize = () => {
        const w = wrap.clientWidth
        if (!w) return
        renderer.setSize(w, CANVAS_HEIGHT, false)
        camera.aspect = w / CANVAS_HEIGHT
        camera.updateProjectionMatrix()
      }
      const ro = new ResizeObserver(resize)
      ro.observe(wrap)
      cleanups.push(() => ro.disconnect())

      // Dimension projection / outward direction
      const v3 = new THREE.Vector3()
      const projectPt = (x, y, z) => {
        v3.set(x, y, z).applyMatrix4(root.matrixWorld).project(camera)
        const rect = canvas.getBoundingClientRect()
        return {
          x: (v3.x * 0.5 + 0.5) * rect.width,
          y: (-v3.y * 0.5 + 0.5) * rect.height,
          z: v3.z,
        }
      }

      const computeLabels = () => {
        const mode = viewRef.current
        const out = []
        const center = projectPt(0, H / 2, 0)
        const addDim = (a, b, label, color) => {
          const pa = projectPt(a[0], a[1], a[2])
          const pb = projectPt(b[0], b[1], b[2])
          if (pa.z >= 1 || pa.z <= -1 || pb.z >= 1 || pb.z <= -1) return
          const dx = pb.x - pa.x, dy = pb.y - pa.y
          const len = Math.hypot(dx, dy)
          if (len < 8) return
          // Perpendicular to the dim line, then flip so it points away from
          // the projected table center (gives the dim line a sensible side).
          const px = -dy / len, py = dx / len
          const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
          const dot = px * (center.x - mid.x) + py * (center.y - mid.y)
          const ox = dot > 0 ? -px : px
          const oy = dot > 0 ? -py : py
          out.push({ a: pa, b: pb, ox, oy, label, color })
        }

        const showL = mode === '3D' || mode === 'Exploded' || mode === 'Top'   || mode === 'Front'
        const showW = mode === '3D' || mode === 'Exploded' || mode === 'Top'   || mode === 'Side'
        const showH = mode === '3D' || mode === 'Exploded' || mode === 'Front' || mode === 'Side'
        const showLeg = (mode === '3D' || mode === 'Exploded') && hasLeg

        if (showL) addDim([-L / 2, 0,  W / 2], [ L / 2, 0, W / 2], fmtIn(L), COLOR.dimL)
        if (showW) addDim([ L / 2, 0, -W / 2], [ L / 2, 0, W / 2], fmtIn(W), COLOR.dimW)
        if (showH) addDim([ L / 2, 0,  W / 2], [ L / 2, H, W / 2], fmtIn(H), COLOR.dimH)
        if (showLeg) addDim([L / 2 - LC, 0, W / 2], [L / 2, 0, W / 2], fmtIn(LC), COLOR.dimLeg)

        return out
      }

      const tick = () => {
        renderer.render(scene, camera)
        setLabels(computeLabels())
        animId = requestAnimationFrame(tick)
      }
      tick()

      const s = sceneRef.current
      s.applyView = applyView
      s.canvas    = canvas
      s.scene     = scene
      s.renderer  = renderer
      s.THREE     = THREE
      s.cleanups  = cleanups
    }

    init()

    return () => {
      cancelled = true
      cancelAnimationFrame(animId)
      cleanups.forEach(fn => { try { fn() } catch {} })
      const s = sceneRef.current
      if (s.renderer) { try { s.renderer.dispose() } catch {} }
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
  }, [parts, overallDimensions])

  useEffect(() => {
    const s = sceneRef.current
    if (s.applyView) {
      s.applyView(view)
      if (s.canvas) s.canvas.style.cursor = ROTATABLE.has(view) ? 'grab' : 'default'
    }
  }, [view])

  return (
    <div ref={wrapRef} style={styles.wrap}>
      <canvas ref={canvasRef} style={styles.canvas} />
      <svg style={styles.svg}>
        {labels.map((d, i) => {
          const off  = 26
          const gap  = 3
          const half = 2
          const ax1 = d.a.x + d.ox * gap,         ay1 = d.a.y + d.oy * gap
          const ax2 = d.a.x + d.ox * (off + 4),   ay2 = d.a.y + d.oy * (off + 4)
          const bx1 = d.b.x + d.ox * gap,         by1 = d.b.y + d.oy * gap
          const bx2 = d.b.x + d.ox * (off + 4),   by2 = d.b.y + d.oy * (off + 4)
          const dax = d.a.x + d.ox * off,         day = d.a.y + d.oy * off
          const dbx = d.b.x + d.ox * off,         dby = d.b.y + d.oy * off
          const tax1 = dax - d.ox * half, tay1 = day - d.oy * half
          const tax2 = dax + d.ox * half, tay2 = day + d.oy * half
          const tbx1 = dbx - d.ox * half, tby1 = dby - d.oy * half
          const tbx2 = dbx + d.ox * half, tby2 = dby + d.oy * half
          const tx = (dax + dbx) / 2 + d.ox * 9
          const ty = (day + dby) / 2 + d.oy * 9
          return (
            <g key={i} stroke={d.color} fill="none" strokeWidth={1}>
              <line x1={ax1} y1={ay1} x2={ax2} y2={ay2} />
              <line x1={bx1} y1={by1} x2={bx2} y2={by2} />
              <line x1={dax} y1={day} x2={dbx} y2={dby} />
              <line x1={tax1} y1={tay1} x2={tax2} y2={tay2} />
              <line x1={tbx1} y1={tby1} x2={tbx2} y2={tby2} />
              <text
                x={tx} y={ty}
                fill={d.color} stroke="#fafafa" strokeWidth={3} paintOrder="stroke"
                fontSize={10} fontFamily="ui-monospace, Menlo, monospace"
                fontWeight={700} textAnchor="middle" dominantBaseline="middle"
              >{d.label}</text>
            </g>
          )
        })}
      </svg>
      <div style={styles.toolbar}>
        {VIEWS.map(v => (
          <button key={v} style={styles.btn(view === v)} onClick={() => setView(v)}>{v}</button>
        ))}
      </div>
      <div style={styles.hint}>
        {error ? `error: ${error}` : (ROTATABLE.has(view) ? 'drag to rotate' : '')}
      </div>
    </div>
  )
}
