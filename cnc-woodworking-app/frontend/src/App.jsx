import { useState, useRef, useCallback } from 'react'

const API_URL = import.meta.env.VITE_API_URL || '/api/generate'
const UNITS_OPTIONS = ['inches', 'millimeters']

const styles = {
  container: { maxWidth: 860, margin: '0 auto', padding: '24px 16px', fontFamily: "'Segoe UI', system-ui, sans-serif", color: '#1a1a1a' },
  header: { textAlign: 'center', marginBottom: 32 },
  title: { fontSize: 28, fontWeight: 700, margin: '0 0 8px', color: '#2d4a22' },
  subtitle: { color: '#666', fontSize: 15, margin: 0 },
  card: { background: '#fff', border: '1px solid #e0e0e0', borderRadius: 12, padding: 24, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tabBar: { display: 'flex', gap: 8, marginBottom: 20 },
  tab: (active) => ({
    flex: 1, padding: '10px 16px', border: `2px solid ${active ? '#2d4a22' : '#d0d0d0'}`,
    borderRadius: 8, background: active ? '#2d4a22' : '#fff', color: active ? '#fff' : '#555',
    cursor: 'pointer', fontWeight: 600, fontSize: 14, transition: 'all 0.15s'
  }),
  textarea: { width: '100%', minHeight: 120, padding: 12, border: '1px solid #d0d0d0', borderRadius: 8, fontSize: 14, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' },
  dropzone: (over) => ({
    border: `2px dashed ${over ? '#2d4a22' : '#b0b0b0'}`, borderRadius: 10, padding: 40,
    textAlign: 'center', cursor: 'pointer', background: over ? '#f0f7ec' : '#fafafa',
    transition: 'all 0.15s', color: '#666'
  }),
  preview: { maxWidth: '100%', maxHeight: 240, borderRadius: 8, margin: '12px auto 0', display: 'block' },
  row: { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' },
  field: { flex: 1, minWidth: 140 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4, color: '#444' },
  select: { width: '100%', padding: '8px 10px', border: '1px solid #d0d0d0', borderRadius: 6, fontSize: 14, background: '#fff', outline: 'none' },
  button: { display: 'block', width: '100%', padding: '13px', background: '#2d4a22', color: '#fff', border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.3 },
  buttonDisabled: { background: '#8aab7a', cursor: 'not-allowed' },
  error: { background: '#fff3f3', border: '1px solid #f5c0c0', borderRadius: 8, padding: '12px 16px', color: '#c00', fontSize: 14, marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: 700, margin: '0 0 4px', color: '#2d4a22' },
  meta: { color: '#666', fontSize: 14, marginBottom: 16 },
  dimBox: { background: '#f4f9f1', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 14 },
  dimLabel: { fontWeight: 600, color: '#2d4a22', marginRight: 8 },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { background: '#2d4a22', color: '#fff', padding: '10px 12px', textAlign: 'left', fontWeight: 600 },
  td: { padding: '9px 12px', borderBottom: '1px solid #eee' },
  trEven: { background: '#f9fdf7' },
  badge: { display: 'inline-block', background: '#e8f3e3', color: '#2d4a22', borderRadius: 20, padding: '2px 10px', fontSize: 13, fontWeight: 600 },
}

export default function App() {
  const [mode, setMode] = useState('text')
  const [prompt, setPrompt] = useState('')
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [imageBase64, setImageBase64] = useState(null)
  const [imageMime, setImageMime] = useState(null)
  const [units, setUnits] = useState('inches')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
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
    if (mode === 'image' && !imageBase64) { setError('Please upload an image.'); return }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const body = {
        units,
        ...(mode === 'text' ? { prompt: prompt.trim() } : { image: { data: imageBase64, mediaType: imageMime } })
      }
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
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
          <button style={styles.tab(mode === 'text')} onClick={() => setMode('text')}>Text Description</button>
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
              {dim.width && <span>{dim.width} W </span>}
              {dim.height && <span>× {dim.height} H </span>}
              {dim.depth && <span>× {dim.depth} D </span>}
              <span style={{ color: '#666' }}>{dim.unit || units}</span>
            </div>
          )}

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Part Name', `Length (${units})`, `Width (${units})`, `Thickness (${units})`, 'Notes'].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.parts.map((p, i) => (
                  <tr key={i} style={i % 2 === 1 ? styles.trEven : {}}>
                    <td style={styles.td}><strong>{p.name}</strong></td>
                    <td style={styles.td}>{p.length ?? '—'}</td>
                    <td style={styles.td}>{p.width ?? '—'}</td>
                    <td style={styles.td}>{p.thickness ?? '—'}</td>
                    <td style={styles.td}>{p.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
