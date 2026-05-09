'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import StockTabs from '../../../components/StockTabs'

type Estado = 'actualizar' | 'sin_cambios' | 'conflicto' | 'no_encontrado' | 'error'

type RowResult = {
  fila_excel: number
  sku: string
  tipo: 'ML' | 'Manual'
  titulo: string
  costo_actual: number | null
  iva_actual: number
  costo_nuevo: number
  iva_nuevo: number
  estado: Estado
  matched_keys: string[]
  matched_count: number
  warning: string | null
  error: string | null
}

type Summary = {
  total: number
  actualizar: number
  sin_cambios: number
  conflicto: number
  no_encontrado: number
  error: number
  duplicados: number
}

type ApplyResult = {
  ok: boolean
  updated_items: number
  updated_manuals: number
  total_updated: number
  errors: Array<{ key: string; error: string }>
  error_count: number
}

type Step = 'idle' | 'uploading' | 'preview' | 'applying' | 'done'

const formatARS = (n: number | null) => {
  if (n == null) return '—'
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
}

export default function CargadorMasivoPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('idle')
  const [items, setItems] = useState<RowResult[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [decisions, setDecisions] = useState<Map<number, 'sobreescribir' | 'saltear'>>(new Map())
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null)
  const [filename, setFilename] = useState<string>('')

  const handleDownload = async () => {
    setDownloading(true)
    setError(null)
    try {
      const res = await fetch('/api/items/bulk-cost/template')
      if (!res.ok) {
        const text = await res.text()
        throw new Error(text || 'Error generando plantilla')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const today = new Date().toISOString().slice(0, 10)
      a.download = `costos-trdtech-${today}.xlsx`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err: any) {
      setError(err?.message ?? 'Error de red')
    } finally {
      setDownloading(false)
    }
  }

  const handleFileSelect = async (file: File) => {
    setStep('uploading')
    setError(null)
    setMessage(null)
    setFilename(file.name)

    const fd = new FormData()
    fd.append('file', file)

    try {
      const res = await fetch('/api/items/bulk-cost/preview', {
        method: 'POST',
        body: fd,
      })
      const json = await res.json()
      if (!json.ok) {
        setError(json.error ?? 'Error procesando archivo')
        setStep('idle')
        return
      }
      setItems(json.items ?? [])
      setSummary(json.summary)
      setMessage(json.message ?? null)
      setDecisions(new Map())
      setStep('preview')
    } catch (err: any) {
      setError(err?.message ?? 'Error de red')
      setStep('idle')
    }
  }

  const handleApply = async () => {
    if (!summary) return

    // Construir updates: actualizar siempre + conflictos con decisión = sobreescribir
    const updates = items
      .filter((it, idx) => {
        if (it.estado === 'actualizar') return true
        if (it.estado === 'conflicto' && decisions.get(idx) === 'sobreescribir') return true
        return false
      })
      .map(it => ({
        matched_keys: it.matched_keys,
        cost: it.costo_nuevo,
        iva_rate: it.iva_nuevo,
      }))

    if (updates.length === 0) {
      alert('No hay cambios para aplicar.')
      return
    }

    setStep('applying')
    setError(null)

    try {
      const res = await fetch('/api/items/bulk-cost/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })
      const json = await res.json()
      if (!json.ok) {
        setError(json.error ?? 'Error aplicando cambios')
        setStep('preview')
        return
      }
      setApplyResult(json)
      setStep('done')
    } catch (err: any) {
      setError(err?.message ?? 'Error de red')
      setStep('preview')
    }
  }

  const handleSetDecision = (idx: number, decision: 'sobreescribir' | 'saltear') => {
    setDecisions(prev => {
      const next = new Map(prev)
      if (next.get(idx) === decision) next.delete(idx)
      else next.set(idx, decision)
      return next
    })
  }

  const handleAllConflicts = (decision: 'sobreescribir' | 'saltear') => {
    const next = new Map(decisions)
    items.forEach((it, idx) => {
      if (it.estado === 'conflicto') next.set(idx, decision)
    })
    setDecisions(next)
  }

  const handleReset = () => {
    setStep('idle')
    setItems([])
    setSummary(null)
    setDecisions(new Map())
    setApplyResult(null)
    setError(null)
    setMessage(null)
    setFilename('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Conteos para botón aplicar
  const conflictosTotal = items.filter(i => i.estado === 'conflicto').length
  const conflictosResolverCount = items.filter((it, idx) =>
    it.estado === 'conflicto' && decisions.get(idx) === 'sobreescribir'
  ).length
  const conflictosSaltearCount = items.filter((it, idx) =>
    it.estado === 'conflicto' && decisions.get(idx) === 'saltear'
  ).length
  const conflictosSinResolver = conflictosTotal - conflictosResolverCount - conflictosSaltearCount
  const totalToApply = (summary?.actualizar ?? 0) + conflictosResolverCount

  return (
    <div className="page">
      <StockTabs />

      {step === 'idle' && (
        <div className="content">
          <div className="header">
            <h1>📥 Cargador masivo de costos</h1>
            <p className="subtitle">Cargá costos de muchos productos a la vez con un Excel.</p>
          </div>

          {error && (
            <div className="error-banner">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <div className="step-card">
            <div className="step-num">1</div>
            <div className="step-body">
              <h2>Descargá la plantilla Excel</h2>
              <p>Te genera un archivo con todos tus productos activos (ML + manuales) y los costos actuales. Tiene una hoja con instrucciones.</p>
              <button className="btn-primary" onClick={handleDownload} disabled={downloading}>
                {downloading ? '⏳ Generando...' : '📥 Descargar plantilla Excel'}
              </button>
            </div>
          </div>

          <div className="step-card">
            <div className="step-num">2</div>
            <div className="step-body">
              <h2>Completá los costos en Excel</h2>
              <ul className="step-list">
                <li>Llená la columna <strong>NUEVO Costo (sin IVA)</strong> con el costo unitario.</li>
                <li>La columna <strong>NUEVO IVA (%)</strong> es opcional. Si la dejás vacía se mantiene el actual.</li>
                <li>Si dejás <strong>NUEVO Costo</strong> vacío, ese producto no se modifica.</li>
                <li className="warn">⚠️ NO modifiques las columnas SKU ni Tipo.</li>
              </ul>
            </div>
          </div>

          <div className="step-card">
            <div className="step-num">3</div>
            <div className="step-body">
              <h2>Subí el archivo modificado</h2>
              <p>Vas a ver una vista previa de los cambios antes de aplicarlos. Ahí podés decidir qué hacer con los conflictos.</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) handleFileSelect(file)
                }}
              />
              <button className="btn-primary" onClick={() => fileInputRef.current?.click()}>
                📂 Elegir archivo Excel
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'uploading' && (
        <div className="content">
          <div className="loading-box">
            <div className="loading-spinner">📊</div>
            <p>Procesando archivo...</p>
            <p className="loading-hint">Esto puede tardar unos segundos según el tamaño del Excel.</p>
          </div>
        </div>
      )}

      {step === 'preview' && summary && (
        <div className="content">
          <div className="header">
            <h1>Vista previa</h1>
            <p className="subtitle">📂 {filename} · {summary.total} fila{summary.total === 1 ? '' : 's'} con costos cargados</p>
          </div>

          {message && (
            <div className="info-banner">
              <span>💡</span>
              <span>{message}</span>
            </div>
          )}

          {error && (
            <div className="error-banner">
              <span>⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <div className="summary-grid">
            <div className="sum-card sum-success">
              <div className="sum-num">{summary.actualizar}</div>
              <div className="sum-label">A actualizar</div>
            </div>
            <div className="sum-card sum-warning">
              <div className="sum-num">{summary.conflicto}</div>
              <div className="sum-label">Con conflicto</div>
            </div>
            <div className="sum-card sum-muted">
              <div className="sum-num">{summary.sin_cambios}</div>
              <div className="sum-label">Sin cambios</div>
            </div>
            <div className="sum-card sum-danger">
              <div className="sum-num">{summary.no_encontrado + summary.error}</div>
              <div className="sum-label">No encontrados / Error</div>
            </div>
          </div>

          {summary.duplicados > 0 && (
            <div className="info-banner">
              <span>ℹ️</span>
              <span><strong>{summary.duplicados}</strong> SKU{summary.duplicados === 1 ? ' tiene' : 's tienen'} más de una publicación. El costo se aplicará en todas las publicaciones que comparten ese SKU.</span>
            </div>
          )}

          {conflictosTotal > 0 && (
            <section className="section">
              <div className="section-header">
                <h2>⚠️ Conflictos ({conflictosTotal})</h2>
                <p>Estos productos ya tenían un costo cargado distinto. Decidí qué hacer con cada uno.</p>
                <div className="bulk-actions">
                  <button className="btn-mini" onClick={() => handleAllConflicts('sobreescribir')}>
                    ✓ Sobreescribir todos
                  </button>
                  <button className="btn-mini" onClick={() => handleAllConflicts('saltear')}>
                    ✗ Saltear todos
                  </button>
                </div>
              </div>
              <div className="rows">
                {items.map((it, idx) => {
                  if (it.estado !== 'conflicto') return null
                  const decision = decisions.get(idx)
                  return (
                    <div key={idx} className={`row ${decision === 'sobreescribir' ? 'row-yes' : decision === 'saltear' ? 'row-no' : 'row-pending'}`}>
                      <div className="row-info">
                        <div className="row-title">{it.titulo}</div>
                        <div className="row-meta">
                          <span className="row-sku">SKU: {it.sku}</span>
                          <span className="row-tag">{it.tipo}</span>
                          {it.matched_count > 1 && <span className="row-tag row-tag-warn">{it.matched_count} publicaciones</span>}
                        </div>
                        <div className="row-comparison">
                          <span className="comp-current">
                            Actual: <strong>{formatARS(it.costo_actual)}</strong> ({it.iva_actual}% IVA)
                          </span>
                          <span className="comp-arrow">→</span>
                          <span className="comp-new">
                            Nuevo: <strong>{formatARS(it.costo_nuevo)}</strong> ({it.iva_nuevo}% IVA)
                          </span>
                        </div>
                        {it.warning && <div className="row-warning">⚠ {it.warning}</div>}
                      </div>
                      <div className="row-actions">
                        <button
                          className={`btn-decision ${decision === 'sobreescribir' ? 'btn-yes-active' : 'btn-yes'}`}
                          onClick={() => handleSetDecision(idx, 'sobreescribir')}
                        >
                          ✓ Sobreescribir
                        </button>
                        <button
                          className={`btn-decision ${decision === 'saltear' ? 'btn-no-active' : 'btn-no'}`}
                          onClick={() => handleSetDecision(idx, 'saltear')}
                        >
                          ✗ Saltear
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {summary.actualizar > 0 && (
            <details className="section">
              <summary className="section-summary">
                <h2>✅ Listos para actualizar ({summary.actualizar})</h2>
                <span className="hint">Click para expandir</span>
              </summary>
              <div className="rows rows-compact">
                {items.map((it, idx) => it.estado === 'actualizar' && (
                  <div key={idx} className="row row-ok-compact">
                    <div className="row-info">
                      <div className="row-title">{it.titulo}</div>
                      <div className="row-meta">
                        <span className="row-sku">SKU: {it.sku}</span>
                        <span className="row-tag">{it.tipo}</span>
                        {it.matched_count > 1 && <span className="row-tag row-tag-warn">{it.matched_count} publ.</span>}
                      </div>
                      {it.warning && <div className="row-warning-soft">⚠ {it.warning}</div>}
                    </div>
                    <div className="row-amount">
                      {formatARS(it.costo_nuevo)} <span className="row-iva-mini">+ {it.iva_nuevo}% IVA</span>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {summary.sin_cambios > 0 && (
            <details className="section">
              <summary className="section-summary">
                <h2>🔄 Sin cambios ({summary.sin_cambios})</h2>
                <span className="hint">El costo nuevo es igual al actual</span>
              </summary>
              <div className="rows rows-compact">
                {items.map((it, idx) => it.estado === 'sin_cambios' && (
                  <div key={idx} className="row row-muted">
                    <div className="row-info">
                      <div className="row-title">{it.titulo}</div>
                      <div className="row-meta"><span className="row-sku">SKU: {it.sku}</span></div>
                    </div>
                    <div className="row-amount-muted">{formatARS(it.costo_nuevo)}</div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {summary.no_encontrado > 0 && (
            <details className="section">
              <summary className="section-summary">
                <h2>❌ No encontrados ({summary.no_encontrado})</h2>
                <span className="hint">Estos SKUs no existen en tu catálogo. Revisalos en el Excel.</span>
              </summary>
              <div className="rows rows-compact">
                {items.map((it, idx) => it.estado === 'no_encontrado' && (
                  <div key={idx} className="row row-error">
                    <div className="row-info">
                      <div className="row-title">{it.titulo || '(sin título)'}</div>
                      <div className="row-meta">
                        <span className="row-sku">SKU: {it.sku}</span>
                        <span className="row-tag">{it.tipo}</span>
                        <span className="row-tag-error">Fila {it.fila_excel}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {summary.error > 0 && (
            <details className="section" open>
              <summary className="section-summary">
                <h2>⚠️ Errores de validación ({summary.error})</h2>
                <span className="hint">Estas filas tienen valores inválidos en el Excel</span>
              </summary>
              <div className="rows rows-compact">
                {items.map((it, idx) => it.estado === 'error' && (
                  <div key={idx} className="row row-error">
                    <div className="row-info">
                      <div className="row-title">{it.titulo || '(sin título)'}</div>
                      <div className="row-meta">
                        <span className="row-sku">SKU: {it.sku}</span>
                        <span className="row-tag-error">Fila {it.fila_excel}</span>
                      </div>
                      <div className="row-warning">{it.error}</div>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}

          <div className="footer-bar">
            <button className="btn-cancel" onClick={handleReset}>
              ← Cancelar / Subir otro
            </button>
            <button
              className="btn-apply"
              onClick={handleApply}
              disabled={totalToApply === 0}
            >
              {totalToApply === 0
                ? 'Sin cambios para aplicar'
                : conflictosSinResolver > 0
                  ? `⚠️ ${conflictosSinResolver} conflicto${conflictosSinResolver === 1 ? '' : 's'} sin resolver`
                  : `✓ Aplicar ${totalToApply} cambio${totalToApply === 1 ? '' : 's'}`
              }
            </button>
          </div>
        </div>
      )}

      {step === 'applying' && (
        <div className="content">
          <div className="loading-box">
            <div className="loading-spinner">💾</div>
            <p>Aplicando cambios...</p>
            <p className="loading-hint">No cierres esta pestaña.</p>
          </div>
        </div>
      )}

      {step === 'done' && applyResult && (
        <div className="content">
          <div className="done-box">
            <div className="done-icon">🎉</div>
            <h1>¡Listo!</h1>
            <p>Se actualizaron <strong>{applyResult.total_updated}</strong> costos correctamente.</p>
            <div className="done-stats">
              <div><strong>{applyResult.updated_items}</strong> publicaciones de ML</div>
              <div><strong>{applyResult.updated_manuals}</strong> productos manuales</div>
            </div>

            {applyResult.errors.length > 0 && (
              <details className="errors-detail">
                <summary>⚠️ {applyResult.errors.length} errores</summary>
                <ul>
                  {applyResult.errors.slice(0, 20).map((e, i) => (
                    <li key={i}><code>{e.key}</code>: {e.error}</li>
                  ))}
                  {applyResult.errors.length > 20 && <li>... y {applyResult.errors.length - 20} más</li>}
                </ul>
              </details>
            )}

            <div className="done-actions">
              <button className="btn-primary" onClick={() => router.push('/stock')}>
                Ver stock
              </button>
              <button className="btn-secondary" onClick={handleReset}>
                Cargar otro Excel
              </button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .page { padding: 24px 40px 48px; max-width: 1100px; margin: 0 auto; }
        .content { display: flex; flex-direction: column; gap: 16px; }
        .header h1 { margin: 0 0 4px; font-size: 26px; font-weight: 700; color: var(--text-primary); }
        .subtitle { margin: 0; font-size: 13px; color: var(--text-muted); }

        .error-banner, .info-banner {
          display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 10px; font-size: 13px; line-height: 1.5;
        }
        .error-banner { background: rgba(255, 71, 87, 0.08); border: 1px solid rgba(255, 71, 87, 0.3); color: var(--danger); }
        .info-banner { background: rgba(62, 229, 224, 0.06); border: 1px solid rgba(62, 229, 224, 0.25); color: var(--text-secondary); }
        .info-banner strong { color: var(--accent); }

        .step-card {
          display: flex; gap: 16px; background: var(--bg-card); border: 1px solid var(--border-subtle);
          border-radius: 14px; padding: 18px 20px;
        }
        .step-num {
          width: 32px; height: 32px; flex-shrink: 0;
          background: linear-gradient(135deg, var(--accent-deep), var(--accent));
          color: var(--bg-base); border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-weight: 800; font-size: 14px;
        }
        .step-body { flex: 1; }
        .step-body h2 { margin: 0 0 6px; font-size: 16px; color: var(--text-primary); font-weight: 700; }
        .step-body p { margin: 0 0 12px; color: var(--text-secondary); font-size: 13px; line-height: 1.5; }
        .step-list { margin: 0 0 12px; padding-left: 18px; color: var(--text-secondary); font-size: 13px; line-height: 1.6; }
        .step-list li { margin-bottom: 4px; }
        .step-list li.warn { color: var(--warning); }
        .step-list strong { color: var(--text-primary); }

        .btn-primary {
          display: inline-flex; align-items: center; gap: 6px;
          background: linear-gradient(135deg, var(--accent-deep) 0%, var(--accent-secondary) 50%, var(--accent) 100%);
          color: var(--bg-base); border: none; padding: 10px 18px; border-radius: 10px;
          font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
          box-shadow: 0 4px 14px rgba(62, 229, 224, 0.25); transition: all 0.15s ease;
        }
        .btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(62, 229, 224, 0.4); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-secondary {
          background: transparent; color: var(--text-secondary); border: 1px solid var(--border-subtle);
          padding: 10px 18px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
        }
        .btn-secondary:hover { color: var(--text-primary); border-color: var(--border-medium); }

        .loading-box, .done-box {
          background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 14px;
          padding: 48px 32px; text-align: center;
        }
        .loading-spinner, .done-icon { font-size: 48px; margin-bottom: 12px; line-height: 1; display: inline-block; }
        .loading-spinner { animation: spin 1.5s linear infinite; }
        .done-icon { animation: pop 0.5s ease; }
        @keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        @keyframes pop { 0% { transform: scale(0); } 60% { transform: scale(1.1); } 100% { transform: scale(1); } }
        .loading-box p, .done-box p { margin: 0 0 6px; color: var(--text-primary); font-size: 14px; }
        .loading-hint { color: var(--text-muted) !important; font-size: 12px !important; }
        .done-box h1 { margin: 0 0 12px; font-size: 28px; color: var(--text-primary); font-weight: 800; }
        .done-stats { display: flex; gap: 24px; justify-content: center; margin: 16px 0 24px; flex-wrap: wrap; color: var(--text-secondary); font-size: 13px; }
        .done-stats strong { color: var(--accent); font-size: 18px; }
        .done-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
        .errors-detail { text-align: left; max-width: 560px; margin: 12px auto; }
        .errors-detail summary { cursor: pointer; color: var(--warning); font-size: 13px; font-weight: 600; }
        .errors-detail ul { font-size: 12px; color: var(--text-secondary); margin-top: 8px; padding-left: 20px; }
        .errors-detail code { background: var(--bg-elevated); padding: 1px 5px; border-radius: 4px; font-size: 11px; }

        .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .sum-card { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 16px; text-align: center; position: relative; overflow: hidden; }
        .sum-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; opacity: 0.7; }
        .sum-success::before { background: var(--success); }
        .sum-warning::before { background: var(--warning); }
        .sum-muted::before { background: var(--text-muted); }
        .sum-danger::before { background: var(--danger); }
        .sum-num { font-size: 26px; font-weight: 800; color: var(--text-primary); font-variant-numeric: tabular-nums; }
        .sum-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; margin-top: 4px; }

        .section { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 14px; padding: 18px 20px; }
        details.section { padding: 0; overflow: hidden; }
        details.section[open] .section-summary { border-bottom: 1px solid var(--border-subtle); }
        .section-summary { padding: 14px 20px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; gap: 12px; user-select: none; }
        .section-summary::-webkit-details-marker { display: none; }
        .section-summary h2, .section-header h2 { margin: 0; font-size: 15px; color: var(--text-primary); font-weight: 700; }
        .section-summary .hint { font-size: 11px; color: var(--text-muted); }
        details.section > .rows { padding: 12px 20px 16px; }
        .section-header { margin-bottom: 12px; }
        .section-header p { margin: 4px 0 10px; color: var(--text-muted); font-size: 12px; }
        .bulk-actions { display: flex; gap: 6px; flex-wrap: wrap; }
        .btn-mini { background: var(--bg-elevated); color: var(--text-secondary); border: 1px solid var(--border-subtle); padding: 6px 11px; border-radius: 7px; font-size: 12px; cursor: pointer; font-family: inherit; }
        .btn-mini:hover { border-color: var(--border-medium); color: var(--text-primary); }

        .rows { display: flex; flex-direction: column; gap: 8px; }
        .rows-compact { gap: 6px; }
        .row { display: flex; gap: 12px; align-items: flex-start; padding: 12px 14px; background: var(--bg-elevated); border: 1px solid var(--border-subtle); border-radius: 10px; transition: all 0.15s ease; }
        .row-pending { border-left: 3px solid var(--warning); }
        .row-yes { border-left: 3px solid var(--success); background: rgba(62, 229, 224, 0.04); }
        .row-no { border-left: 3px solid var(--text-muted); opacity: 0.6; }
        .row-ok-compact { border-left: 3px solid var(--success); }
        .row-muted { opacity: 0.7; }
        .row-error { border-left: 3px solid var(--danger); }
        .row-info { flex: 1; min-width: 0; }
        .row-title { font-size: 13px; color: var(--text-primary); font-weight: 500; line-height: 1.3; margin-bottom: 4px; }
        .row-meta { display: flex; flex-wrap: wrap; gap: 8px; font-size: 11px; color: var(--text-muted); align-items: center; }
        .row-sku { font-family: monospace; }
        .row-tag { background: var(--bg-base); padding: 1px 7px; border-radius: 5px; font-size: 10px; font-weight: 600; border: 1px solid var(--border-subtle); }
        .row-tag-warn { background: rgba(255, 167, 38, 0.1); color: var(--warning); border-color: rgba(255, 167, 38, 0.3); }
        .row-tag-error { background: rgba(255, 71, 87, 0.1); color: var(--danger); border: 1px solid rgba(255, 71, 87, 0.3); padding: 1px 7px; border-radius: 5px; font-size: 10px; font-weight: 600; }
        .row-comparison { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 6px; font-size: 12px; color: var(--text-secondary); }
        .comp-current { color: var(--text-muted); }
        .comp-current strong { color: var(--text-primary); }
        .comp-arrow { color: var(--accent); }
        .comp-new strong { color: var(--accent); }
        .row-warning { font-size: 11px; color: var(--warning); margin-top: 4px; }
        .row-warning-soft { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
        .row-actions { display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }
        .btn-decision { background: var(--bg-card); color: var(--text-secondary); border: 1px solid var(--border-subtle); padding: 6px 10px; border-radius: 7px; font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s ease; white-space: nowrap; }
        .btn-yes:hover { border-color: var(--success); color: var(--success); }
        .btn-no:hover { border-color: var(--danger); color: var(--danger); }
        .btn-yes-active { background: var(--success); color: var(--bg-base); border-color: var(--success); }
        .btn-no-active { background: var(--text-muted); color: var(--bg-base); border-color: var(--text-muted); }
        .row-amount { font-size: 14px; font-weight: 700; color: var(--text-primary); white-space: nowrap; flex-shrink: 0; }
        .row-amount-muted { font-size: 13px; color: var(--text-muted); white-space: nowrap; flex-shrink: 0; }
        .row-iva-mini { font-size: 10px; color: var(--text-muted); font-weight: 500; }

        .footer-bar {
          position: sticky; bottom: 0; left: 0; right: 0;
          display: flex; gap: 10px; justify-content: space-between; align-items: center;
          background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 14px;
          padding: 14px 18px; margin-top: 8px; backdrop-filter: blur(8px);
          box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.4);
        }
        .btn-cancel { background: transparent; color: var(--text-muted); border: 1px solid var(--border-subtle); padding: 9px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; font-family: inherit; }
        .btn-cancel:hover { color: var(--text-primary); border-color: var(--border-medium); }
        .btn-apply {
          background: linear-gradient(135deg, var(--accent-deep), var(--accent));
          color: var(--bg-base); border: none; padding: 11px 22px; border-radius: 10px;
          font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit;
          box-shadow: 0 4px 14px rgba(62, 229, 224, 0.3);
        }
        .btn-apply:hover:not(:disabled) { transform: translateY(-1px); }
        .btn-apply:disabled { opacity: 0.5; cursor: not-allowed; box-shadow: none; }

        @media (max-width: 768px) {
          .page { padding: 16px; }
          .summary-grid { grid-template-columns: repeat(2, 1fr); }
          .step-card { flex-direction: column; gap: 10px; }
          .row { flex-direction: column; }
          .row-actions { flex-direction: row; }
          .footer-bar { flex-direction: column; gap: 8px; }
          .btn-cancel, .btn-apply { width: 100%; }
        }
      `}</style>
    </div>
  )
}
