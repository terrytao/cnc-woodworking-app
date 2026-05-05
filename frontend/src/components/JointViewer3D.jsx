import { useEffect, useRef, useState } from 'react'
import { toFraction } from '../utils/fractions'

const THREE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'

const COLOR = {
  leg:        '#C19A6B',
  mortise:    '#8B5E3C',
  rail:       '#A0785A',
  tenon:      '#D4A574',
  mortLabel:  '#993C1D',
  tenonLabel: '#534AB7',
}

const CANVAS_HEIGHT = 280

const styles = {
  wrap:       { position: 'relative', width: '100%', height: CANVAS_HEIGHT, background: '#fafafa', border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden', marginTop: 8 },
  canvas:     { display: 'block', width: '100%', height: '100%', cursor: 'grab', touchAction: 'none' },
  svg:        { position: 'absolute', inset: 0, pointerEvents: 'none', width: '100%', height: '100%' },
  toolbar:    { position: 'absolute', top: 8, left: 8, display: 'flex', gap: 4 },
  btn: (a) => ({ padding: '4px 10px', fontSize: 11, fontWeight: 600, border: `1px solid ${a ? '#2d4a22' : '#cfcfcf'}`, background: a ? '#2d4a22' : '#fff', color: a ? '#fff' : '#444', borderRadius: 4, cursor: 'pointer' }),
  hint:       { position: 'absolute', bottom: 6, right: 8, fontSize: 10, color: '#888', pointerEvents: 'none' },
}

let threePromise = null
function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE)
  if (threePromise) return threePromise
  threePromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = THREE_CDN
    s.async = true
    s.onload  = () => resolve(window.THREE)
    s.onerror = () => { threePromise = null; reject(new Error('Failed to load Three.js')) }
    document.head.appendChild(s)
  })
  return threePromise
}

const fmt = (n) => toFraction(n)

