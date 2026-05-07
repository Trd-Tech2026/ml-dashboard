'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import StockTabs from '../../components/StockTabs'

type ExtractedSupplier = { name: string | null; cuit: string | null }
type ExtractedInvoice = { number: string | null; date: string | null; type: string | null; total_amount: number | null }
type ExtractedItem = { supplier_code: string | null; description: string | null; quantity: number | null; unit_cost: number | null; subtotal: number | null }
type ExtractionResult = { supplier: ExtractedSupplier; invoice: ExtractedInvoice; items: ExtractedItem[] }

type Suggestion = {
  seller_sku: string
  title: string
  thumbnail: string | null
  current_stock: number
  is_manual: boolean
  match_type: 'exact' | 'contains' | 'learned'
  match_score: number
}

type MatchedItem = {
  index: number
  supplier_code: string | null
  description: string | null
  quantity: number | null
  unit_cost: number | null
  subtotal: number | null
  suggestions: Suggestion[]
  best_match: Suggestion | null
}

type Step = 'upload' | 'matching' | 'confirm' | 'success'

type EditedItem = {
  index: number
  supplier_code: string | null
  description: string | null
  quantity: number
  unit_cost: number | null
  selected_sku: string | null
  selected_title: string | null
  selected_is_manual: boolean
  selected_current_stock: number
  match_type: 'exact' | 'contains' | 'learned' | 'manual' | null
  suggestions: Suggestion[]
}

type ConfirmResult = {
  ok: boolean
  purchase_order_id?: number
  total_items?: number
  succeeded?: number
  failed?: number
  results?: Array<{ sku: string; before: number; after: number; success: boolean; error?: string }>
}

