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
  period, labelPeriodo, labelComparacion, calcActual, calcPrev,
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

  const formatARSFullSigned = (n: number) => {
    const formatted = formatARSFull(Math.abs(n))
    return n < 0 ? `−${formatted}` : formatted
  }

  const margenLabel = (() => {
    if (calcActual.ingresosNetos === 0) return ''
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
    { value: 'hoy', label: 'Hoy' },
    { value: 'semana', label: 'Esta semana' },
    { value: 'mes', label: 'Este mes' },
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
          <h1>Rentabilidad</h1>
          <p className="subtitle">Cálculo fiscal completo · Responsable Inscripto</p>
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
          <button className="btn-action" onClick={() => setCalcOpen(true)}>
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
          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
            {periodos.map(p => {
              const activo = period === p.value
              const baseStyle: React.CSSProperties = {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '10px 22px',
                borderRadius: '10px',
                fontSize: '13px',
                fontWeight: 600,
                textDecoration: 'none',
                letterSpacing: '0.3px',
                transition: 'all 0.18s ease',
                border: '1px solid rgba(62, 229, 224, 0.4)',
              }
              const styleActivo: React.CSSProperties = {
                ...baseStyle,
                background: 'linear-gradient(135deg, #1ca0c4 0%, #3ee5e0 100%)',
                color: '#0a121c',
                borderColor: 'rgba(62, 229, 224, 0.7)',
                boxShadow: '0 4px 18px rgba(62, 229, 224, 0.35)',
              }
              const styleInactivo: React.CSSProperties = {
                ...baseStyle,
                background: 'linear-gradient(135deg, #0d4d6e 0%, #1ca0c4 100%)',
                color: '#ffffff',
                opacity: 0.55,
                boxShadow: '0 2px 10px rgba(28, 160, 196, 0.15)',
              }
              return (
                <Link
                  key={p.value}
                  href={`/rentabilidad?period=${p.value}`}
                  style={activo ? styleActivo : styleInactivo}
                >
                  {p.label}
                </Link>
              )
            })}
          </div>

          {calcActual.unidadesSinCosto > 0 && (
            <div className="warn-banner">
              <span>⚠️</span>
              <div className="warn-text">
                <strong>{calcActual.unidadesSinCosto}</strong> {calcActual.unidadesSinCosto === 1 ? 'unidad vendida' : 'unidades vendidas'} sin costo configurado.
                Se asume IVA 21% para esos items, pero el cálculo de IVA crédito y costo merca queda en cero.
                {' '}
                <Link href="/stock/cargador-masivo" className="warn-link">Cargá los costos faltantes</Link>
              </div>
            </div>
          )}

          {/* HERO TRDTECH cyan palpitante */}
          <div className={`hero-trd ${calcActual.ganancia >= 0 ? 'hero-pos' : 'hero-neg'}`}>
            <div className="hero-orb orb-1" />
            <div className="hero-orb orb-2" />

            <div className="hero-row">
              <div className="hero-left">
                <div className="hero-label">
                  GANANCIA NETA · {labelPeriodo.toUpperCase()}
                  {period === 'hoy' && (
                    <span className="badge-live">
                      <span className="live-dot" />
                      EN VIVO
                    </span>
                  )}
                </div>
                <div className="hero-amount">{formatARSFullSigned(calcActual.ganancia)}</div>
                <div className="hero-sub">
                  después de IVA, comisiones, retenciones
                </div>
                <div className="hero-cambio">
                  {renderCambio(cambioGanancia, labelComparacion)}
                </div>
              </div>

              <div className="hero-right">
                <div className="hero-label-r">MARGEN REAL</div>
                <div className="hero-margen">
                  {calcActual.ingresosNetos > 0 ? `${calcActual.margen.toFixed(1)}%` : '—'}
                </div>
                <div className="hero-tag">{margenLabel}</div>
                <div className="hero-cambio">
                  {renderCambio(cambioMargen, labelComparacion)}
                </div>
              </div>
            </div>
          </div>

          {/* BREAKDOWN: 2 cuadros separados abajo */}
          <div className="breakdown-row">
            <div className="bk-card">
              <div className="bk-card-title">OPERATIVO (sin IVA)</div>
              <div className="bk-list">
                <div className="bk-row">
                  <span className="bk-label">Ingresos netos</span>
                  <span className="bk-value bk-value-pos">+{formatARS(calcActual.ingresosNetos)}</span>
                  <span className="bk-detail">{calcActual.ventas} {calcActual.ventas === 1 ? 'venta' : 'ventas'} · sin IVA</span>
                </div>
                <div className="bk-row">
                  <span className="bk-label">Costo merca</span>
                  <span className="bk-value">−{formatARS(calcActual.costoMerca)}</span>
                  <span className="bk-detail">
                    {calcActual.coberturaCosto < 100 ? (
                      <button className="link-btn" onClick={() => setConfigModalOpen(true)}>
                        cobertura {calcActual.coberturaCosto.toFixed(0)}%
                      </button>
                    ) : 'cobertura 100%'}
                  </span>
                </div>
                <div className="bk-row">
                  <span className="bk-label">Cargos ML</span>
                  <span className="bk-value">−{formatARS(calcActual.cargosML)}</span>
                  <span className="bk-detail">{calcActual.comisionPct.toFixed(1)}% sobre venta</span>
                </div>
                <div className="bk-row">
                  <span className="bk-label">Retenciones ML</span>
                  <span className="bk-value">−{formatARS(calcActual.retenciones)}</span>
                  <span className="bk-detail">IIBB + créd/déb</span>
                </div>
                <div className="bk-row">
                  <span className="bk-label">Bonificación envío</span>
                  <span className="bk-value bk-value-pos">+{formatARS(calcActual.bonificacionEnvio)}</span>
                  <span className="bk-detail">{calcActual.flexCount} ventas Flex</span>
                </div>
                <div className="bk-row">
                  <span className="bk-label">Publicidad</span>
                  <span className="bk-value">−{formatARS(calcActual.publicidad)}</span>
                  <span className="bk-detail">
                    <button className="link-btn" onClick={() => setAdsModalOpen(true)}>
                      {calcActual.publicidad === 0 ? 'cargar' : 'editar'}
                    </button>
                  </span>
                </div>
                <div className="bk-row">
                  <span className="bk-label">Gastos varios</span>
                  <span className="bk-value">−{formatARS(calcActual.gastosVarios)}</span>
                  <span className="bk-detail">
                    <button className="link-btn" onClick={() => setGastoModalOpen(true)}>
                      {calcActual.gastosVarios === 0 ? 'cargar' : 'editar'}
                    </button>
                  </span>
                </div>
                <div className="bk-row bk-row-total">
                  <span className="bk-label-total">= Ganancia operativa</span>
                  <span className={`bk-value-total ${calcActual.gananciaOperativa >= 0 ? 'bk-value-pos' : 'bk-value-neg'}`}>
                    {formatARSSigned(calcActual.gananciaOperativa)}
                  </span>
                  <span className="bk-detail">margen {calcActual.margenOperativo.toFixed(1)}%</span>
                </div>
              </div>
            </div>

            <div className="bk-card">
              <div className="bk-card-title">IVA (Resp. Inscripto)</div>
              <div className="bk-list">
                <div className="bk-row bk-row-iva">
                  <span className="bk-label">IVA débito</span>
                  <span className="bk-value">{formatARS(calcActual.ivaDebito)}</span>
                </div>
                <div className="bk-row bk-row-iva">
                  <span className="bk-label">IVA crédito</span>
                  <span className="bk-value bk-value-pos">−{formatARS(calcActual.ivaCredito)}</span>
                </div>
                <div className="bk-row bk-row-total bk-row-iva">
                  <span className="bk-label-total">
                    = {calcActual.ivaAPagar >= 0 ? 'IVA a pagar' : 'Saldo a favor'}
                  </span>
                  <span className={`bk-value-total ${calcActual.ivaAPagar > 0 ? 'bk-value-neg' : 'bk-value-pos'}`}>
                    {formatARSSigned(calcActual.ivaAPagar)}
                  </span>
                </div>
              </div>
              <div className="bk-card-hint">
                21% sobre el precio (cobrado al cliente) menos lo que pagaste de IVA al comprar la mercadería.
              </div>
            </div>
          </div>

          {/* MINI CARDS abajo */}
          <div className="mini-cards">
            <div className="mini-card">
              <div className="mini-label">VENTAS</div>
              <div className="mini-value">{calcActual.ventas}</div>
              <div className="mini-detail">{renderCambio(cambioVentas, labelComparacion)}</div>
            </div>
            <div className="mini-card">
              <div className="mini-label">UNIDADES</div>
              <div className="mini-value">{calcActual.unidades}</div>
              <div className="mini-detail">
                {calcActual.ventas > 0 ? `${(calcActual.unidades / calcActual.ventas).toFixed(1)} u/venta` : '—'}
              </div>
            </div>
            <div className="mini-card">
              <div className="mini-label">TICKET PROM.</div>
              <div className="mini-value">{formatARS(calcActual.ticketPromedio)}</div>
              <div className="mini-detail">por venta</div>
            </div>
            <div className="mini-card">
              <div className="mini-label">DÍAS ACTIVOS</div>
              <div className="mini-value">{calcActual.diasActivos} <span className="mini-fraction">/ {calcActual.diasTotales}</span></div>
              <div className="mini-detail">
                {calcActual.diasTotales > 0 ? `${((calcActual.diasActivos / calcActual.diasTotales) * 100).toFixed(0)}% del período` : '—'}
              </div>
            </div>
            <div className="mini-card">
              <div className="mini-label">MEJOR DÍA</div>
              <div className="mini-value">{calcActual.mejorDiaMonto > 0 ? formatARS(calcActual.mejorDiaMonto) : '—'}</div>
              <div className="mini-detail">{mejorDiaFormatted}</div>
            </div>
            <div className="mini-card">
              <div className="mini-label">ROAS</div>
              <div className={`mini-value ${calcActual.publicidad > 0 ? 'mini-roas' : 'mini-disabled'}`}>
                {calcActual.publicidad > 0 ? `×${calcActual.roas.toFixed(1)}` : '—'}
              </div>
              <div className="mini-detail">
                {calcActual.publicidad > 0 ? 'retorno sobre Ads' : 'sin Ads cargado'}
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
          iibbPct={0}
        />
      )}

      {adsModalOpen && <CargarAdsModal onClose={() => setAdsModalOpen(false)} />}
      {gastoModalOpen && <GastoRapidoModal onClose={() => setGastoModalOpen(false)} />}
      {configModalOpen && <ConfigModal onClose={() => setConfigModalOpen(false)} />}
      {calcOpen && <QuickCalc onClose={() => setCalcOpen(false)} />}

      <style jsx>{`
        .page { padding: 24px 40px 48px; max-width: 1500px; margin: 0 auto; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; gap: 16px; flex-wrap: wrap; }
        .header-title h1 { margin: 0 0 4px; font-size: 26px; font-weight: 600; color: var(--text-primary); letter-spacing: -0.3px; }
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

        .main-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--border-subtle); margin-bottom: 24px; }
        .main-tab {
          background: transparent; border: none; padding: 12px 18px; color: var(--text-muted);
          font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit;
          border-bottom: 2px solid transparent; margin-bottom: -1px; transition: all 0.15s ease;
        }
        .main-tab:hover { color: var(--text-secondary); }
        .main-tab.main-tab-active { color: #3ee5e0; border-bottom-color: #3ee5e0; }

        /* PERIOD TABS estilo botón cyan TRDTECH */
        .period-tabs {
          display: flex;
          gap: 10px;
          margin-bottom: 16px;
          flex-wrap: wrap;
        }
        .period-tab {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 10px 22px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
          background: linear-gradient(135deg, #0d4d6e 0%, #1ca0c4 100%);
          color: #ffffff;
          border: 1px solid rgba(62, 229, 224, 0.4);
          text-decoration: none;
          letter-spacing: 0.3px;
          transition: all 0.18s ease;
          box-shadow: 0 2px 10px rgba(28, 160, 196, 0.15);
          opacity: 0.55;
        }
        .period-tab:hover {
          opacity: 0.85;
          box-shadow: 0 4px 16px rgba(28, 160, 196, 0.3);
          transform: translateY(-1px);
        }
        .period-tab.period-active {
          opacity: 1;
          background: linear-gradient(135deg, #1ca0c4 0%, #3ee5e0 100%);
          color: #0a121c;
          border-color: rgba(62, 229, 224, 0.7);
          box-shadow: 0 4px 18px rgba(62, 229, 224, 0.35);
        }

        .warn-banner {
          display: flex; gap: 10px; align-items: flex-start;
          background: rgba(255, 167, 38, 0.08); border: 1px solid rgba(255, 167, 38, 0.3);
          border-radius: 10px; padding: 12px 16px; margin-bottom: 16px;
          font-size: 13px; line-height: 1.5; color: var(--text-secondary);
        }
        .warn-banner > span:first-child { font-size: 18px; flex-shrink: 0; }
        .warn-text strong { color: var(--warning); }
        .warn-link { color: var(--warning); font-weight: 600; }
        .warn-link:hover { text-decoration: underline; }

        /* HERO PALPITANTE */
        @keyframes palpitar-trd {
          0%, 100% {
            border-color: rgba(62, 229, 224, 0.25);
            box-shadow: 0 0 0 0 rgba(62, 229, 224, 0.15), 0 0 60px rgba(28, 160, 196, 0.06);
          }
          50% {
            border-color: rgba(62, 229, 224, 0.55);
            box-shadow: 0 0 0 4px rgba(62, 229, 224, 0.05), 0 0 80px rgba(28, 160, 196, 0.18);
          }
        }
        .hero-trd {
          position: relative;
          background: linear-gradient(135deg, rgba(13, 77, 110, 0.2) 0%, rgba(28, 160, 196, 0.06) 100%);
          border: 1px solid rgba(62, 229, 224, 0.3);
          border-radius: 18px;
          padding: 32px 36px;
          margin-bottom: 16px;
          overflow: hidden;
          animation: palpitar-trd 2.8s ease-in-out infinite;
        }
        .hero-neg {
          background: linear-gradient(135deg, rgba(127, 29, 29, 0.18) 0%, rgba(220, 38, 38, 0.06) 100%);
          animation: none;
          border-color: rgba(239, 68, 68, 0.35);
        }
        .hero-orb { position: absolute; border-radius: 50%; filter: blur(60px); pointer-events: none; }
        .orb-1 {
          background: rgba(28, 160, 196, 0.18);
          width: 220px; height: 220px;
          top: -50px; left: 30%;
        }
        .orb-2 {
          background: rgba(62, 229, 224, 0.12);
          width: 180px; height: 180px;
          bottom: -40px; right: 18%;
        }
        .hero-neg .orb-1 { background: rgba(239, 68, 68, 0.25); }
        .hero-neg .orb-2 { background: rgba(220, 38, 38, 0.18); }

        .hero-row {
          position: relative;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 24px;
          flex-wrap: wrap;
        }
        .hero-left { flex: 1; min-width: 260px; }
        .hero-label {
          display: flex; align-items: center; gap: 10px;
          font-size: 11px; letter-spacing: 1.5px; color: var(--text-muted);
          font-weight: 500; margin-bottom: 12px;
        }
        .badge-live {
          display: inline-flex; align-items: center; gap: 5px;
          background: rgba(239, 68, 68, 0.12); color: #f87171;
          border: 1px solid rgba(239, 68, 68, 0.3);
          padding: 3px 9px; border-radius: 12px;
          font-size: 9px; font-weight: 500; letter-spacing: 0.5px;
        }
        .live-dot {
          width: 6px; height: 6px; background: #f87171;
          border-radius: 50%; display: inline-block;
          animation: pulse-dot 2s ease-in-out infinite;
        }
        @keyframes pulse-dot { 50% { opacity: 0.4; } }

        .hero-amount {
          font-size: 52px;
          font-weight: 500;
          line-height: 1;
          color: #3ee5e0;
          font-variant-numeric: tabular-nums;
          letter-spacing: -1.2px;
          margin-bottom: 8px;
        }
        .hero-neg .hero-amount { color: #f87171; }
        .hero-sub {
          font-size: 12px;
          color: var(--text-muted);
          margin-bottom: 6px;
        }
        .hero-cambio {
          margin-top: 8px;
          font-size: 12px;
          font-weight: 500;
        }

        .hero-right { text-align: right; }
        .hero-label-r {
          font-size: 11px; letter-spacing: 1.5px;
          color: var(--text-muted); font-weight: 500;
        }
        .hero-margen {
          font-size: 38px;
          font-weight: 500;
          line-height: 1;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
          margin: 8px 0 6px;
        }
        .hero-tag {
          font-size: 11px;
          color: #3ee5e0;
          letter-spacing: 1px;
          font-weight: 500;
          margin-bottom: 8px;
        }
        .hero-neg .hero-tag { color: #f87171; }

        .cambio { font-size: 12px; font-weight: 500; }
        .cambio-good { color: var(--success); }
        .cambio-bad { color: var(--danger); }
        .cambio-flat { color: var(--text-muted); }

        /* BREAKDOWN: 2 cuadros separados abajo */
        .breakdown-row {
          display: grid;
          grid-template-columns: 1.6fr 1fr;
          gap: 16px;
          margin-bottom: 16px;
        }
        .bk-card {
          background: rgba(10, 18, 28, 0.6);
          border: 1px solid rgba(62, 229, 224, 0.12);
          border-radius: 14px;
          padding: 18px 22px;
        }
        .bk-card-title {
          font-size: 11px; letter-spacing: 1.2px;
          color: var(--text-muted); font-weight: 500;
          margin-bottom: 14px; padding-bottom: 8px;
          border-bottom: 1px solid rgba(62, 229, 224, 0.08);
        }
        .bk-list { display: flex; flex-direction: column; gap: 9px; }
        .bk-row {
          display: grid;
          grid-template-columns: 1fr auto 90px;
          align-items: baseline;
          gap: 16px;
        }
        .bk-row-iva {
          grid-template-columns: 1fr auto;
        }
        .bk-label { font-size: 13px; color: var(--text-secondary); }
        .bk-value {
          font-size: 14px;
          font-weight: 500;
          color: #cbd5e1;
          font-variant-numeric: tabular-nums;
          text-align: right;
          white-space: nowrap;
        }
        .bk-value-pos { color: #3ee5e0; }
        .bk-value-neg { color: #f87171; }
        .bk-detail {
          font-size: 10px;
          color: var(--text-muted);
          text-align: right;
        }

        .bk-row-total {
          margin-top: 4px;
          padding-top: 11px;
          border-top: 1px solid rgba(62, 229, 224, 0.12);
        }
        .bk-label-total {
          font-size: 13px;
          color: var(--text-primary);
          font-weight: 500;
        }
        .bk-value-total {
          font-size: 17px;
          font-weight: 500;
          font-variant-numeric: tabular-nums;
          text-align: right;
          white-space: nowrap;
          color: #cbd5e1;
        }

        .bk-card-hint {
          margin-top: 14px;
          padding-top: 12px;
          border-top: 1px solid rgba(62, 229, 224, 0.08);
          font-size: 11px;
          color: var(--text-muted);
          line-height: 1.5;
        }

        .link-btn {
          background: transparent; border: none; color: #1ca0c4; padding: 0;
          font-family: inherit; font-size: 10px; cursor: pointer; text-decoration: underline;
        }
        .link-btn:hover { color: #3ee5e0; }

        /* MINI CARDS */
        .mini-cards {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 10px;
        }
        .mini-card {
          background: rgba(13, 77, 110, 0.18);
          border: 1px solid rgba(62, 229, 224, 0.1);
          border-radius: 10px;
          padding: 12px 14px;
        }
        .mini-label {
          font-size: 10px;
          color: var(--text-muted);
          letter-spacing: 0.6px;
          font-weight: 500;
          margin-bottom: 4px;
        }
        .mini-value {
          font-size: 20px;
          font-weight: 500;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
          line-height: 1;
        }
        .mini-fraction {
          font-size: 13px;
          color: var(--text-muted);
          font-weight: 400;
        }
        .mini-detail {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 3px;
        }
        .mini-roas { color: #3ee5e0; }
        .mini-disabled { opacity: 0.4; }

        @media (max-width: 1300px) {
          .breakdown-row { grid-template-columns: 1fr; }
          .mini-cards { grid-template-columns: repeat(3, 1fr); }
        }
        @media (max-width: 768px) {
          .page { padding: 16px; }
          .header { flex-direction: column; align-items: stretch; }
          .header-title h1 { font-size: 22px; }
          .header-actions { display: grid; grid-template-columns: repeat(2, 1fr); }
          .btn-action { justify-content: center; }
          .period-tabs { display: grid; grid-template-columns: repeat(3, 1fr); }
          .period-tab { padding: 9px 6px; font-size: 12px; }
          .hero-trd { padding: 24px 20px; }
          .hero-row { flex-direction: column; }
          .hero-amount { font-size: 44px; }
          .hero-right { text-align: left; width: 100%; }
          .hero-margen { font-size: 30px; }
          .bk-card { padding: 16px 18px; }
          .bk-row { grid-template-columns: 1fr auto; }
          .bk-detail { display: none; }
          .mini-cards { grid-template-columns: repeat(2, 1fr); }
          .mini-value { font-size: 18px; }
        }
      `}</style>
    </div>
  )
}
