'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import CargarAdsModal from '../components/CargarAdsModal'
import GastoRapidoModal from '../components/GastoRapidoModal'
import ConfigModal from '../components/ConfigModal'
import QuickCalc from '../components/QuickCalc'
import InsightsIA from '../components/InsightsIA'
import type { Calculo } from './page'

type Cambio = { pct: number; trend: 'up' | 'down' | 'flat' } | null

type Props = {
  period: string
  labelPeriodo: string
  labelComparacion: string
  calcActual: Calculo
  calcPrev: Calculo
  iibbPct: number
}

const TZ = 'America/Argentina/Buenos_Aires'

function calcCambio(actual: number, previo: number): Cambio {
  if (previo === 0) {
    if (actual === 0) return { pct: 0, trend: 'flat' }
    return null
  }
  const pct = ((actual - previo) / previo) * 100
  if (Math.abs(pct) < 0.5) return { pct: 0, trend: 'flat' }
  return { pct, trend: pct > 0 ? 'up' : 'down' }
}

export default function RentabilidadView({
  period, labelPeriodo, labelComparacion, calcActual, calcPrev, iibbPct,
}: Props) {
  const router = useRouter()
  const [adsModalOpen, setAdsModalOpen] = useState(false)
  const [gastoModalOpen, setGastoModalOpen] = useState(false)
  const [configModalOpen, setConfigModalOpen] = useState(false)
  const [calcOpen, setCalcOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [activeTab, setActiveTab] = useState<'metricas' | 'insights'>('metricas')

  const handleSync = async () => {
    setSyncing(true)
    try {
      await fetch('/api/sync', { cache: 'no-store' })
      router.refresh()
    } catch (err) {
      console.error('Error sync:', err)
    } finally {
      setTimeout(() => setSyncing(false), 1000)
    }
  }

  const formatARS = (n: number) => {
    const abs = Math.abs(n)
    if (abs >= 1_000_000) return `$${(n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 2 })}M`
    if (abs >= 10_000) return `$${Math.round(n / 1000).toLocaleString('es-AR')}k`
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)
  }

  const formatARSFull = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  const formatARSSigned = (n: number) => {
    const formatted = formatARS(Math.abs(n))
    return n < 0 ? `−${formatted}` : formatted
  }

  const margenLabel = (() => {
    if (calcActual.facturacion === 0) return ''
    if (calcActual.margen >= 30) return 'IMPARABLE'
    if (calcActual.margen >= 20) return 'EXCELENTE'
    if (calcActual.margen >= 10) return 'BUENO'
    if (calcActual.margen >= 0) return 'AJUSTADO'
    return 'NEGATIVO'
  })()

  const cambioGanancia = calcCambio(calcActual.ganancia, calcPrev.ganancia)
  const cambioVentas = calcCambio(calcActual.ventas, calcPrev.ventas)
  const cambioMargen = calcCambio(calcActual.margen, calcPrev.margen)

  const renderCambio = (cambio: Cambio, label: string, invertColor?: boolean) => {
    if (!cambio) return <span className="cambio cambio-flat">— sin datos previos</span>
    const isGood = cambio.trend === 'flat' ? null : (cambio.trend === 'up') !== !!invertColor
    const cls = cambio.trend === 'flat' ? 'cambio-flat' : (isGood ? 'cambio-good' : 'cambio-bad')
    const arrow = cambio.trend === 'up' ? '↑' : cambio.trend === 'down' ? '↓' : '='
    return <span className={`cambio ${cls}`}>{arrow} {Math.abs(cambio.pct).toFixed(0)}% {label}</span>
  }

  const periodos = [
    { value: 'hoy', label: 'Hoy', icon: '📅' },
    { value: 'semana', label: 'Esta semana', icon: '🗓️' },
    { value: 'mes', label: 'Este mes', icon: '📆' },
  ]

  const mejorDiaFormatted = calcActual.mejorDiaFecha
    ? new Date(calcActual.mejorDiaFecha + 'T12:00:00-03:00').toLocaleDateString('es-AR', {
        day: 'numeric', month: 'short', timeZone: TZ
      })
    : '—'

  return (
    <div className="page">
      <div className="header">
        <div className="header-title">
          <h1>💰 Rentabilidad</h1>
          <p className="subtitle">Métricas combinadas · datos en tiempo real</p>
        </div>
        <div className="header-actions">
          <button className="btn-action btn-action-sync" onClick={handleSync} disabled={syncing}>
            <span className={syncing ? 'spinning' : ''}>{syncing ? '⏳' : '🔄'}</span>
            {syncing ? 'Sincronizando...' : 'Sincronizar'}
          </button>
          <button className="btn-action" onClick={() => setAdsModalOpen(true)}>
            <span>📊</span> Ads
          </button>
          <button className="btn-action btn-action-warning" onClick={() => setGastoModalOpen(true)}>
            <span>💸</span> Gasto
          </button>
          <button className="btn-action" onClick={() => setCalcOpen(true)} title="Atajo: Esc cierra">
            <span>🧮</span> Calc
          </button>
          <button className="btn-action" onClick={() => setConfigModalOpen(true)}>
            <span>⚙️</span> Config
          </button>
        </div>
      </div>

      <div className="main-tabs">
        <button
          className={`main-tab ${activeTab === 'metricas' ? 'main-tab-active' : ''}`}
          onClick={() => setActiveTab('metricas')}
        >
          📊 Métricas
        </button>
        <button
          className={`main-tab ${activeTab === 'insights' ? 'main-tab-active' : ''}`}
          onClick={() => setActiveTab('insights')}
        >
          🤖 Insights IA
        </button>
      </div>

      {activeTab === 'metricas' ? (
        <>
          <div className="period-tabs">
            {periodos.map(p => {
              const activo = period === p.value
              return (
                <Link
                  key={p.value}
                  href={`/rentabilidad?period=${p.value}`}
                  className={`period-tab ${activo ? 'period-active' : ''}`}
                >
                  <span>{p.icon}</span>
                  <span>{p.label}</span>
                </Link>
              )
            })}
          </div>

          <div className={`hero ${calcActual.ganancia >= 0 ? 'hero-positive' : 'hero-negative'}`}>
            <div className="hero-bg">
              <div className="hero-orb orb-1" />
              <div className="hero-orb orb-2" />
              <div className="hero-orb orb-3" />
            </div>
            <div className="hero-content">
              <div className="hero-left">
                <div className="hero-emoji">{calcActual.ganancia >= 0 ? '🚀' : '⚠️'}</div>
                <div>
                  <div className="hero-label">
                    GANANCIA · {labelPeriodo.toUpperCase()}
                    {period === 'hoy' && <span className="badge-live">EN VIVO</span>}
                  </div>
                  <div className="hero-amount">{formatARSSigned(calcActual.ganancia)}</div>
                  <div className="hero-subamount">{formatARSFull(calcActual.ganancia)}</div>
                  <div className="hero-cambio">
                    {renderCambio(cambioGanancia, labelComparacion)}
                  </div>
                </div>
              </div>
              <div className="hero-right">
                <div className="hero-margen-label">MARGEN</div>
                <div className="hero-margen-value">{calcActual.facturacion > 0 ? `${calcActual.margen.toFixed(1)}%` : '—'}</div>
                <div className="hero-margen-tag">{margenLabel}</div>
                <div className="hero-cambio">
                  {renderCambio(cambioMargen, labelComparacion)}
                </div>
              </div>
            </div>

            <div className="stats-grid">
              <div className="stat-cell">
                <div className="stat-label">FACTURACIÓN</div>
                <div className="stat-value stat-positive">{formatARS(calcActual.facturacion)}</div>
                <div className="stat-detail">{calcActual.ventas} {calcActual.ventas === 1 ? 'venta' : 'ventas'}</div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">− COMISIÓN ML</div>
                <div className="stat-value stat-negative">−{formatARS(calcActual.comision)}</div>
                <div className="stat-detail">{calcActual.comisionPct.toFixed(1)}% efectivo</div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">− ENVÍOS ME</div>
                <div className="stat-value stat-negative">−{formatARS(calcActual.envios)}</div>
                <div className="stat-detail">{calcActual.envioCount} {calcActual.envioCount === 1 ? 'envío' : 'envíos'}</div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">+ FLEX (BONIF.)</div>
                <div className="stat-value stat-positive">+{formatARS(calcActual.flexBonif)}</div>
                <div className="stat-detail">{calcActual.flexCount} ventas Flex</div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">− PUBLICIDAD</div>
                <div className="stat-value stat-negative">−{formatARS(calcActual.publicidad)}</div>
                <div className="stat-detail">
                  {calcActual.publicidad === 0
                    ? <button className="link-btn" onClick={() => setAdsModalOpen(true)}>📊 cargar gastos</button>
                    : <button className="link-btn" onClick={() => setAdsModalOpen(true)}>📊 ver/editar</button>
                  }
                </div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">− IIBB ({iibbPct.toFixed(1)}%)</div>
                <div className="stat-value stat-negative">−{formatARS(calcActual.iibb)}</div>
                <div className="stat-detail">
                  <button className="link-btn" onClick={() => setConfigModalOpen(true)}>⚙️ editar %</button>
                </div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">− COSTO MERCA</div>
                <div className="stat-value stat-negative">−{formatARS(calcActual.costoMerca)}</div>
                <div className="stat-detail">
                  {calcActual.coberturaCosto < 100 ? (
                    <button className="link-btn" onClick={() => setConfigModalOpen(true)}>
                      cobertura {calcActual.coberturaCosto.toFixed(0)}%
                    </button>
                  ) : `cobertura 100%`}
                </div>
              </div>
              <div className="stat-cell">
                <div className="stat-label">− GASTOS VARIOS</div>
                <div className="stat-value stat-negative">−{formatARS(calcActual.gastosVarios)}</div>
                <div className="stat-detail">
                  {calcActual.gastosVarios === 0
                    ? <button className="link-btn" onClick={() => setGastoModalOpen(true)}>💸 cargar gasto</button>
                    : <button className="link-btn" onClick={() => setGastoModalOpen(true)}>💸 ver/editar</button>
                  }
                </div>
              </div>
            </div>
          </div>

          <div className="mini-cards">
            <div className="mini-card">
              <div className="mini-label">🛒 VENTAS</div>
              <div className="mini-value">{calcActual.ventas}</div>
              <div className="mini-detail">{renderCambio(cambioVentas, labelComparacion)}</div>
            </div>
            <div className="mini-card">
              <div className="mini-label">📦 UNIDADES</div>
              <div className="mini-value">{calcActual.unidades}</div>
              <div className="mini-detail">
                {calcActual.ventas > 0 ? `${(calcActual.unidades / calcActual.ventas).toFixed(1)} u/venta` : '—'}
              </div>
            </div>
            <div className="mini-card">
              <div className="mini-label">🎫 TICKET PROM.</div>
              <div className="mini-value">{formatARS(calcActual.ticketPromedio)}</div>
              <div className="mini-detail">por venta</div>
            </div>
            <div className="mini-card">
              <div className="mini-label">📅 DÍAS ACTIVOS</div>
              <div className="mini-value">{calcActual.diasActivos} <span className="mini-fraction">/ {calcActual.diasTotales}</span></div>
              <div className="mini-detail">
                {calcActual.diasTotales > 0 ? `${((calcActual.diasActivos / calcActual.diasTotales) * 100).toFixed(0)}% del período` : '—'}
              </div>
            </div>
            <div className="mini-card">
              <div className="mini-label">🏆 MEJOR DÍA</div>
              <div className="mini-value">{calcActual.mejorDiaMonto > 0 ? formatARS(calcActual.mejorDiaMonto) : '—'}</div>
              <div className="mini-detail">{mejorDiaFormatted}</div>
            </div>
            <div className="mini-card">
              <div className="mini-label">📈 ROAS</div>
              <div className={`mini-value ${calcActual.publicidad > 0 ? 'mini-roas' : 'mini-disabled'}`}>
                {calcActual.publicidad > 0 ? `×${calcActual.roas.toFixed(1)}` : '—'}
              </div>
              <div className="mini-detail">
                {calcActual.publicidad > 0 ? 'retorno sobre Ads' : 'sin gasto cargado'}
              </div>
            </div>
          </div>
        </>
      ) : (
        <InsightsIA
          calcActual={calcActual}
          calcPrev={calcPrev}
          period={period}
          labelPeriodo={labelPeriodo}
          labelComparacion={labelComparacion}
          iibbPct={iibbPct}
        />
      )}

      {adsModalOpen && <CargarAdsModal onClose={() => setAdsModalOpen(false)} />}
      {gastoModalOpen && <GastoRapidoModal onClose={() => setGastoModalOpen(false)} />}
      {configModalOpen && <ConfigModal onClose={() => setConfigModalOpen(false)} />}
      {calcOpen && <QuickCalc onClose={() => setCalcOpen(false)} />}

      <style jsx>{`
        .page { padding: 24px 40px 48px; max-width: 1500px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; gap: 16px; flex-wrap: wrap; }
        .header-title h1 { margin: 0 0 4px; font-size: 26px; font-weight: 700; color: var(--text-primary); }
        .subtitle { margin: 0; font-size: 13px; color: var(--text-muted); }
        .header-actions { display: flex; gap: 6px; flex-wrap: wrap; }
        .btn-action {
          display: inline-flex; align-items: center; gap: 6px; padding: 9px 12px;
          background: var(--bg-card); color: var(--text-secondary); border: 1px solid var(--border-subtle);
          border-radius: 10px; font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
          transition: all 0.15s ease;
        }
        .btn-action:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
        .btn-action:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-action-warning:hover:not(:disabled) { border-color: var(--warning); color: var(--warning); }
        .btn-action-sync:hover:not(:disabled) { border-color: var(--success); color: var(--success); }
        .spinning { display: inline-block; animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }

        .main-tabs {
          display: flex; gap: 4px; border-bottom: 1px solid var(--border-subtle); margin-bottom: 24px;
        }
        .main-tab {
          background: transparent; border: none; padding: 12px 18px; color: var(--text-muted);
          font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit;
          border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all 0.15s ease;
        }
        .main-tab:hover { color: var(--text-secondary); }
        .main-tab.main-tab-active { color: var(--accent); border-bottom-color: var(--accent); }

        .period-tabs { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; }
        .period-tab {
          display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px;
          border-radius: 10px; font-size: 13px; font-weight: 600; background: var(--bg-card);
          color: var(--text-secondary); border: 1px solid var(--border-subtle); text-decoration: none;
          transition: all 0.15s ease;
        }
        .period-tab:hover { border-color: var(--border-medium); color: var(--text-primary); }
        .period-tab.period-active {
          background: linear-gradient(135deg, #f59e0b, #fbbf24);
          color: #1a1a1a; border-color: #fbbf24;
          box-shadow: 0 4px 14px rgba(245, 158, 11, 0.25);
        }

        .hero {
          position: relative; background: var(--bg-card); border: 1px solid var(--border-subtle);
          border-radius: 18px; padding: 36px 40px 28px; margin-bottom: 24px; overflow: hidden;
        }
        .hero-positive {
          background: linear-gradient(135deg, rgba(168, 85, 247, 0.06) 0%, rgba(236, 72, 153, 0.04) 100%);
          border-color: rgba(168, 85, 247, 0.35);
          box-shadow: 0 0 60px rgba(168, 85, 247, 0.08);
        }
        .hero-negative {
          background: linear-gradient(135deg, rgba(239, 68, 68, 0.06) 0%, rgba(248, 113, 113, 0.04) 100%);
          border-color: rgba(239, 68, 68, 0.35);
          box-shadow: 0 0 60px rgba(239, 68, 68, 0.08);
        }
        .hero-bg { position: absolute; inset: 0; pointer-events: none; }
        .hero-orb { position: absolute; border-radius: 50%; filter: blur(40px); opacity: 0.5; }
        .hero-positive .orb-1 { background: rgba(168, 85, 247, 0.4); width: 200px; height: 200px; top: -50px; left: 30%; }
        .hero-positive .orb-2 { background: rgba(236, 72, 153, 0.3); width: 150px; height: 150px; bottom: -30px; right: 20%; }
        .hero-positive .orb-3 { background: rgba(99, 102, 241, 0.3); width: 120px; height: 120px; top: 40%; right: 10%; }
        .hero-negative .orb-1 { background: rgba(239, 68, 68, 0.4); width: 200px; height: 200px; top: -50px; left: 30%; }
        .hero-negative .orb-2 { background: rgba(248, 113, 113, 0.3); width: 150px; height: 150px; bottom: -30px; right: 20%; }
        .hero-negative .orb-3 { background: rgba(220, 38, 38, 0.3); width: 120px; height: 120px; top: 40%; right: 10%; }

        .hero-content {
          position: relative; display: flex; justify-content: space-between; align-items: flex-start;
          gap: 20px; margin-bottom: 28px; padding-bottom: 24px; border-bottom: 1px solid var(--border-subtle);
          flex-wrap: wrap;
        }
        .hero-left { display: flex; gap: 18px; align-items: flex-start; flex: 1; min-width: 280px; }
        .hero-emoji { font-size: 56px; line-height: 1; flex-shrink: 0; filter: drop-shadow(0 0 20px rgba(168, 85, 247, 0.4)); }
        .hero-label {
          font-size: 11px; color: var(--text-muted); letter-spacing: 1.5px;
          margin-bottom: 6px; font-weight: 700; display: flex; align-items: center; gap: 10px;
        }
        .badge-live {
          display: inline-flex; align-items: center; gap: 4px;
          background: rgba(239, 68, 68, 0.15); color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.35); padding: 2px 8px; border-radius: 12px;
          font-size: 9px; font-weight: 700; letter-spacing: 0.5px;
        }
        .badge-live::before { content: ''; width: 6px; height: 6px; background: #f87171; border-radius: 50%; animation: pulse 2s ease-in-out infinite; }
        @keyframes pulse { 50% { opacity: 0.4; } }
        .hero-amount {
          font-size: 56px; font-weight: 800; color: var(--text-primary); line-height: 1;
          font-variant-numeric: tabular-nums;
          background: linear-gradient(135deg, #c084fc 0%, #f472b6 100%);
          -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
          margin-bottom: 6px;
        }
        .hero-negative .hero-amount {
          background: linear-gradient(135deg, #f87171 0%, #fb923c 100%);
          -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
        }
        .hero-subamount { color: var(--text-muted); font-size: 13px; }
        .hero-cambio { margin-top: 8px; font-size: 12px; }
        .hero-right { text-align: right; }
        .hero-margen-label { font-size: 11px; color: var(--text-muted); letter-spacing: 1.5px; font-weight: 700; }
        .hero-margen-value { font-size: 44px; font-weight: 800; color: var(--text-primary); line-height: 1; margin: 6px 0 4px; font-variant-numeric: tabular-nums; }
        .hero-margen-tag { font-size: 11px; color: var(--accent); letter-spacing: 1px; font-weight: 700; }

        .cambio { font-size: 12px; font-weight: 600; }
        .cambio-good { color: var(--success); }
        .cambio-bad { color: var(--danger); }
        .cambio-flat { color: var(--text-muted); }

        .stats-grid { position: relative; display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px 24px; }
        .stat-cell { display: flex; flex-direction: column; }
        .stat-label { font-size: 10px; color: var(--text-muted); letter-spacing: 1px; font-weight: 600; margin-bottom: 4px; }
        .stat-value { font-size: 22px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; line-height: 1.1; }
        .stat-negative { color: var(--text-secondary); }
        .stat-detail { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
        .link-btn {
          background: transparent; border: none; color: var(--accent); padding: 0;
          font-family: inherit; font-size: 11px; cursor: pointer; text-decoration: underline;
        }
        .link-btn:hover { color: var(--accent-secondary); }

        .mini-cards { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; }
        .mini-card { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 16px 18px; }
        .mini-label { font-size: 11px; color: var(--text-muted); letter-spacing: 0.5px; font-weight: 600; margin-bottom: 6px; }
        .mini-value { font-size: 22px; font-weight: 700; color: var(--text-primary); font-variant-numeric: tabular-nums; line-height: 1.1; }
        .mini-fraction { font-size: 14px; color: var(--text-muted); font-weight: 500; }
        .mini-detail { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
        .mini-roas { color: var(--accent); }
        .mini-disabled { opacity: 0.4; }

        @media (max-width: 1300px) {
          .mini-cards { grid-template-columns: repeat(3, 1fr); }
        }
        @media (max-width: 1100px) {
          .stats-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 768px) {
          .page { padding: 16px; }
          .header { flex-direction: column; align-items: stretch; }
          .header-title h1 { font-size: 22px; }
          .header-actions { display: grid; grid-template-columns: repeat(2, 1fr); }
          .btn-action { justify-content: center; }
          .period-tabs { display: grid; grid-template-columns: repeat(3, 1fr); }
          .period-tab { justify-content: center; padding: 9px 6px; font-size: 12px; }
          .hero { padding: 24px 20px 20px; }
          .hero-content { flex-direction: column; padding-bottom: 20px; }
          .hero-left { gap: 12px; min-width: 0; }
          .hero-emoji { font-size: 40px; }
          .hero-amount { font-size: 38px; }
          .hero-right { text-align: left; width: 100%; }
          .hero-margen-value { font-size: 32px; }
          .stats-grid { grid-template-columns: 1fr 1fr; gap: 14px 16px; }
          .stat-value { font-size: 18px; }
          .mini-cards { grid-template-columns: repeat(2, 1fr); }
          .mini-value { font-size: 18px; }
        }
      `}</style>
    </div>
  )
}