export default function IngresosPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('upload')

  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [extracted, setExtracted] = useState<ExtractionResult | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)
  const [usage, setUsage] = useState<{ input_tokens: number; output_tokens: number } | null>(null)
  const [matchedItems, setMatchedItems] = useState<EditedItem[]>([])

  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(null)
  const [confirming, setConfirming] = useState(false)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    setError(null)
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

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/purchases/ocr-invoice', { method: 'POST', body: formData })
      const json = await res.json()

      if (!json.ok) {
        setError(json.error ?? 'Error al procesar la factura')
        setLoading(false)
        return
      }

      setExtracted(json.extracted)
      setFilePath(json.file_path)
      setUsage(json.usage)

      const matchRes = await fetch('/api/purchases/match-skus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: json.extracted.items ?? [],
          supplier_cuit: json.extracted.supplier?.cuit ?? null,
        }),
      })
      const matchJson = await matchRes.json()

      if (!matchJson.ok) {
        setError(matchJson.error ?? 'Error en matching de SKUs')
        setLoading(false)
        return
      }

      const matched: MatchedItem[] = matchJson.matched ?? []
      const edited: EditedItem[] = matched.map(m => ({
        index: m.index,
        supplier_code: m.supplier_code,
        description: m.description,
        quantity: m.quantity ?? 0,
        unit_cost: m.unit_cost,
        selected_sku: m.best_match?.seller_sku ?? null,
        selected_title: m.best_match?.title ?? null,
        selected_is_manual: m.best_match?.is_manual ?? false,
        selected_current_stock: m.best_match?.current_stock ?? 0,
        match_type: m.best_match?.match_type ?? null,
        suggestions: m.suggestions,
      }))

      setMatchedItems(edited)
      setStep('matching')
    } catch (err: any) {
      setError(err?.message ?? 'Error de red')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async () => {
    if (!extracted) return

    const confirmed = window.confirm(
      `Vas a sumar stock a ${matchedItems.length} producto(s).\n\nEsta accion no se puede deshacer automaticamente. Continuar?`
    )
    if (!confirmed) return

    setConfirming(true)
    setError(null)

    try {
      const body = {
        supplier: extracted.supplier,
        invoice: extracted.invoice,
        items: matchedItems.map(item => ({
          supplier_code: item.supplier_code,
          description: item.description,
          quantity: item.quantity,
          unit_cost: item.unit_cost,
          seller_sku: item.selected_sku!,
          is_manual: item.selected_is_manual,
        })),
        file_path: filePath,
        ai_extracted_data: extracted,
      }

      const res = await fetch('/api/purchases/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json: ConfirmResult = await res.json()

      if (!json.ok) {
        setError((json as any).error ?? 'Error al confirmar')
        setConfirming(false)
        return
      }

      setConfirmResult(json)
      setStep('success')
    } catch (err: any) {
      setError(err?.message ?? 'Error de red')
    } finally {
      setConfirming(false)
    }
  }

  const handleReset = () => {
    setFile(null)
    setPreview(null)
    setExtracted(null)
    setFilePath(null)
    setUsage(null)
    setMatchedItems([])
    setError(null)
    setConfirmResult(null)
    setStep('upload')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const updateItem = (index: number, changes: Partial<EditedItem>) => {
    setMatchedItems(prev => prev.map(item => item.index === index ? { ...item, ...changes } : item))
  }

  const formatARS = (n: number | null) => {
    if (n == null) return '—'
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n)
  }

  return (
    <div className="page">
      <StockTabs />

      {step === 'upload' && (
        <>
          <div className="header">
            <h1>📦 Cargar factura de compra</h1>
            <p className="subtitle">Subí una factura y la IA va a extraer los datos automáticamente</p>
          </div>

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
                    {preview ? <img src={preview} alt="Preview" className="preview-img" /> : <div className="pdf-icon">📄</div>}
                    <div className="file-info">
                      <strong>{file.name}</strong>
                      <span>{(file.size / 1024).toFixed(1)} KB · {file.type}</span>
                    </div>
                    <button className="btn-change" onClick={handleReset} disabled={loading}>Cambiar</button>
                  </div>
                )}
              </div>

              {file && (
                <button className="btn-process" onClick={handleProcess} disabled={loading}>
                  {loading ? '⏳ Procesando con IA y buscando SKUs...' : '✨ Extraer datos con IA'}
                </button>
              )}

              {loading && <div className="loading-msg">Esto puede tardar entre 10 y 30 segundos...</div>}
            </div>
          </div>
        </>
      )}

      {step === 'matching' && extracted && (
        <>
          <div className="header">
            <button className="back-link" onClick={handleReset}>← Cargar otra factura</button>
            <h1>🔗 Matchear productos con tus SKUs</h1>
            <p className="subtitle">Revisá cada producto y confirmá el SKU correspondiente</p>
          </div>

          <div className="summary-bar">
            <div>
              <strong>{extracted.supplier?.name ?? 'Proveedor sin nombre'}</strong>
              <span> · Factura {extracted.invoice?.number ?? '—'} · {extracted.invoice?.date ?? '—'}</span>
            </div>
            <div>
              <span className={`status-tag ${matchedItems.filter(i => i.selected_sku).length < matchedItems.length ? 'warning' : 'success'}`}>
                {matchedItems.filter(i => i.selected_sku).length} / {matchedItems.length} matcheados
              </span>
            </div>
          </div>

          <div className="matching-list">
            {matchedItems.map(item => (
              <MatchingRow key={item.index} item={item} onUpdate={(changes) => updateItem(item.index, changes)} />
            ))}
          </div>

          <div className="bottom-actions">
            <button className="btn-secondary" onClick={handleReset}>← Cancelar</button>
            <button
              className="btn-process"
              disabled={matchedItems.filter(i => i.selected_sku).length < matchedItems.length}
              onClick={() => setStep('confirm')}
            >
              {matchedItems.filter(i => i.selected_sku).length === matchedItems.length
                ? `Continuar a confirmación →`
                : `Faltan ${matchedItems.length - matchedItems.filter(i => i.selected_sku).length} por matchear`
              }
            </button>
          </div>
        </>
      )}

      {step === 'confirm' && extracted && (
        <>
          <div className="header">
            <button className="back-link" onClick={() => setStep('matching')}>← Volver a matching</button>
            <h1>✅ Confirmar ingreso de mercadería</h1>
            <p className="subtitle">Revisá el resumen final antes de impactar el stock</p>
          </div>

          <div className="confirm-banner">
            ⚠️ <strong>Importante:</strong> al confirmar se va a sumar el stock en tu dashboard. Esta acción NO se puede deshacer (aunque podés ajustar manualmente después). Por ahora <strong>NO se sincroniza con Mercado Libre</strong>.
          </div>

          <div className="data-block">
            <h3>Proveedor</h3>
            <div className="data-grid">
              <div className="data-item">
                <span className="data-label">Nombre</span>
                <span className="data-value">{extracted.supplier?.name ?? '—'}</span>
              </div>
              <div className="data-item">
                <span className="data-label">CUIT</span>
                <span className="data-value">{extracted.supplier?.cuit ?? '—'}</span>
              </div>
            </div>
          </div>

          <div className="data-block">
            <h3>Factura</h3>
            <div className="data-grid">
              <div className="data-item"><span className="data-label">Número</span><span className="data-value">{extracted.invoice?.number ?? '—'}</span></div>
              <div className="data-item"><span className="data-label">Fecha</span><span className="data-value">{extracted.invoice?.date ?? '—'}</span></div>
              <div className="data-item"><span className="data-label">Tipo</span><span className="data-value">{extracted.invoice?.type ?? '—'}</span></div>
              <div className="data-item"><span className="data-label">Total</span><span className="data-value">{formatARS(extracted.invoice?.total_amount ?? null)}</span></div>
            </div>
          </div>

          <div className="data-block">
            <h3>Cambios al stock ({matchedItems.length} productos)</h3>
            <div className="items-table-wrap">
              <table className="items-table">
                <thead>
                  <tr>
                    <th>SKU destino</th>
                    <th>Producto</th>
                    <th className="num">Stock actual</th>
                    <th className="num">+ Cantidad</th>
                    <th className="num">Stock nuevo</th>
                    <th className="num">Costo unit.</th>
                  </tr>
                </thead>
                <tbody>
                  {matchedItems.map(item => (
                    <tr key={item.index}>
                      <td>
                        <strong>{item.selected_sku}</strong>
                        {item.selected_is_manual && <span className="manual-tag">MANUAL</span>}
                      </td>
                      <td>{item.selected_title}</td>
                      <td className="num">{item.selected_current_stock}</td>
                      <td className="num"><strong className="add-qty">+{item.quantity}</strong></td>
                      <td className="num"><strong className="new-stock">{item.selected_current_stock + item.quantity}</strong></td>
                      <td className="num">{formatARS(item.unit_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="confirm-actions">
            <button className="btn-secondary" onClick={() => setStep('matching')} disabled={confirming}>← Volver a editar</button>
            <button className="btn-confirm-final" onClick={handleConfirm} disabled={confirming}>
              {confirming ? '⏳ Procesando...' : '✅ Confirmar e impactar stock'}
            </button>
          </div>
        </>
      )}

      {step === 'success' && confirmResult && (
        <>
          <div className="header">
            <h1>🎉 Ingreso confirmado</h1>
            <p className="subtitle">El stock fue actualizado correctamente</p>
          </div>

          <div className="success-banner">
            ✅ <strong>Operación exitosa.</strong> Se actualizó el stock de {confirmResult.succeeded} producto{confirmResult.succeeded === 1 ? '' : 's'}.
            {confirmResult.failed && confirmResult.failed > 0 && (
              <> {confirmResult.failed} fallaron — revisalos abajo.</>
            )}
          </div>

          <div className="data-block">
            <h3>Resumen</h3>
            <div className="items-table-wrap">
              <table className="items-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th className="num">Stock anterior</th>
                    <th className="num">Stock nuevo</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {(confirmResult.results ?? []).map((r, idx) => (
                    <tr key={idx}>
                      <td><strong>{r.sku}</strong></td>
                      <td className="num">{r.before}</td>
                      <td className="num"><strong className={r.success ? 'new-stock' : ''}>{r.after}</strong></td>
                      <td>
                        {r.success
                          ? <span className="success-tag">✓ OK</span>
                          : <span className="error-tag" title={r.error}>✗ Error</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="success-actions">
            <button className="btn-secondary" onClick={handleReset}>📦 Cargar otra factura</button>
            <button className="btn-process" onClick={() => router.push('/stock/historial')}>📋 Ver en historial</button>
          </div>
        </>
      )}

      {error && (
        <div className="error-banner">
          <strong>⚠️ Error:</strong> {error}
          <button className="btn-retry" onClick={handleReset}>Volver a intentar</button>
        </div>
      )}

      <style jsx>{`
        .page { padding: 24px 40px 48px; max-width: 1200px; margin: 0 auto; }
        .header { margin-bottom: 24px; }
        .back-link { display: inline-block; color: var(--text-muted); font-size: 13px; margin-bottom: 8px; background: transparent; border: none; cursor: pointer; padding: 0; font-family: inherit; }
        .back-link:hover { color: var(--accent); }
        .header h1 { margin: 0 0 4px; font-size: 24px; font-weight: 700; color: var(--text-primary); }
        .subtitle { margin: 0; font-size: 13px; color: var(--text-muted); }

        .upload-section { display: flex; justify-content: center; padding: 24px 0; }
        .upload-card { width: 100%; max-width: 600px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 14px; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
        .upload-zone { background: var(--bg-elevated); border: 2px dashed var(--border-medium); border-radius: 12px; padding: 32px; text-align: center; }
        .file-input { display: none; }
        .upload-label { cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 12px; }
        .upload-icon { font-size: 48px; }
        .upload-text { display: flex; flex-direction: column; gap: 4px; }
        .upload-text strong { font-size: 16px; color: var(--text-primary); }
        .upload-text span { font-size: 12px; color: var(--text-muted); }
        .file-preview { display: flex; align-items: center; gap: 16px; text-align: left; }
        .preview-img { max-width: 80px; max-height: 80px; border-radius: 8px; border: 1px solid var(--border-subtle); }
        .pdf-icon { font-size: 48px; }
        .file-info { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
        .file-info strong { font-size: 14px; color: var(--text-primary); word-break: break-all; }
        .file-info span { font-size: 11px; color: var(--text-muted); }
        .btn-change { background: transparent; color: var(--text-muted); border: 1px solid var(--border-subtle); padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: inherit; flex-shrink: 0; }
        .btn-process { background: linear-gradient(135deg, var(--accent-deep) 0%, var(--accent-secondary) 50%, var(--accent) 100%); color: var(--bg-base); border: none; padding: 12px 22px; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; box-shadow: 0 4px 14px rgba(62, 229, 224, 0.25); transition: all 0.15s ease; }
        .btn-process:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(62, 229, 224, 0.4); }
        .btn-process:disabled { opacity: 0.5; cursor: not-allowed; }
        .loading-msg { font-size: 12px; color: var(--text-muted); text-align: center; font-style: italic; }

        .error-banner { background: rgba(255, 71, 87, 0.1); border: 1px solid rgba(255, 71, 87, 0.3); border-radius: 10px; padding: 14px 18px; color: var(--danger); font-size: 13px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 16px; }
        .btn-retry { margin-left: auto; background: transparent; color: var(--danger); border: 1px solid rgba(255, 71, 87, 0.4); padding: 6px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; font-family: inherit; }
        .confirm-banner { background: rgba(255, 167, 38, 0.08); border: 1px solid rgba(255, 167, 38, 0.3); border-radius: 10px; padding: 14px 18px; font-size: 13px; color: var(--text-secondary); margin-bottom: 18px; }
        .confirm-banner strong { color: var(--warning); }
        .success-banner { background: rgba(62, 229, 224, 0.08); border: 1px solid var(--border-medium); border-radius: 10px; padding: 16px 20px; font-size: 14px; color: var(--text-secondary); margin-bottom: 18px; }
        .success-banner strong { color: var(--accent); }

        .summary-bar { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 12px 18px; margin-bottom: 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; font-size: 13px; color: var(--text-secondary); }
        .summary-bar strong { color: var(--text-primary); }
        .status-tag { padding: 4px 10px; border-radius: 8px; font-size: 12px; font-weight: 600; }
        .status-tag.success { background: rgba(62, 229, 224, 0.12); color: var(--accent); border: 1px solid var(--border-medium); }
        .status-tag.warning { background: rgba(255, 167, 38, 0.12); color: var(--warning); border: 1px solid rgba(255, 167, 38, 0.3); }

        .matching-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 24px; }

        .bottom-actions { display: flex; justify-content: space-between; gap: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-subtle); }
        .btn-secondary { background: transparent; color: var(--text-secondary); border: 1px solid var(--border-subtle); padding: 11px 20px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
        .btn-secondary:hover:not(:disabled) { color: var(--text-primary); border-color: var(--border-medium); }
        .btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }

        .data-block { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 18px 20px; margin-bottom: 14px; }
        .data-block h3 { margin: 0 0 14px; font-size: 13px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
        .data-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
        .data-item { display: flex; flex-direction: column; gap: 4px; }
        .data-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; font-weight: 600; }
        .data-value { font-size: 15px; color: var(--text-primary); font-weight: 500; }
        .manual-tag { background: rgba(62, 229, 224, 0.15); color: var(--accent); padding: 1px 6px; border-radius: 4px; font-size: 9px; font-weight: 700; letter-spacing: 0.5px; border: 1px solid var(--border-medium); margin-left: 6px; }

        .items-table-wrap { overflow-x: auto; }
        .items-table { width: 100%; border-collapse: collapse; font-size: 13px; }
        .items-table th { background: var(--bg-elevated); padding: 10px 14px; text-align: left; font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; border-bottom: 1px solid var(--border-subtle); }
        .items-table td { padding: 10px 14px; border-bottom: 1px solid var(--border-subtle); color: var(--text-secondary); vertical-align: top; }
        .items-table tr:last-child td { border-bottom: none; }
        .items-table .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .add-qty { color: var(--success); }
        .new-stock { color: var(--accent); font-size: 14px; }
        .success-tag { background: rgba(62, 229, 224, 0.12); color: var(--accent); padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; border: 1px solid var(--border-medium); }
        .error-tag { background: rgba(255, 71, 87, 0.12); color: var(--danger); padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; border: 1px solid rgba(255, 71, 87, 0.3); cursor: help; }

        .confirm-actions, .success-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 24px; flex-wrap: wrap; }
        .btn-confirm-final { background: var(--success); color: var(--bg-base); border: none; padding: 11px 22px; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit; transition: all 0.15s ease; }
        .btn-confirm-final:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(62, 229, 224, 0.3); }
        .btn-confirm-final:disabled { opacity: 0.5; cursor: not-allowed; }

        @media (max-width: 768px) {
          .page { padding: 16px; }
          .header h1 { font-size: 20px; }
          .data-grid { grid-template-columns: 1fr; }
          .bottom-actions, .confirm-actions, .success-actions { flex-direction: column-reverse; }
          .btn-secondary, .btn-process, .btn-confirm-final { width: 100%; }
        }
      `}</style>
    </div>
  )
}

function MatchingRow({ item, onUpdate }: { item: EditedItem; onUpdate: (changes: Partial<EditedItem>) => void }) {
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Suggestion[]>([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!showSearch || searchQuery.trim().length < 2) {
      setSearchResults([])
      return
    }
    const timeout = setTimeout(async () => {
      setSearching(true)
      try {
        const params = new URLSearchParams({ q: searchQuery.trim() })
        const res = await fetch(`/api/combos/search-skus?${params.toString()}`, { cache: 'no-store' })
        const json = await res.json()
        if (json.ok) {
          setSearchResults((json.results ?? []).map((r: any) => ({
            seller_sku: r.sku,
            title: r.title,
            thumbnail: r.thumbnail,
            current_stock: r.minStock,
            is_manual: !!r.is_manual,
            match_type: 'manual' as any,
            match_score: 0,
          })))
        }
      } catch (err) {
        console.error('Error:', err)
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timeout)
  }, [searchQuery, showSearch])

  const handleSelectSuggestion = (s: Suggestion) => {
    onUpdate({
      selected_sku: s.seller_sku,
      selected_title: s.title,
      selected_is_manual: s.is_manual,
      selected_current_stock: s.current_stock,
      match_type: s.match_type as any,
    })
    setShowSearch(false)
    setSearchQuery('')
  }

  const handleClearMatch = () => {
    onUpdate({
      selected_sku: null,
      selected_title: null,
      selected_is_manual: false,
      selected_current_stock: 0,
      match_type: null,
    })
  }

  const matchTypeLabel = () => {
    switch (item.match_type) {
      case 'exact': return 'Coincidencia exacta'
      case 'learned': return 'Aprendido de antes'
      case 'contains': return 'Coincidencia parcial'
      case 'manual': return 'Selección manual'
      default: return ''
    }
  }

  const matchTypeColor = () => {
    switch (item.match_type) {
      case 'exact':
      case 'learned': return 'success'
      case 'contains': return 'info'
      case 'manual': return 'warning'
      default: return 'danger'
    }
  }

  return (
    <div className={`match-row ${!item.selected_sku ? 'unmatched' : ''}`}>
      <div className="invoice-side">
        <div className="invoice-label">Factura dice:</div>
        <div className="invoice-code">{item.supplier_code ?? '(sin código)'}</div>
        <div className="invoice-desc">{item.description ?? '—'}</div>
        <div className="invoice-meta">
          <span><strong>{item.quantity}</strong> unid.</span>
          <span>·</span>
          <span>{item.unit_cost != null ? new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(item.unit_cost) : '—'}</span>
        </div>
      </div>

      <div className="arrow-divider">→</div>

      <div className="match-side">
        {item.selected_sku ? (
          <>
            <div className={`match-status status-${matchTypeColor()}`}>
              {item.match_type === 'exact' || item.match_type === 'learned' ? '✅' : item.match_type === 'contains' ? '🔍' : '✋'} {matchTypeLabel()}
            </div>
            <div className="match-product">
              <strong>{item.selected_sku}</strong>
              {item.selected_is_manual && <span className="manual-tag-inline">MANUAL</span>}
            </div>
            <div className="match-title">{item.selected_title}</div>
            <div className="match-stock">Stock actual: <strong>{item.selected_current_stock}</strong></div>

            <div className="match-actions">
              <button className="btn-mini" onClick={() => setShowSearch(!showSearch)}>
                {showSearch ? 'Cancelar' : 'Cambiar SKU'}
              </button>
              {item.suggestions.length > 1 && (
                <div className="other-suggestions">
                  <span className="muted">Otras sugerencias:</span>
                  {item.suggestions.filter(s => s.seller_sku !== item.selected_sku).slice(0, 3).map(s => (
                    <button key={s.seller_sku} className="btn-suggestion" onClick={() => handleSelectSuggestion(s)} title={s.title}>
                      {s.seller_sku}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="match-status status-danger">⚠️ Sin match automático</div>
            <p className="no-match-text">No encontramos un SKU que coincida. Buscalo manualmente:</p>
            <button className="btn-mini" onClick={() => setShowSearch(true)}>🔍 Buscar SKU manualmente</button>
          </>
        )}

        {showSearch && (
          <div className="search-box">
            <input
              type="text"
              placeholder="Buscar por SKU o título..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input-small"
              autoFocus
            />
            {searchQuery.trim().length < 2 ? (
              <div className="search-hint">Escribí al menos 2 caracteres...</div>
            ) : searching ? (
              <div className="search-hint">Buscando...</div>
            ) : searchResults.length === 0 ? (
              <div className="search-hint">Sin resultados</div>
            ) : (
              <div className="search-results">
                {searchResults.map(r => (
                  <button key={r.seller_sku} className="search-result" onClick={() => handleSelectSuggestion(r)}>
                    {r.thumbnail ? <img src={r.thumbnail.replace('http://', 'https://')} alt="" className="result-thumb" /> : <div className="result-thumb-ph">{r.is_manual ? '📋' : '📦'}</div>}
                    <div className="result-info">
                      <div className="result-title">{r.title}</div>
                      <div className="result-meta">{r.seller_sku} · Stock: {r.current_stock}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {item.selected_sku && (
          <button className="btn-clear-match" onClick={handleClearMatch} title="Quitar match">✕</button>
        )}
      </div>

      <style jsx>{`
        .match-row { display: grid; grid-template-columns: 1fr auto 1fr; gap: 16px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 16px; align-items: stretch; }
        .match-row.unmatched { border-color: rgba(255, 71, 87, 0.3); background: rgba(255, 71, 87, 0.04); }
        .invoice-side, .match-side { display: flex; flex-direction: column; gap: 4px; min-width: 0; position: relative; }
        .invoice-label { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
        .invoice-code { font-family: monospace; color: var(--text-primary); font-size: 14px; font-weight: 600; }
        .invoice-desc { font-size: 12px; color: var(--text-secondary); line-height: 1.4; }
        .invoice-meta { font-size: 12px; color: var(--text-muted); display: flex; gap: 6px; align-items: center; margin-top: 4px; }
        .invoice-meta strong { color: var(--text-primary); }
        .arrow-divider { display: flex; align-items: center; color: var(--text-muted); font-size: 18px; padding: 0 8px; }

        .match-status { font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 6px; align-self: flex-start; margin-bottom: 4px; }
        .status-success { background: rgba(62, 229, 224, 0.15); color: var(--accent); border: 1px solid var(--border-medium); }
        .status-info { background: rgba(28, 160, 196, 0.15); color: var(--accent-secondary); border: 1px solid rgba(28, 160, 196, 0.3); }
        .status-warning { background: rgba(255, 167, 38, 0.15); color: var(--warning); border: 1px solid rgba(255, 167, 38, 0.3); }
        .status-danger { background: rgba(255, 71, 87, 0.15); color: var(--danger); border: 1px solid rgba(255, 71, 87, 0.3); }

        .match-product { font-family: monospace; font-size: 14px; color: var(--text-primary); font-weight: 600; display: flex; align-items: center; gap: 6px; }
        .manual-tag-inline { background: rgba(62, 229, 224, 0.15); color: var(--accent); padding: 1px 6px; border-radius: 4px; font-size: 9px; font-weight: 700; letter-spacing: 0.5px; border: 1px solid var(--border-medium); font-family: inherit; }
        .match-title { font-size: 12px; color: var(--text-secondary); line-height: 1.3; }
        .match-stock { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
        .match-stock strong { color: var(--text-primary); }
        .no-match-text { font-size: 12px; color: var(--text-muted); margin: 4px 0 8px; }

        .match-actions { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
        .other-suggestions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px; }
        .muted { font-size: 10px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.4px; }
        .btn-mini { background: var(--bg-elevated); color: var(--text-secondary); border: 1px solid var(--border-subtle); padding: 5px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; font-family: inherit; align-self: flex-start; }
        .btn-mini:hover { border-color: var(--border-medium); color: var(--text-primary); }
        .btn-suggestion { background: var(--bg-elevated); border: 1px solid var(--border-subtle); color: var(--text-secondary); padding: 3px 8px; border-radius: 5px; font-size: 10px; cursor: pointer; font-family: monospace; }
        .btn-suggestion:hover { color: var(--accent); border-color: var(--accent); }
        .btn-clear-match { position: absolute; top: 0; right: 0; background: transparent; border: 1px solid var(--border-subtle); color: var(--text-muted); width: 24px; height: 24px; border-radius: 6px; cursor: pointer; font-size: 11px; }
        .btn-clear-match:hover { color: var(--danger); border-color: rgba(255, 71, 87, 0.4); }

        .search-box { margin-top: 8px; background: var(--bg-elevated); border: 1px solid var(--border-medium); border-radius: 8px; padding: 10px; }
        .search-input-small { width: 100%; padding: 8px 10px; background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: 6px; color: var(--text-primary); font-family: inherit; outline: none; font-size: 12px; }
        .search-input-small:focus { border-color: var(--accent); }
        .search-hint { padding: 8px; text-align: center; color: var(--text-muted); font-size: 11px; }
        .search-results { display: flex; flex-direction: column; gap: 4px; max-height: 240px; overflow-y: auto; margin-top: 6px; }
        .search-result { display: flex; gap: 8px; align-items: center; padding: 6px 8px; background: var(--bg-base); border: 1px solid var(--border-subtle); border-radius: 6px; cursor: pointer; text-align: left; font-family: inherit; }
        .search-result:hover { border-color: var(--accent); }
        .result-thumb { width: 32px; height: 32px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border-subtle); flex-shrink: 0; }
        .result-thumb-ph { width: 32px; height: 32px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; }
        .result-info { flex: 1; min-width: 0; }
        .result-title { font-size: 11px; color: var(--text-primary); line-height: 1.2; margin-bottom: 2px; }
        .result-meta { font-size: 10px; color: var(--text-muted); font-family: monospace; }

        @media (max-width: 768px) {
          .match-row { grid-template-columns: 1fr; gap: 8px; }
          .arrow-divider { display: none; }
        }
      `}</style>
    </div>
  )
}
