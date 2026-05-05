'use client'

import { useState, useRef } from 'react'
import Link from 'next/link'

type ExtractedSupplier = {
  name: string | null
  cuit: string | null
}

type ExtractedInvoice = {
  number: string | null
  date: string | null
  type: string | null
  total_amount: number | null
}

type ExtractedItem = {
  supplier_code: string | null
  description: string | null
  quantity: number | null
  unit_cost: number | null
  subtotal: number | null
}

type ExtractionResult = {
  supplier: ExtractedSupplier
  invoice: ExtractedInvoice
  items: ExtractedItem[]
}

export default function IngresosPage() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ExtractionResult | null>(null)
  const [usage, setUsage] = useState<{ input_tokens: number; output_tokens: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    setError(null)
    setResult(null)
    setUsage(null)
    if (!f) {
      setFile(null)
      setPreview(null)
      return
    }
    setFile(f)
    if (f.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = ev => setPreview(ev.target?.result as string)
      reader.readAsDataURL(f)
    } else {
      setPreview(null)
    }
  }

  const handleProcess = async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    setResult(null)
    setUsage(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/purchases/ocr-invoice', {
        method: 'POST',
        body: formData,
      })
      const json = await res.json()

      if (!json.ok) {
        setError(json.error ?? 'Error desconocido')
        return
      }

      setResult(json.extracted)
      setUsage(json.usage)
    } catch (err: any) {
      setError(err?.message ?? 'Error de red')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setFile(null)
    setPreview(null)
    setResult(null)
    setError(null)
    setUsage(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const formatARS = (n: number | null) => {
    if (n == null) return '—'
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n)
  }

  // Cálculo aproximado del costo en USD
  const estimatedCost = usage
    ? (usage.input_tokens / 1_000_000) * 3 + (usage.output_tokens / 1_000_000) * 15
    : 0

  return (
    <div className="page">
      <div className="header">
        <div>
          <Link href="/stock" className="back-link">← Volver a Stock</Link>
          <h1>📦 Cargar factura de compra</h1>
          <p className="subtitle">Subí una factura y la IA va a extraer los datos automáticamente</p>
        </div>
      </div>

      {!result && (
        <div className="upload-section">
          <div className="upload-card">
            <div className="upload-zone">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/jpg,image/png,image/webp"
                onChange={handleFileChange}
                className="file-input"
                id="file-input"
                disabled={loading}
              />
              {!file ? (
                <label htmlFor="file-input" className="upload-label">
                  <div className="upload-icon">📄</div>
                  <div className="upload-text">
                    <strong>Click para subir factura</strong>
                    <span>PDF, JPG o PNG (máx. 10 MB)</span>
                  </div>
                </label>
              ) : (
                <div className="file-preview">
                  {preview ? (
                    <img src={preview} alt="Preview" className="preview-img" />
                  ) : (
                    <div className="pdf-icon">📄</div>
                  )}
                  <div className="file-info">
                    <strong>{file.name}</strong>
                    <span>{(file.size / 1024).toFixed(1)} KB · {file.type}</span>
                  </div>
                  <button className="btn-change" onClick={handleReset} disabled={loading}>
                    Cambiar
                  </button>
                </div>
              )}
            </div>

            {file && (
              <button className="btn-process" onClick={handleProcess} disabled={loading}>
                {loading ? '⏳ Procesando con IA...' : '✨ Extraer datos con IA'}
              </button>
            )}

            {loading && (
              <div className="loading-msg">
                Esto puede tardar entre 10 y 30 segundos según el tamaño de la factura...
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="error-banner">
          <strong>⚠️ Error:</strong> {error}
          <button className="btn-retry" onClick={handleReset}>Volver a intentar</button>
        </div>
      )}

      {result && (
        <div className="result-section">
          <div className="result-header">
            <h2>✅ Datos extraídos</h2>
            <div className="result-actions">
              <button className="btn-secondary" onClick={handleReset}>
                ↺ Cargar otra factura
              </button>
            </div>
          </div>

          {usage && (
            <div className="cost-banner">
              📊 Tokens usados: {usage.input_tokens.toLocaleString('es-AR')} input + {usage.output_tokens.toLocaleString('es-AR')} output
              · Costo estimado: USD {estimatedCost.toFixed(4)}
            </div>
          )}

          {/* Datos del proveedor */}
          <div className="data-block">
            <h3>Proveedor</h3>
            <div className="data-grid">
              <div className="data-item">
                <span className="data-label">Nombre</span>
                <span className="data-value">{result.supplier?.name ?? '—'}</span>
              </div>
              <div className="data-item">
                <span className="data-label">CUIT</span>
                <span className="data-value">{result.supplier?.cuit ?? '—'}</span>
              </div>
            </div>
          </div>

          {/* Datos de la factura */}
          <div className="data-block">
            <h3>Factura</h3>
            <div className="data-grid">
              <div className="data-item">
                <span className="data-label">Número</span>
                <span className="data-value">{result.invoice?.number ?? '—'}</span>
              </div>
              <div className="data-item">
                <span className="data-label">Fecha</span>
                <span className="data-value">{result.invoice?.date ?? '—'}</span>
              </div>
              <div className="data-item">
                <span className="data-label">Tipo</span>
                <span className="data-value">{result.invoice?.type ?? '—'}</span>
              </div>
              <div className="data-item">
                <span className="data-label">Total</span>
                <span className="data-value">{formatARS(result.invoice?.total_amount ?? null)}</span>
              </div>
            </div>
          </div>

          {/* Items */}
          <div className="data-block">
            <h3>Productos ({result.items?.length ?? 0})</h3>
            {!result.items || result.items.length === 0 ? (
              <p className="empty-msg">No se detectaron productos en la factura.</p>
            ) : (
              <div className="items-table-wrap">
                <table className="items-table">
                  <thead>
                    <tr>
                      <th>Cód. proveedor</th>
                      <th>Descripción</th>
                      <th className="num">Cant.</th>
                      <th className="num">Costo unit.</th>
                      <th className="num">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.items.map((item, idx) => (
                      <tr key={idx}>
                        <td>{item.supplier_code ?? '—'}</td>
                        <td>{item.description ?? '—'}</td>
                        <td className="num">{item.quantity ?? '—'}</td>
                        <td className="num">{formatARS(item.unit_cost)}</td>
                        <td className="num">{formatARS(item.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="next-step-banner">
            🚧 <strong>Próximamente:</strong> en este punto vas a poder matchear cada producto con tus SKUs, ajustar las cantidades y costos, y confirmar el ingreso para que se actualice el stock.
          </div>
        </div>
      )}

      <style jsx>{`
        .page {
          padding: 24px 40px 48px;
          max-width: 1200px;
          margin: 0 auto;
        }
        .header {
          margin-bottom: 24px;
        }
        .back-link {
          display: inline-block;
          color: var(--text-muted);
          text-decoration: none;
          font-size: 13px;
          margin-bottom: 8px;
          transition: color 0.15s ease;
        }
        .back-link:hover { color: var(--accent); }
        .header h1 {
          margin: 0 0 4px;
          font-size: 24px;
          font-weight: 700;
          color: var(--text-primary);
        }
        .subtitle {
          margin: 0;
          font-size: 13px;
          color: var(--text-muted);
        }

        .upload-section { display: flex; justify-content: center; padding: 24px 0; }
        .upload-card {
          width: 100%;
          max-width: 600px;
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 14px;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .upload-zone {
          background: var(--bg-elevated);
          border: 2px dashed var(--border-medium);
          border-radius: 12px;
          padding: 32px;
          text-align: center;
          transition: all 0.15s ease;
        }
        .file-input { display: none; }
        .upload-label {
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .upload-icon { font-size: 48px; }
        .upload-text {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .upload-text strong { font-size: 16px; color: var(--text-primary); }
        .upload-text span { font-size: 12px; color: var(--text-muted); }

        .file-preview {
          display: flex;
          align-items: center;
          gap: 16px;
          text-align: left;
        }
        .preview-img {
          max-width: 80px;
          max-height: 80px;
          border-radius: 8px;
          border: 1px solid var(--border-subtle);
        }
        .pdf-icon { font-size: 48px; }
        .file-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
          min-width: 0;
        }
        .file-info strong { font-size: 14px; color: var(--text-primary); word-break: break-all; }
        .file-info span { font-size: 11px; color: var(--text-muted); }
        .btn-change {
          background: transparent;
          color: var(--text-muted);
          border: 1px solid var(--border-subtle);
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
          font-family: inherit;
          flex-shrink: 0;
        }
        .btn-change:hover:not(:disabled) {
          color: var(--text-primary);
          border-color: var(--border-medium);
        }

        .btn-process {
          background: linear-gradient(135deg, var(--accent-deep) 0%, var(--accent-secondary) 50%, var(--accent) 100%);
          color: var(--bg-base);
          border: none;
          padding: 12px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          font-family: inherit;
          box-shadow: 0 4px 14px rgba(62, 229, 224, 0.25);
        }
        .btn-process:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(62, 229, 224, 0.4);
        }
        .btn-process:disabled { opacity: 0.6; cursor: not-allowed; }

        .loading-msg {
          font-size: 12px;
          color: var(--text-muted);
          text-align: center;
          font-style: italic;
        }

        .error-banner {
          background: rgba(255, 71, 87, 0.1);
          border: 1px solid rgba(255, 71, 87, 0.3);
          border-radius: 10px;
          padding: 14px 18px;
          color: var(--danger);
          font-size: 13px;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
        }
        .error-banner strong { font-weight: 600; }
        .btn-retry {
          margin-left: auto;
          background: transparent;
          color: var(--danger);
          border: 1px solid rgba(255, 71, 87, 0.4);
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
          font-family: inherit;
        }

        .result-section { display: flex; flex-direction: column; gap: 18px; }
        .result-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
        }
        .result-header h2 {
          margin: 0;
          font-size: 20px;
          color: var(--text-primary);
          font-weight: 700;
        }
        .btn-secondary {
          background: transparent;
          color: var(--text-secondary);
          border: 1px solid var(--border-subtle);
          padding: 9px 16px;
          border-radius: 8px;
          font-size: 13px;
          cursor: pointer;
          font-family: inherit;
        }
        .btn-secondary:hover {
          color: var(--text-primary);
          border-color: var(--border-medium);
        }

        .cost-banner {
          background: var(--bg-elevated);
          border: 1px solid var(--border-subtle);
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 12px;
          color: var(--text-muted);
        }

        .data-block {
          background: var(--bg-card);
          border: 1px solid var(--border-subtle);
          border-radius: 12px;
          padding: 18px 20px;
        }
        .data-block h3 {
          margin: 0 0 14px;
          font-size: 13px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 600;
        }
        .data-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 14px;
        }
        .data-item {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .data-label {
          font-size: 11px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.4px;
          font-weight: 600;
        }
        .data-value {
          font-size: 15px;
          color: var(--text-primary);
          font-weight: 500;
        }

        .empty-msg { color: var(--text-muted); font-size: 13px; margin: 0; }

        .items-table-wrap { overflow-x: auto; }
        .items-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }
        .items-table th {
          background: var(--bg-elevated);
          padding: 10px 14px;
          text-align: left;
          font-size: 11px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 600;
          border-bottom: 1px solid var(--border-subtle);
        }
        .items-table td {
          padding: 10px 14px;
          border-bottom: 1px solid var(--border-subtle);
          color: var(--text-secondary);
          vertical-align: top;
        }
        .items-table tr:last-child td { border-bottom: none; }
        .items-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }

        .next-step-banner {
          background: rgba(255, 167, 38, 0.08);
          border: 1px solid rgba(255, 167, 38, 0.25);
          border-radius: 10px;
          padding: 14px 18px;
          font-size: 13px;
          color: var(--text-secondary);
        }
        .next-step-banner strong { color: var(--warning); }

        @media (max-width: 768px) {
          .page { padding: 16px; }
          .header h1 { font-size: 20px; }
          .data-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  )
}