export default function JointViewer3D({ mortise, tenon, legThickness, railWidth }) {
  const canvasRef = useRef(null)
  const wrapRef   = useRef(null)
  const sceneRef  = useRef({})
  const viewRef   = useRef('assembled')
  const [view,   setView]   = useState('assembled')
  const [labels, setLabels] = useState([])
  const [error,  setError]  = useState(null)

  useEffect(() => { viewRef.current = view }, [view])

  useEffect(() => {
    let cancelled = false
    let animId    = 0
    const handlers = []

    const init = async () => {
      let THREE
      try { THREE = await loadThree() }
      catch (e) { if (!cancelled) setError(e.message); return }
      if (cancelled || !canvasRef.current) return

      const canvas = canvasRef.current
      const wrap   = wrapRef.current
      const w0 = wrap.clientWidth || 600
      const h0 = CANVAS_HEIGHT

      const scene  = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(38, w0 / h0, 0.1, 200)
      camera.position.set(7, 5.5, 9)
      camera.lookAt(0, 0, 0)

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.setSize(w0, h0, false)

      scene.add(new THREE.AmbientLight(0xffffff, 0.65))
      const key = new THREE.DirectionalLight(0xffffff, 0.7)
      key.position.set(6, 9, 6)
      scene.add(key)
      const fill = new THREE.DirectionalLight(0xffffff, 0.25)
      fill.position.set(-5, 2, -3)
      scene.add(fill)

      const root = new THREE.Group()
      scene.add(root)
      root.rotation.y = -0.45
      root.rotation.x = -0.18

      const lt    = legThickness > 0 ? legThickness : 3.5
      const rw    = railWidth   > 0 ? railWidth   : 3.0
      const m     = mortise || { width: 0.75, length: 1.5, depth: 1.0 }
      const t     = tenon   || { thickness: 0.65, length: 0.95, width: 1.4 }
      const railThickness = Math.max(t.thickness + 0.4, 0.6)
      const railLen       = 4.0
      const legHeight     = Math.max(rw + 2, m.length + 2, lt * 1.4)

      const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...opts })

      const legMesh = new THREE.Mesh(new THREE.BoxGeometry(lt, legHeight, lt), mat(COLOR.leg))
      root.add(legMesh)

      const legEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(legMesh.geometry),
        new THREE.LineBasicMaterial({ color: 0x6b4f30, transparent: true, opacity: 0.35 })
      )
      legMesh.add(legEdges)

      const mortMesh = new THREE.Mesh(
        new THREE.BoxGeometry(m.width, m.length, m.depth),
        mat(COLOR.mortise, { transparent: true, opacity: 0.9 })
      )
      mortMesh.position.set(0, 0, lt / 2 - m.depth / 2 + 0.002)
      root.add(mortMesh)

      const railMesh = new THREE.Mesh(new THREE.BoxGeometry(railThickness, rw, railLen), mat(COLOR.rail))
      root.add(railMesh)

      const tenonMesh = new THREE.Mesh(new THREE.BoxGeometry(t.thickness, t.width, t.length), mat(COLOR.tenon))
      root.add(tenonMesh)

      const layoutForView = (mode) => {
        const explode  = mode === 'exploded' ? 1.8 : 0
        const showRail = mode !== 'mortise'
        railMesh.visible  = showRail
        tenonMesh.visible = showRail
        railMesh.position.set(0,  0, lt / 2 + railLen / 2 + explode)
        tenonMesh.position.set(0, 0, lt / 2 - t.length / 2 + explode)
      }
      layoutForView(viewRef.current)

      const s = sceneRef.current
      s.THREE = THREE
      s.scene = scene
      s.camera = camera
      s.renderer = renderer
      s.root = root
      s.legMesh = legMesh
      s.mortMesh = mortMesh
      s.railMesh = railMesh
      s.tenonMesh = tenonMesh
      s.layoutForView = layoutForView
      s.dims = { m, t, lt, rw }

      // Drag-to-rotate
      let dragging = false
      let lastX = 0, lastY = 0
      const ptr = (e) => {
        if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY }
        return { x: e.clientX, y: e.clientY }
      }
      const onDown = (e) => {
        dragging = true
        const p = ptr(e)
        lastX = p.x; lastY = p.y
        canvas.style.cursor = 'grabbing'
      }
      const onMove = (e) => {
        if (!dragging) return
        if (e.cancelable) e.preventDefault()
        const p = ptr(e)
        const dx = p.x - lastX
        const dy = p.y - lastY
        lastX = p.x; lastY = p.y
        root.rotation.y += dx * 0.01
        root.rotation.x = Math.max(-1.2, Math.min(1.2, root.rotation.x + dy * 0.01))
      }
      const onUp = () => {
        dragging = false
        canvas.style.cursor = 'grab'
      }

      canvas.addEventListener('mousedown',  onDown)
      window.addEventListener('mousemove',  onMove)
      window.addEventListener('mouseup',    onUp)
      canvas.addEventListener('touchstart', onDown,  { passive: true })
      canvas.addEventListener('touchmove',  onMove,  { passive: false })
      canvas.addEventListener('touchend',   onUp)
      handlers.push(
        () => canvas.removeEventListener('mousedown',  onDown),
        () => window.removeEventListener('mousemove',  onMove),
        () => window.removeEventListener('mouseup',    onUp),
        () => canvas.removeEventListener('touchstart', onDown),
        () => canvas.removeEventListener('touchmove',  onMove),
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

      const v3 = new THREE.Vector3()
      const projectFromMesh = (mesh, lx, ly, lz) => {
        v3.set(lx, ly, lz).applyMatrix4(mesh.matrixWorld).project(camera)
        const rect = canvas.getBoundingClientRect()
        return {
          x: (v3.x * 0.5 + 0.5) * rect.width,
          y: (-v3.y * 0.5 + 0.5) * rect.height,
          z: v3.z,
        }
      }

      const buildLabels = () => {
        const out = []
        const mode = viewRef.current
        const dx = m.width / 2  + 0.35
        const dy = m.length / 2 + 0.35
        const dz = m.depth / 2  + 0.005

        const add = (key, text, color, mesh, lx, ly, lz) => {
          const p = projectFromMesh(mesh, lx, ly, lz)
          if (p.z > -1 && p.z < 1) out.push({ key, text, color, x: p.x, y: p.y })
        }
        add('mW', `W ${fmt(m.width)}`,  COLOR.mortLabel, mortMesh,  0,   dy, dz)
        add('mL', `L ${fmt(m.length)}`, COLOR.mortLabel, mortMesh,  dx,  0,  dz)
        add('mD', `D ${fmt(m.depth)}`,  COLOR.mortLabel, mortMesh, -dx, -dy, 0)

        if (mode !== 'mortise') {
          const tx = t.thickness / 2 + 0.35
          const ty = t.width / 2     + 0.35
          const tz = t.length / 2    + 0.05
          add('tT', `T ${fmt(t.thickness)}`, COLOR.tenonLabel, tenonMesh,  0,   ty, -tz)
          add('tW', `W ${fmt(t.width)}`,     COLOR.tenonLabel, tenonMesh,  tx,  0,  -tz)
          add('tL', `L ${fmt(t.length)}`,    COLOR.tenonLabel, tenonMesh,  tx, -ty, 0)
        }
        return out
      }

      const tick = () => {
        renderer.render(scene, camera)
        setLabels(buildLabels())
        animId = requestAnimationFrame(tick)
      }
      tick()
    }

    init()

    return () => {
      cancelled = true
      cancelAnimationFrame(animId)
      handlers.forEach(fn => { try { fn() } catch {} })
      const s = sceneRef.current
      if (s.renderer) {
        try { s.renderer.dispose() } catch {}
      }
      if (s.scene && s.THREE) {
        s.scene.traverse(obj => {
          if (obj.geometry) obj.geometry.dispose?.()
          if (obj.material) {
            if (Array.isArray(obj.material)) obj.material.forEach(mt => mt.dispose?.())
            else obj.material.dispose?.()
          }
        })
      }
      sceneRef.current = {}
    }
  }, [mortise, tenon, legThickness, railWidth])

  useEffect(() => {
    const s = sceneRef.current
    if (s.layoutForView) s.layoutForView(view)
  }, [view])

  return (
    <div ref={wrapRef} style={styles.wrap}>
      <canvas ref={canvasRef} style={styles.canvas} />
      <svg style={styles.svg}>
        {labels.map(l => (
          <g key={l.key}>
            <rect x={l.x - 22} y={l.y - 8} width={44} height={14} rx={3}
                  fill="#ffffff" fillOpacity={0.85} stroke={l.color} strokeWidth={0.5} />
            <text x={l.x} y={l.y + 3} fill={l.color} fontSize={10} fontWeight={700}
                  textAnchor="middle" fontFamily="system-ui, sans-serif">{l.text}</text>
          </g>
        ))}
      </svg>
      <div style={styles.toolbar}>
        <button style={styles.btn(view === 'exploded')}  onClick={() => setView('exploded')}>Exploded</button>
        <button style={styles.btn(view === 'assembled')} onClick={() => setView('assembled')}>Assembled</button>
        <button style={styles.btn(view === 'mortise')}   onClick={() => setView('mortise')}>Mortise only</button>
      </div>
      <div style={styles.hint}>{error ? `error: ${error}` : 'drag to rotate'}</div>
    </div>
  )
}
