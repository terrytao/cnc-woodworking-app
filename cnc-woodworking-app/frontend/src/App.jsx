import { useState, useRef, useCallback } from 'react'
import JointViewer3D from './components/JointViewer3D'
import TableViewer3D from './components/TableViewer3D'

const API_URL = import.meta.env.VITE_API_URL || '/api/generate'
const UNITS_OPTIONS = ['inches', 'millimeters']

const GREEN  = '#2d4a22'
const LGREEN = '#f0f7ec'

const styles = {
  container:   { maxWidth: 920, margin: '0 auto', padding: '24px 16px', fontFamily: "'Segoe UI', system-ui, sans-serif", color: '#1a1a1a' },
  header:      { textAlign: 'center', marginBottom: 32 },
  title:       { fontSize: 28, fontWeight: 700, margin: '0 0 8px', color: GREEN },
  subtitle:    { color: '#666', fontSize: 15, margin: 0 },
  card:        { background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 24, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tabBar:      { display: 'flex', gap: 8, marginBottom: 20 },
  tab: (a)  => ({ flex: 1, padding: '10px 16px', border: `2px solid ${a ? GREEN : '#d0d0d0'}`, borderRadius: 8, background: a ? GREEN : '#fff', color: a ? '#fff' : '#555', cursor: 'pointer', fontWeight: 600, fontSize: 14, transition: 'all 0.15s' }),
  textarea:    { width: '100%', minHeight: 120, padding: 12, border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' },
  dropzone: (o)=>({ border: `2px dashed ${o ? GREEN : '#b0b0b0'}`, borderRadius: 10, padding: 40, textAlign: 'center', cursor: 'pointer', background: o ? LGREEN : '#fafafa', transition: 'all 0.15s', color: '#666' }),
  preview:     { maxWidth: '100%', maxHeight: 240, borderRadius: 8, margin: '12px auto 0', display: 'block' },
  row:         { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' },
  field:       { flex: 1, minWidth: 140 },
  label:       { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#444' },
  select:      { width: '100%', padding: '8px 10px', border: '1px solid #d0d0d0', borderRadius: 6, fontSize: 14, background: '#fff', outline: 'none' },
  button:      { display: 'block', width: '100%', padding: '13px', background: GREEN, color: '#fff', border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.3 },
  buttonSm:    { padding: '8px 18px', background: GREEN, color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  buttonDisabled: { background: '#8aab7a', cursor: 'not-allowed' },
  error:       { background: '#fff3f3', border: '1px solid #f5c0c0', borderRadius: 8, padding: '12px 16px', color: '#c00', fontSize: 14, marginBottom: 16 },
  warn:        { background: '#fffbe6', border: '1px solid #ffe082', borderRadius: 6, padding: '6px 12px', color: '#7a5c00', fontSize: 13, marginTop: 4 },
  note:        { background: '#eef5ff', border: '1px solid #c8dafc', borderRadius: 6, padding: '6px 12px', color: '#274d8a', fontSize: 13, marginTop: 4 },
  sectionTitle:{ fontSize: 18, fontWeight: 700, margin: '0 0 4px', color: GREEN },
  meta:        { color: '#666', fontSize: 14, marginBottom: 16 },
  dimBox:      { background: LGREEN, borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 14 },
  dimLabel:    { fontWeight: 600, color: GREEN, marginRight: 8 },
  tableWrap:   { overflowX: 'auto' },
  table:       { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:          { background: GREEN, color: '#fff', padding: '9px 10px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' },
  td:          { padding: '8px 10px', borderBottom: '1px solid #eee', verticalAlign: 'top' },
  trEven:      { background: '#f9fdf7' },
  badge:       { display: 'inline-block', background: '#e8f3e3', color: GREEN, borderRadius: 20, padding: '2px 10px', fontSize: 13, fontWeight: 600 },
  jointBox:    { background: '#f5f5f5', borderRadius: 6, padding: '8px 12px', fontSize: 12, marginTop: 4 },
  jointTitle:  { fontWeight: 700, color: GREEN, textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.5, marginBottom: 4 },
  dimRow:      { display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 2 },
  dimVal:      { color: '#333' },
  dimKey:      { color: '#888', marginRight: 2 },
  gcodeBar:    { display: 'flex', justifyContent: 'flex-end', marginBottom: 12 },
  toggle:      { background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 700, color: GREEN, fontFamily: 'inherit' },
  toggleArrow: { display: 'inline-block', width: 14, textAlign: 'center', fontSize: 14, color: GREEN },
}

function JointDetail({ joint }) {
  const d = joint.dimensions
  const isMortise = joint.type === 'mortise'

  return (
    <div style={styles.jointBox}>
      <div style={styles.jointTitle}>{joint.type} — {joint.position?.face}</div>
      <div style={styles.dimRow}>
        {isMortise ? (
          <>
            <span style={styles.dimVal}><span style={styles.dimKey}>W</span>{d.width?.toFixed(4)}"</span>
            <span style={styles.dimVal}><span style={styles.dimKey}>L</span>{d.length?.toFixed(4)}"</span>
            <span style={styles.dimVal}><span style={styles.dimKey}>D</span>{d.depth?.toFixed(4)}"</span>
          </>
        ) : (
          <>
            <span style={styles.dimVal}><span style={styles.dimKey}>T</span>{d.thickness?.toFixed(4)}"</span>
            <span style={styles.dimVal}><span style={styles.dimKey}>L</span>{d.length?.toFixed(4)}"</span>
            <span style={styles.dimVal}><span style={styles.dimKey}>W</span>{d.width?.toFixed(4)}"</span>
          </>
        )}
        {joint.fitClearance != null && (
          <span style={styles.dimVal}><span style={styles.dimKey}>clearance</span>{joint.fitClearance?.toFixed(4)}"</span>
        )}
        {isMortise && joint.dogBones?.length > 0 && (
          <span style={styles.dimVal}><span style={styles.dimKey}>dog bones</span>{joint.dogBones.length}</span>
        )}
      </div>
    </div>
  )
}

// Find the mortise + tenon pair to visualize for a given part. Mortises live on
// legs and carry the rail's name as `label`; tenons live on rails. To draw both
// halves of a joint we walk all parts to pull the counterpart.
function viewerPropsFor(part, allParts) {
  const first = part.joints?.[0]
  if (!first) return null

  let mortiseDims, tenonDims, legPart, railPart
  if (first.type === 'mortise') {
    mortiseDims = first.dimensions
    legPart  = part
    railPart = allParts.find(p => p.partName === first.label && p.joints?.some(j => j.type === 'tenon'))
    tenonDims = railPart?.joints?.find(j => j.type === 'tenon')?.dimensions
  } else if (first.type === 'tenon') {
    tenonDims = first.dimensions
    railPart = part
    legPart  = allParts.find(p => p.joints?.some(j => j.type === 'mortise' && j.label === part.partName))
    mortiseDims = legPart?.joints?.find(j => j.type === 'mortise' && j.label === part.partName)?.dimensions
  } else {
    return null
  }

  if (!mortiseDims || !tenonDims) return null
  return {
    mortise:       mortiseDims,
    tenon:         tenonDims,
    legThickness:  legPart?.stock?.actual?.thickness  ?? 3.5,
    railWidth:     railPart?.stock?.actual?.width     ?? 3.0,
  }
}

function downloadGcode(gcode, filename = 'cut-plan.nc') {
  const blob = new Blob([gcode], { type: 'text/plain' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [mode,        setMode       ] = useState('text')
  const [prompt,      setPrompt     ] = useState('')
  const [imageFile,   setImageFile  ] = useState(null)
  const [imagePreview,setImagePreview] = useState(null)
  const [imageBase64, setImageBase64] = useState(null)
  const [imageMime,   setImageMime  ] = useState(null)
  const [units,       setUnits      ] = useState('inches')
  const [result,      setResult     ] = useState(null)
  const [loading,     setLoading    ] = useState(false)
  const [error,       setError      ] = useState(null)
  const [dragOver,    setDragOver   ] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const fileInputRef = useRef()

  const loadImage = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return
    setImageFile(file)
    setImageMime(file.type)
    const reader = new FileReader()
    reader.onload = (e) => {
      setImagePreview(e.target.result)
      setImageBase64(e.target.result.split(',')[1])
    }
    reader.readAsDataURL(file)
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    loadImage(e.dataTransfer.files[0])
  }, [loadImage])

  const handleSubmit = async () => {
    if (mode === 'text' && !prompt.trim()) { setError('Please enter a project description.'); return }
    if (mode === 'image' && !imageBase64)  { setError('Please upload an image.'); return }
    setLoading(true); setError(null); setResult(null)
    try {
      const body = {
        units,
        ...(mode === 'text'
          ? { prompt: prompt.trim() }
          : { image: { data: imageBase64, mediaType: imageMime } })
      }
      const res  = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      if (!data.furnitureType || !Array.isArray(data.parts)) throw new Error('Invalid response from server')
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const dim = result?.overallDimensions

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.title}>CNC Cut List Generator</h1>
        <p style={styles.subtitle}>Describe your project or upload a photo — Claude identifies the parts and dimensions</p>
      </div>

      <div style={styles.card}>
        <div style={styles.tabBar}>
          <button style={styles.tab(mode === 'text')}  onClick={() => setMode('text')}>Text Description</button>
          <button style={styles.tab(mode === 'image')} onClick={() => setMode('image')}>Image Upload</button>
        </div>

        {mode === 'text' ? (
          <textarea
            style={styles.textarea}
            placeholder="Describe your project, e.g. 'A bookshelf 72 inches tall, 36 wide, 12 deep with 5 shelves'"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
          />
        ) : (
          <div>
            <div
              style={styles.dropzone(dragOver)}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current.click()}
            >
              <div style={{ fontSize: 36, marginBottom: 8 }}>📐</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{imageFile ? imageFile.name : 'Drop an image here or click to browse'}</div>
              <div style={{ fontSize: 13 }}>PNG, JPG, WEBP supported</div>
              <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => loadImage(e.target.files[0])} />
            </div>
            {imagePreview && <img src={imagePreview} alt="Preview" style={styles.preview} />}
          </div>
        )}

        <div style={{ ...styles.row, marginTop: 20 }}>
          <div style={styles.field}>
            <label style={styles.label}>Units</label>
            <select style={styles.select} value={units} onChange={e => setUnits(e.target.value)}>
              {UNITS_OPTIONS.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <button
          style={{ ...styles.button, ...(loading ? styles.buttonDisabled : {}) }}
          onClick={handleSubmit}
          disabled={loading}
        >
          {loading ? 'Analyzing...' : 'Identify Parts'}
        </button>
      </div>

      {result && (
        <div style={styles.card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <h2 style={{ ...styles.sectionTitle, margin: 0 }}>{result.furnitureType}</h2>
            <span style={styles.badge}>{result.parts.length} parts</span>
          </div>
          <p style={styles.meta}>{result.description || ''}</p>

          {dim && (
            <div style={styles.dimBox}>
              <span style={styles.dimLabel}>Overall dimensions:</span>
              {dim.width  && <span>{dim.width} W </span>}
              {dim.height && <span>× {dim.height} H </span>}
              {dim.depth  && <span>× {dim.depth} D </span>}
              <span style={{ color: '#666' }}>{dim.unit || units}</span>
            </div>
          )}

          {result.gcode && (
            <div style={styles.gcodeBar}>
              <button style={styles.buttonSm} onClick={() => downloadGcode(result.gcode, `${result.furnitureType || 'cutplan'}.nc`)}>
                Download G-code (.nc)
              </button>
            </div>
          )}

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Part Name', 'Qty', 'Stock', `Cut L (${units})`, `Cut W (${units})`, `Cut T (${units})`, 'Joinery'].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.parts.map((p, i) => {
                  const cd = p.cutDimensions || {}
                  const viewerProps = viewerPropsFor(p, result.parts)
                  return (
                    <tr key={i} style={i % 2 === 1 ? styles.trEven : {}}>
                      <td style={styles.td}><strong>{p.partName || p.name}</strong></td>
                      <td style={styles.td}>{p.qty ?? '—'}</td>
                      <td style={styles.td}>
                        {p.stock ? (
                          <>
                            <div style={{ fontWeight: 600 }}>{p.stock.nominal}</div>
                            <div style={{ color: '#666', fontSize: 12 }}>{p.stock.actual?.thickness}" × {p.stock.actual?.width}"</div>
                          </>
                        ) : '—'}
                      </td>
                      <td style={styles.td}>{cd.length?.toFixed(4) ?? (p.length ?? '—')}</td>
                      <td style={styles.td}>{cd.width?.toFixed(4) ?? (p.width ?? '—')}</td>
                      <td style={styles.td}>{cd.thickness?.toFixed(4) ?? (p.thickness ?? '—')}</td>
                      <td style={styles.td}>
                        {p.joints?.length > 0
                          ? p.joints.map((j, ji) => <JointDetail key={ji} joint={j} />)
                          : <span style={{ color: '#999' }}>none</span>}
                        {viewerProps && <JointViewer3D {...viewerProps} />}
                        {(p.notes || []).map((n, ni) => (
                          <div key={`n${ni}`} style={styles.note}>{n}</div>
                        ))}
                        {(p.warnings || []).map((w, wi) => (
                          <div key={`w${wi}`} style={styles.warn}>{w}</div>
                        ))}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result?.parts?.length > 0 && (
        <div style={styles.card}>
          <button
            style={styles.toggle}
            onClick={() => setShowPreview(s => !s)}
            aria-expanded={showPreview}
          >
            <span style={styles.toggleArrow}>{showPreview ? '▾' : '▸'}</span>
            <span>3D preview</span>
          </button>
          {showPreview && (
            <div style={{ marginTop: 16 }}>
              <TableViewer3D parts={result.parts} overallDimensions={result.overallDimensions} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
