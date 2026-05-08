'use client'

import { useState } from 'react'
import type { Calculo } from '../rentabilidad/page'

type InsightItem = {
  tipo: 'positivo' | 'alerta' | 'oportunidad' | 'info'
  titulo: string
  detalle: string
}

type InsightsResponse = {
  resumen: string
  insights: InsightItem[]
  accion_principal: string
}

type Props = {
  calcActual: Calculo
  calcPrev: Calculo
  period: string
  labelPeriodo: string
  labelComparacion: string
  iibbPct: number
}

const TIPO_CONFIG = {
  positivo: { emoji: '✅', label: 'Bueno', cls: 'tipo-positivo' },
  alerta: { emoji: '⚠️', label: 'Alerta', cls: 'tipo-alerta' },
  oportunidad: { emoji: '💡', label: 'Oportunidad', cls: 'tipo-oportunidad' },
  info: { emoji: 'ℹ️', label: 'Info', cls: 'tipo-info' },
}

export default function InsightsIA({ calcActual, calcPrev, period, labelPeriodo, labelComparacion, iibbPct }: Props) {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<InsightsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<{ input_tokens: number; output_tokens: number } | null>(null)

  const generate = async () => {
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const res = await fetch('/api/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          calcActual, calcPrev, period, labelPeriodo, labelComparacion, iibbPct,
        }),
      })
      const json = await res.json()
      if (!json.ok) {
        setError(json.error ?? 'Error al generar insights')
        return
      }
      setData(json.insights)
      setUsage(json.usage)
    } catch (err: any) {
      setError(err?.message ?? 'Error de red')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="insights-section">
      <div className="insights-header">
        <div>
          <h2>🤖 Insights IA</h2>
          <p>Análisis automático de tus números con Claude</p>
        </div>
        <button
          className="btn-generate"
          onClick={generate}
          disabled={loading}
        >
          {loading ? '🔄 Analizando...' : data ? '🔄 Volver a generar' : '✨ Generar análisis'}
        </button>
      </div>

      {!data && !loading && !error && (
        <div className="empty-insights">
          <div className="empty-icon">🤖</div>
          <h3>Análisis con IA bajo demanda</h3>
          <p>
            Apretá <strong>"Generar análisis"</strong> y Claude va a revisar los números del período actual
            y darte insights específicos: alertas de costos, oportunidades de crecimiento,
            comparativas, y la acción principal a tomar.
          </p>
        </div>
      )}

      {loading && (
        <div className="loading-insights">
          <div className="loading-spinner">🧠</div>
          <p>Claude está revisando tus números...</p>
          <p className="loading-hint">Esto puede tardar 5-15 segundos.</p>
        </div>
      )}

      {error && (
        <div className="error-insights">
          <span>⚠️</span>
          <div>
            <strong>Error generando análisis</strong>
            <p>{error}</p>
            {error.includes('ANTHROPIC_API_KEY') && (
              <p className="error-hint">
                Necesitás agregar la variable <code>ANTHROPIC_API_KEY</code> en Vercel
                (Settings → Environment Variables) y volver a deployar.
              </p>
            )}
          </div>
        </div>
      )}

      {data && !loading && (
        <>
          <div className="resumen-card">
            <div className="resumen-icon">📊</div>
            <p>{data.resumen}</p>
          </div>

          <div className="insights-grid">
            {data.insights.map((insight, idx) => {
              const cfg = TIPO_CONFIG[insight.tipo] ?? TIPO_CONFIG.info
              return (
                <div key={idx} className={`insight-card ${cfg.cls}`}>
                  <div className="insight-emoji">{cfg.emoji}</div>
                  <div className="insight-content">
                    <div className="insight-titulo">{insight.titulo}</div>
                    <div className="insight-detalle">{insight.detalle}</div>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="accion-card">
            <div className="accion-label">🎯 ACCIÓN PRINCIPAL</div>
            <div className="accion-text">{data.accion_principal}</div>
          </div>

          {usage && (
            <div className="usage-info">
              Tokens: {usage.input_tokens} in / {usage.output_tokens} out
            </div>
          )}
        </>
      )}

      <style jsx>{`
        .insights-section {
          background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 16px;
          padding: 24px 28px; margin-bottom: 24px;
        }
        .insights-header {
          display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; gap: 16px; flex-wrap: wrap;
        }
        .insights-header h2 { margin: 0 0 4px; font-size: 18px; color: var(--text-primary); font-weight: 700; }
        .insights-header p { margin: 0; font-size: 12px; color: var(--text-muted); }

        .btn-generate {
          background: linear-gradient(135deg, #a855f7 0%, #ec4899 100%);
          color: white; border: none; padding: 10px 18px; border-radius: 10px;
          font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
          box-shadow: 0 4px 14px rgba(168, 85, 247, 0.3); transition: all 0.15s ease;
        }
        .btn-generate:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(168, 85, 247, 0.4); }
        .btn-generate:disabled { opacity: 0.7; cursor: not-allowed; }

        .empty-insights, .loading-insights {
          text-align: center; padding: 40px 20px;
        }
        .empty-icon, .loading-spinner {
          font-size: 48px; margin-bottom: 12px; line-height: 1;
        }
        .loading-spinner {
          animation: spin 1.5s linear infinite;
          display: inline-block;
        }
        @keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        .empty-insights h3 { margin: 0 0 8px; color: var(--text-primary); font-size: 16px; }
        .empty-insights p, .loading-insights p {
          margin: 0; color: var(--text-muted); font-size: 13px; max-width: 480px; margin-left: auto; margin-right: auto;
          line-height: 1.5;
        }
        .empty-insights p strong { color: var(--text-primary); }
        .loading-hint { margin-top: 6px !important; font-size: 11px !important; font-style: italic; }

        .error-insights {
          background: rgba(255, 71, 87, 0.08); border: 1px solid rgba(255, 71, 87, 0.3);
          border-radius: 10px; padding: 14px 16px; display: flex; gap: 12px;
        }
        .error-insights span { font-size: 20px; flex-shrink: 0; }
        .error-insights strong { display: block; color: var(--danger); font-size: 13px; margin-bottom: 4px; }
        .error-insights p { margin: 0 0 4px; color: var(--text-secondary); font-size: 12px; }
        .error-insights p:last-child { margin-bottom: 0; }
        .error-hint code { background: var(--bg-elevated); padding: 1px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; }

        .resumen-card {
          display: flex; gap: 12px; padding: 14px 16px;
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.06) 0%, rgba(236, 72, 153, 0.04) 100%);
          border: 1px solid rgba(168, 85, 247, 0.25);
          border-radius: 12px; margin-bottom: 16px;
        }
        .resumen-icon { font-size: 24px; flex-shrink: 0; line-height: 1; }
        .resumen-card p { margin: 0; color: var(--text-primary); font-size: 13px; line-height: 1.6; }

        .insights-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 10px; margin-bottom: 16px;
        }
        .insight-card {
          display: flex; gap: 10px; padding: 12px 14px;
          background: var(--bg-elevated); border: 1px solid var(--border-subtle);
          border-radius: 10px; border-left-width: 3px;
        }
        .tipo-positivo { border-left-color: var(--success); }
        .tipo-alerta { border-left-color: var(--danger); }
        .tipo-oportunidad { border-left-color: var(--warning); }
        .tipo-info { border-left-color: var(--accent); }
        .insight-emoji { font-size: 18px; flex-shrink: 0; line-height: 1; }
        .insight-content { flex: 1; min-width: 0; }
        .insight-titulo { font-size: 13px; font-weight: 600; color: var(--text-primary); margin-bottom: 4px; line-height: 1.3; }
        .insight-detalle { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }

        .accion-card {
          background: linear-gradient(135deg, var(--accent-deep) 0%, var(--accent) 100%);
          border-radius: 12px; padding: 16px 18px; color: var(--bg-base);
          box-shadow: 0 4px 16px rgba(62, 229, 224, 0.2);
        }
        .accion-label { font-size: 10px; font-weight: 700; letter-spacing: 1.2px; opacity: 0.85; margin-bottom: 4px; }
        .accion-text { font-size: 14px; font-weight: 600; line-height: 1.4; }

        .usage-info {
          margin-top: 10px; font-size: 10px; color: var(--text-dim); text-align: right; font-family: monospace;
        }
      `}</style>
    </div>
  )
}
