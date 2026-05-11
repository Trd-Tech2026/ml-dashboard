'use client'

import { useState } from 'react'

export type OrderItem = {
  item_id: string
  title: string
  quantity: number
  unit_price: number
}

export type FiscalBreakdown = {
  ingresosNetos: number
  costoMerca: number
  ivaDebito: number
  ivaCredito: number
  ivaAPagar: number
  cargosML: number
  cargosComision: number
  cargosCostoFijo: number
  cargosFinanciacion: number
  retenciones: number
  impCreditosDebitos: number
  impCreditosDebitosEnvio: number
  impIIBB: number
  bonificacionEnvio: number
  envioCobradoCliente: number
  costoFlexEstimado: number
  recibidoML: number
  recibidoNeto: number
  gananciaOperativa: number
  ganancia: number
  margen: number | null
  unidadesConCosto: number
  unidadesSinCosto: number
  costoCompleto: boolean
}

export type OrderWithItems = {
  order_id: number
  status: string
  total_amount: number
  currency: string
  buyer_nickname: string | null
  date_created: string
  marketplace_fee: number
  shipping_cost: number
  discounts: number
  net_received: number
  items: OrderItem[]
  fiscal?: FiscalBreakdown
}

type Props = {
  ordenes: OrderWithItems[]
  mostrarHora?: boolean
  timeZone?: string
}

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(n)
}

function formatARSSigned(n: number): string {
  const formatted = formatARS(Math.abs(n))
  return n < 0 ? `−${formatted}` : formatted
}

function colorStatus(status: string): string {
  if (status === 'paid') return '#4CAF50'
  if (status === 'cancelled') return '#f44336'
  return '#FF9800'
}

function resumirProductos(items: OrderItem[]): string {
  if (!items || items.length === 0) return '—'
  const primero = items[0]
  const titulo = `${primero.quantity}× ${primero.title}`
  if (items.length === 1) return titulo
  return titulo
}

function colorMargen(margen: number | null): string {
  if (margen == null) return 'var(--text-muted)'
  if (margen >= 20) return '#3ee5e0'
  if (margen >= 10) return '#22c55e'
  if (margen >= 0) return '#facc15'
  return '#f87171'
}

export default function VentasTabla({ ordenes, mostrarHora = true, timeZone = 'America/Argentina/Buenos_Aires' }: Props) {
  const [expandida, setExpandida] = useState<number | null>(null)

  const formatTiempo = (iso: string): string => {
    const d = new Date(iso)
    if (mostrarHora) {
      return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone })
    }
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone })
  }

  const toggle = (orderId: number) => setExpandida(prev => (prev === orderId ? null : orderId))

  if (ordenes.length === 0) {
    return <p className="vt-empty">No hay ventas en este período.</p>
  }

  return (
    <>
      {/* TABLA DESKTOP */}
      <div className="vt-tabla-desktop">
        <table>
          <thead>
            <tr>
              <th style={{ width: '32px' }}></th>
              <th>{mostrarHora ? 'Hora' : 'Fecha'}</th>
              <th>Order ID</th>
              <th>Comprador</th>
              <th>Producto</th>
              <th>Estado</th>
              <th style={{ textAlign: 'right' }}>Margen</th>
              <th style={{ textAlign: 'right' }}>Recibido ML</th>
              <th style={{ textAlign: 'right' }}>Recibido neto</th>
            </tr>
          </thead>
          <tbody>
            {ordenes.map((o) => {
              const isOpen = expandida === o.order_id
              const tieneVarios = (o.items?.length ?? 0) > 1
              const fiscal = o.fiscal
              const margen = fiscal?.margen ?? null
              const recibidoML = fiscal?.recibidoML ?? Number(o.net_received ?? 0)
              const recibidoNeto = fiscal?.recibidoNeto ?? Number(o.net_received ?? 0)

              // Lo que ML muestra en su panel = total cobrado - cargos ML - retenciones visibles (IIBB + créd/déb)
              const totalSegunML = fiscal
                ? o.total_amount - fiscal.cargosML - fiscal.impIIBB - fiscal.impCreditosDebitos
                : recibidoML

              // Hay gastos ocultos si hay bonificación, créd/déb envío o envío cobrado al cliente
              const hayGastosOcultos = fiscal
                ? (fiscal.bonificacionEnvio > 0 || fiscal.impCreditosDebitosEnvio > 0 || fiscal.envioCobradoCliente > 0)
                : false

              return (
                <>
                  <tr
                    key={o.order_id}
                    className={`vt-row ${isOpen ? 'vt-row-open' : ''}`}
                    onClick={() => toggle(o.order_id)}
                  >
                    <td className="vt-arrow-cell">
                      <span className={`vt-arrow ${isOpen ? 'vt-arrow-open' : ''}`}>▶</span>
                    </td>
                    <td>{formatTiempo(o.date_created)}</td>
                    <td className="vt-order-id">{o.order_id}</td>
                    <td>{o.buyer_nickname ?? '-'}</td>
                    <td className="vt-producto">
                      <span className="vt-producto-text">{resumirProductos(o.items)}</span>
                      {tieneVarios && <span className="vt-mas-chip">+{o.items.length - 1} más</span>}
                    </td>
                    <td>
                      <span className="vt-badge" style={{ backgroundColor: colorStatus(o.status) }}>
                        {o.status}
                      </span>
                    </td>
                    <td className="vt-margen" style={{ color: colorMargen(margen) }}>
                      {margen != null ? `${margen.toFixed(1)}%` : (
                        <span className="vt-margen-falta" title="Falta cargar el costo del producto">— falta costo</span>
                      )}
                    </td>
                    <td className="vt-recibido-ml">{formatARS(recibidoML)}</td>
                    <td className="vt-total">{formatARS(recibidoNeto)}</td>
                  </tr>
                  {isOpen && (
                    <tr key={`${o.order_id}-detail`} className="vt-detail-row">
                      <td colSpan={9}>
                        <div className="vt-detail">
                          <div className="vt-detail-title">Productos</div>
                          <table className="vt-subtabla">
                            <thead>
                              <tr>
                                <th style={{ width: '60px' }}>Cant.</th>
                                <th>Producto</th>
                                <th style={{ width: '160px' }}>SKU</th>
                                <th style={{ textAlign: 'right', width: '120px' }}>Precio unit.</th>
                                <th style={{ textAlign: 'right', width: '120px' }}>Subtotal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {o.items.map((item) => (
                                <tr key={`${o.order_id}-${item.item_id}`}>
                                  <td><strong>{item.quantity}×</strong></td>
                                  <td>{item.title}</td>
                                  <td className="vt-sku">{item.item_id}</td>
                                  <td style={{ textAlign: 'right' }}>{formatARS(Number(item.unit_price ?? 0))}</td>
                                  <td style={{ textAlign: 'right' }}>
                                    {formatARS(Number(item.unit_price ?? 0) * (item.quantity ?? 1))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          {/* DESGLOSE FISCAL COMPLETO */}
                          {fiscal && recibidoML > 0 && (
                            <div className="vt-fiscal-grid">

                              {/* ── OPERATIVO ── */}
                              <div className="vt-fiscal-block">
                                <div className="vt-fiscal-block-title">OPERATIVO</div>

                                {/* ── Subsección: Lo que muestra ML ── */}
                                <div className="vt-fiscal-subsection-label">
                                  <span className="vt-subsection-icon">📋</span> Lo que muestra ML
                                </div>

                                <div className="vt-fiscal-row">
                                  <span>Total cobrado al cliente</span>
                                  <span className="vt-fin-value">{formatARS(o.total_amount)}</span>
                                </div>

                                <div className="vt-fiscal-row vt-fin-deduct">
                                  <span>− Cargos ML</span>
                                  <span className="vt-fin-value">−{formatARS(fiscal.cargosML)}</span>
                                </div>
                                {fiscal.cargosComision > 0 && (
                                  <div className="vt-fiscal-row vt-fiscal-sub">
                                    <span>· Comisión</span>
                                    <span>−{formatARS(fiscal.cargosComision)}</span>
                                  </div>
                                )}
                                {fiscal.cargosCostoFijo > 0 && (
                                  <div className="vt-fiscal-row vt-fiscal-sub">
                                    <span>· Costo fijo</span>
                                    <span>−{formatARS(fiscal.cargosCostoFijo)}</span>
                                  </div>
                                )}
                                {fiscal.cargosFinanciacion > 0 && (
                                  <div className="vt-fiscal-row vt-fiscal-sub">
                                    <span>· Costo cuotas</span>
                                    <span>−{formatARS(fiscal.cargosFinanciacion)}</span>
                                  </div>
                                )}

                                {(fiscal.impIIBB > 0 || fiscal.impCreditosDebitos > 0) && (
                                  <>
                                    <div className="vt-fiscal-row vt-fin-deduct">
                                      <span>− Retenciones</span>
                                      <span className="vt-fin-value">−{formatARS(fiscal.impIIBB + fiscal.impCreditosDebitos)}</span>
                                    </div>
                                    {fiscal.impIIBB > 0 && (
                                      <div className="vt-fiscal-row vt-fiscal-sub">
                                        <span>· IIBB</span>
                                        <span>−{formatARS(fiscal.impIIBB)}</span>
                                      </div>
                                    )}
                                    {fiscal.impCreditosDebitos > 0 && (
                                      <div className="vt-fiscal-row vt-fiscal-sub">
                                        <span>· Créd/déb</span>
                                        <span>−{formatARS(fiscal.impCreditosDebitos)}</span>
                                      </div>
                                    )}
                                  </>
                                )}

                                {/* Subtotal ML visible */}
                                <div className="vt-fiscal-row vt-fin-subtotal-ml">
                                  <span>= Total según ML</span>
                                  <span className="vt-fin-value">{formatARS(totalSegunML)}</span>
                                </div>

                                {/* ── Subsección: Gastos ocultos ── */}
                                {hayGastosOcultos && (
                                  <>
                                    <div className="vt-fiscal-subsection-label vt-fiscal-subsection-oculto">
                                      <span className="vt-subsection-icon">🔍</span> Gastos ocultos (ML no muestra)
                                    </div>

                                    {fiscal.envioCobradoCliente > 0 && (
                                      <div className="vt-fiscal-row vt-fin-bonus">
                                        <span>+ Envío cobrado al cliente</span>
                                        <span className="vt-fin-value">+{formatARS(fiscal.envioCobradoCliente)}</span>
                                      </div>
                                    )}
                                    {fiscal.bonificacionEnvio > 0 && (
                                      <div className="vt-fiscal-row vt-fin-bonus">
                                        <span>+ Bonificación envío ML</span>
                                        <span className="vt-fin-value">+{formatARS(fiscal.bonificacionEnvio)}</span>
                                      </div>
                                    )}
                                    {fiscal.impCreditosDebitosEnvio > 0 && (
                                      <div className="vt-fiscal-row vt-fin-deduct vt-fin-oculto-item">
                                        <span>− Créd/déb envío</span>
                                        <span className="vt-fin-value">−{formatARS(fiscal.impCreditosDebitosEnvio)}</span>
                                      </div>
                                    )}
                                  </>
                                )}

                                {/* Recibido de ML */}
                                <div className="vt-fiscal-row vt-fin-total">
                                  <span>= Recibido (de ML)</span>
                                  <span className="vt-fin-value">{formatARS(fiscal.recibidoML)}</span>
                                </div>

                                {/* Costo Flex y Recibido NETO */}
                                {fiscal.costoFlexEstimado > 0 && (
                                  <>
                                    <div className="vt-fiscal-row vt-fin-deduct vt-fin-oculto">
                                      <span>− Costo Flex (estimado)</span>
                                      <span className="vt-fin-value">−{formatARS(fiscal.costoFlexEstimado)}</span>
                                    </div>
                                    <div className="vt-fiscal-row vt-fin-total vt-fin-total-real">
                                      <span>= Recibido NETO</span>
                                      <span className="vt-fin-value">{formatARS(fiscal.recibidoNeto)}</span>
                                    </div>
                                  </>
                                )}
                              </div>

                              {/* IVA */}
                              <div className="vt-fiscal-block">
                                <div className="vt-fiscal-block-title">IVA (Resp. Inscripto)</div>
                                <div className="vt-fiscal-row">
                                  <span>IVA débito (cobrado)</span>
                                  <span className="vt-fin-value">{formatARS(fiscal.ivaDebito)}</span>
                                </div>
                                <div className="vt-fiscal-row vt-fin-bonus">
                                  <span>− IVA crédito (pagado)</span>
                                  <span className="vt-fin-value">−{formatARS(fiscal.ivaCredito)}</span>
                                </div>
                                <div className="vt-fiscal-row vt-fin-total">
                                  <span>= {fiscal.ivaAPagar >= 0 ? 'IVA a pagar' : 'Saldo a favor'}</span>
                                  <span className={`vt-fin-value ${fiscal.ivaAPagar > 0 ? 'vt-val-neg' : 'vt-val-pos'}`}>
                                    {formatARSSigned(fiscal.ivaAPagar)}
                                  </span>
                                </div>
                              </div>

                              {/* RESULTADO */}
                              <div className="vt-fiscal-block vt-fiscal-block-result">
                                <div className="vt-fiscal-block-title">RESULTADO</div>
                                <div className="vt-fiscal-row">
                                  <span>Ingresos netos (sin IVA)</span>
                                  <span className="vt-fin-value">{formatARS(fiscal.ingresosNetos)}</span>
                                </div>
                                <div className="vt-fiscal-row vt-fin-deduct">
                                  <span>− Costo merca (sin IVA)</span>
                                  <span className="vt-fin-value">−{formatARS(fiscal.costoMerca)}</span>
                                </div>
                                {/* Impacto neto ML = cargos + retenciones - bonif */}
                                {(() => {
                                  const impactoNeto = fiscal.cargosML + fiscal.retenciones - fiscal.bonificacionEnvio
                                  return impactoNeto !== 0 ? (
                                    <>
                                      <div className="vt-fiscal-row vt-fin-deduct vt-fin-impacto-ml">
                                        <span>− Impacto neto ML</span>
                                        <span className="vt-fin-value">−{formatARS(impactoNeto)}</span>
                                      </div>
                                      <div className="vt-fiscal-row vt-fiscal-sub">
                                        <span>· Cargos ML</span>
                                        <span>−{formatARS(fiscal.cargosML)}</span>
                                      </div>
                                      {fiscal.bonificacionEnvio > 0 && (
                                        <div className="vt-fiscal-row vt-fiscal-sub vt-fiscal-sub-bonus">
                                          <span>· + Bonif. envío</span>
                                          <span>+{formatARS(fiscal.bonificacionEnvio)}</span>
                                        </div>
                                      )}
                                      {fiscal.retenciones > 0 && (
                                        <div className="vt-fiscal-row vt-fiscal-sub">
                                          <span>· Retenciones</span>
                                          <span>−{formatARS(fiscal.retenciones)}</span>
                                        </div>
                                      )}
                                    </>
                                  ) : null
                                })()}
                                {fiscal.costoFlexEstimado > 0 && (
                                  <div className="vt-fiscal-row vt-fin-deduct">
                                    <span>− Costo Flex</span>
                                    <span className="vt-fin-value">−{formatARS(fiscal.costoFlexEstimado)}</span>
                                  </div>
                                )}
                                <div className="vt-fiscal-row">
                                  <span>= Ganancia operativa</span>
                                  <span className={`vt-fin-value ${fiscal.gananciaOperativa >= 0 ? 'vt-val-pos' : 'vt-val-neg'}`}>
                                    {formatARSSigned(fiscal.gananciaOperativa)}
                                  </span>
                                </div>
                                <div className="vt-fiscal-row vt-fin-deduct">
                                  <span>− IVA a pagar</span>
                                  <span className="vt-fin-value">−{formatARS(fiscal.ivaAPagar)}</span>
                                </div>
                                <div className="vt-fiscal-row vt-fin-total vt-fiscal-final">
                                  <span>💰 Ganancia neta</span>
                                  <span className={`vt-fin-value ${fiscal.ganancia >= 0 ? 'vt-val-pos' : 'vt-val-neg'}`}>
                                    {formatARSSigned(fiscal.ganancia)}
                                  </span>
                                </div>
                                {fiscal.margen != null ? (
                                  <div className="vt-fiscal-row vt-fiscal-margen">
                                    <span>Margen real</span>
                                    <span style={{ color: colorMargen(fiscal.margen), fontWeight: 700 }}>
                                      {fiscal.margen.toFixed(1)}%
                                    </span>
                                  </div>
                                ) : (
                                  <div className="vt-fiscal-warning">
                                    ⚠️ Falta cargar el costo de {fiscal.unidadesSinCosto} {fiscal.unidadesSinCosto === 1 ? 'unidad' : 'unidades'}.
                                    Margen no calculable.
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                          {(!fiscal || recibidoML === 0) && o.status === 'paid' && (
                            <div className="vt-no-data">Datos financieros no disponibles para esta orden.</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* CARDS MOBILE */}
      <div className="vt-cards-mobile">
        {ordenes.map((o) => {
          const isOpen = expandida === o.order_id
          const tieneVarios = (o.items?.length ?? 0) > 1
          const fiscal = o.fiscal
          const margen = fiscal?.margen ?? null
          const recibidoML = fiscal?.recibidoML ?? Number(o.net_received ?? 0)
          const recibidoNeto = fiscal?.recibidoNeto ?? Number(o.net_received ?? 0)

          const totalSegunML = fiscal
            ? o.total_amount - fiscal.cargosML - fiscal.impIIBB - fiscal.impCreditosDebitos
            : recibidoML

          const hayGastosOcultos = fiscal
            ? (fiscal.bonificacionEnvio > 0 || fiscal.impCreditosDebitosEnvio > 0 || fiscal.envioCobradoCliente > 0)
            : false

          return (
            <div key={o.order_id} className={`vt-card ${isOpen ? 'vt-card-open' : ''}`}>
              <div className="vt-card-clickable" onClick={() => toggle(o.order_id)}>
                <div className="vt-card-row">
                  <span className="vt-card-hora">{formatTiempo(o.date_created)}</span>
                  <span className="vt-badge" style={{ backgroundColor: colorStatus(o.status) }}>
                    {o.status}
                  </span>
                </div>
                <div className="vt-card-comprador">{o.buyer_nickname ?? '-'}</div>
                <div className="vt-card-producto">
                  <span className={`vt-arrow-mobile ${isOpen ? 'vt-arrow-open' : ''}`}>▶</span>
                  <span className="vt-card-producto-text">{resumirProductos(o.items)}</span>
                  {tieneVarios && <span className="vt-mas-chip">+{o.items.length - 1}</span>}
                </div>
                <div className="vt-card-row">
                  <span className="vt-card-orderid">#{o.order_id}</span>
                  <span className="vt-card-margen" style={{ color: colorMargen(margen) }}>
                    {margen != null ? `${margen.toFixed(1)}%` : '—'}
                  </span>
                </div>
                <div className="vt-card-recibidos">
                  <div className="vt-card-recibido-item">
                    <span className="vt-card-recibido-label">Recibido ML</span>
                    <span className="vt-card-recibido-ml">{formatARS(recibidoML)}</span>
                  </div>
                  <div className="vt-card-recibido-item">
                    <span className="vt-card-recibido-label">Recibido neto</span>
                    <span className="vt-card-recibido-neto">{formatARS(recibidoNeto)}</span>
                  </div>
                </div>
              </div>
              {isOpen && (
                <div className="vt-card-detail">
                  <div className="vt-detail-title">Productos</div>
                  {o.items.map((item) => (
                    <div key={`${o.order_id}-${item.item_id}`} className="vt-card-item">
                      <div className="vt-card-item-row">
                        <strong>{item.quantity}×</strong>
                        <span className="vt-card-item-title">{item.title}</span>
                      </div>
                      <div className="vt-card-item-row vt-card-item-meta">
                        <span className="vt-sku">{item.item_id}</span>
                        <span>{formatARS(Number(item.unit_price ?? 0) * (item.quantity ?? 1))}</span>
                      </div>
                    </div>
                  ))}

                  {fiscal && recibidoML > 0 && (
                    <>
                      <div className="vt-fiscal-block">
                        <div className="vt-fiscal-block-title">OPERATIVO</div>

                        {/* Lo que muestra ML - mobile */}
                        <div className="vt-fiscal-subsection-label">
                          <span className="vt-subsection-icon">📋</span> Lo que muestra ML
                        </div>
                        <div className="vt-fiscal-row">
                          <span>Total cobrado</span>
                          <span className="vt-fin-value">{formatARS(o.total_amount)}</span>
                        </div>
                        <div className="vt-fiscal-row vt-fin-deduct">
                          <span>− Cargos ML</span>
                          <span className="vt-fin-value">−{formatARS(fiscal.cargosML)}</span>
                        </div>
                        {(fiscal.impIIBB > 0 || fiscal.impCreditosDebitos > 0) && (
                          <div className="vt-fiscal-row vt-fin-deduct">
                            <span>− Retenciones</span>
                            <span className="vt-fin-value">−{formatARS(fiscal.impIIBB + fiscal.impCreditosDebitos)}</span>
                          </div>
                        )}
                        <div className="vt-fiscal-row vt-fin-subtotal-ml">
                          <span>= Total según ML</span>
                          <span className="vt-fin-value">{formatARS(totalSegunML)}</span>
                        </div>

                        {/* Gastos ocultos - mobile */}
                        {hayGastosOcultos && (
                          <>
                            <div className="vt-fiscal-subsection-label vt-fiscal-subsection-oculto">
                              <span className="vt-subsection-icon">🔍</span> Gastos ocultos
                            </div>
                            {fiscal.envioCobradoCliente > 0 && (
                              <div className="vt-fiscal-row vt-fin-bonus">
                                <span>+ Envío cobrado</span>
                                <span className="vt-fin-value">+{formatARS(fiscal.envioCobradoCliente)}</span>
                              </div>
                            )}
                            {fiscal.bonificacionEnvio > 0 && (
                              <div className="vt-fiscal-row vt-fin-bonus">
                                <span>+ Bonif. envío ML</span>
                                <span className="vt-fin-value">+{formatARS(fiscal.bonificacionEnvio)}</span>
                              </div>
                            )}
                            {fiscal.impCreditosDebitosEnvio > 0 && (
                              <div className="vt-fiscal-row vt-fin-deduct vt-fin-oculto-item">
                                <span>− Créd/déb envío</span>
                                <span className="vt-fin-value">−{formatARS(fiscal.impCreditosDebitosEnvio)}</span>
                              </div>
                            )}
                          </>
                        )}

                        <div className="vt-fiscal-row vt-fin-total">
                          <span>= Recibido (ML)</span>
                          <span className="vt-fin-value">{formatARS(fiscal.recibidoML)}</span>
                        </div>
                        {fiscal.costoFlexEstimado > 0 && (
                          <>
                            <div className="vt-fiscal-row vt-fin-deduct vt-fin-oculto">
                              <span>− Costo Flex (est.)</span>
                              <span className="vt-fin-value">−{formatARS(fiscal.costoFlexEstimado)}</span>
                            </div>
                            <div className="vt-fiscal-row vt-fin-total vt-fin-total-real">
                              <span>= Recibido NETO</span>
                              <span className="vt-fin-value">{formatARS(fiscal.recibidoNeto)}</span>
                            </div>
                          </>
                        )}
                      </div>

                      <div className="vt-fiscal-block">
                        <div className="vt-fiscal-block-title">IVA</div>
                        <div className="vt-fiscal-row">
                          <span>IVA débito</span>
                          <span className="vt-fin-value">{formatARS(fiscal.ivaDebito)}</span>
                        </div>
                        <div className="vt-fiscal-row vt-fin-bonus">
                          <span>− IVA crédito</span>
                          <span className="vt-fin-value">−{formatARS(fiscal.ivaCredito)}</span>
                        </div>
                        <div className="vt-fiscal-row vt-fin-total">
                          <span>= IVA a pagar</span>
                          <span className="vt-fin-value">{formatARSSigned(fiscal.ivaAPagar)}</span>
                        </div>
                      </div>

                      <div className="vt-fiscal-block vt-fiscal-block-result">
                        <div className="vt-fiscal-block-title">RESULTADO</div>
                        <div className="vt-fiscal-row vt-fin-total vt-fiscal-final">
                          <span>💰 Ganancia neta</span>
                          <span className={`vt-fin-value ${fiscal.ganancia >= 0 ? 'vt-val-pos' : 'vt-val-neg'}`}>
                            {formatARSSigned(fiscal.ganancia)}
                          </span>
                        </div>
                        {fiscal.margen != null ? (
                          <div className="vt-fiscal-row vt-fiscal-margen">
                            <span>Margen real</span>
                            <span style={{ color: colorMargen(fiscal.margen), fontWeight: 700 }}>
                              {fiscal.margen.toFixed(1)}%
                            </span>
                          </div>
                        ) : (
                          <div className="vt-fiscal-warning">
                            ⚠️ Falta cargar costo de {fiscal.unidadesSinCosto} {fiscal.unidadesSinCosto === 1 ? 'unidad' : 'unidades'}.
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <style>{`
        /* TABLA DESKTOP */
        .vt-tabla-desktop table { width: 100%; border-collapse: collapse; }
        .vt-tabla-desktop thead tr {
          border-bottom: 2px solid rgba(62, 229, 224, 0.15);
          text-align: left;
        }
        .vt-tabla-desktop th {
          padding: 12px 8px;
          color: #ffffff;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.3px;
        }
        .vt-row {
          border-bottom: 1px solid rgba(62, 229, 224, 0.06);
          cursor: pointer;
          transition: background-color 0.12s;
        }
        .vt-row:hover { background-color: rgba(62, 229, 224, 0.04); }
        .vt-row-open { background-color: rgba(28, 160, 196, 0.08); }
        .vt-row-open:hover { background-color: rgba(28, 160, 196, 0.08); }
        .vt-tabla-desktop td {
          padding: 12px 8px;
          font-size: 14px;
          vertical-align: middle;
          color: var(--text-secondary);
        }
        .vt-arrow-cell { width: 32px; text-align: center; }
        .vt-arrow {
          display: inline-block;
          color: var(--text-muted);
          font-size: 11px;
          transition: transform 0.18s;
        }
        .vt-arrow-open { transform: rotate(90deg); color: #3ee5e0; }

        .vt-order-id { font-size: 13px; color: #ffffff; font-weight: 500; }
        .vt-producto {
          max-width: 280px;
          font-size: 13px;
          color: #ffffff;
          font-weight: 500;
        }
        .vt-producto-text {
          display: -webkit-box;
          -webkit-line-clamp: 1;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .vt-mas-chip {
          display: inline-block;
          background: rgba(62, 229, 224, 0.15);
          color: #3ee5e0;
          font-size: 11px;
          padding: 2px 7px;
          border-radius: 10px;
          margin-left: 6px;
          font-weight: 600;
          white-space: nowrap;
        }
        .vt-margen {
          text-align: right;
          font-weight: 700;
          font-size: 14px;
          font-variant-numeric: tabular-nums;
        }
        .vt-margen-falta {
          font-size: 11px;
          font-weight: 500;
          color: var(--text-muted);
          font-style: italic;
        }
        .vt-recibido-ml {
          text-align: right;
          font-weight: 500;
          color: var(--text-muted);
          font-variant-numeric: tabular-nums;
          font-size: 13px;
        }
        .vt-total {
          text-align: right;
          font-weight: 700;
          color: var(--text-primary);
          font-variant-numeric: tabular-nums;
        }
        .vt-badge {
          color: white;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: bold;
          display: inline-block;
        }

        .vt-detail-row { background-color: rgba(10, 18, 28, 0.4); }
        .vt-detail {
          padding: 16px 24px 20px;
          border-left: 3px solid #3ee5e0;
          margin: 4px 0 4px 16px;
        }
        .vt-detail-title {
          font-size: 11px;
          font-weight: 700;
          color: #3ee5e0;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          margin-bottom: 10px;
        }
        .vt-subtabla {
          width: 100%;
          border-collapse: collapse;
          background: rgba(13, 77, 110, 0.12);
          border: 1px solid rgba(62, 229, 224, 0.1);
          border-radius: 8px;
          overflow: hidden;
        }
        .vt-subtabla th {
          background: rgba(13, 77, 110, 0.2);
          padding: 8px 12px;
          font-size: 11px;
          font-weight: 600;
          color: #94e8e6;
          text-transform: uppercase;
          text-align: left;
          letter-spacing: 0.4px;
        }
        .vt-subtabla td {
          padding: 10px 12px;
          font-size: 13px;
          color: var(--text-secondary);
          border-top: 1px solid rgba(62, 229, 224, 0.06);
        }
        .vt-sku { font-family: monospace; font-size: 11px; color: var(--text-muted); }

        /* DESGLOSE FISCAL */
        .vt-fiscal-grid {
          margin-top: 16px;
          display: grid;
          grid-template-columns: 1.2fr 1fr 1.2fr;
          gap: 12px;
        }
        .vt-fiscal-block {
          background: rgba(10, 18, 28, 0.5);
          border: 1px solid rgba(62, 229, 224, 0.12);
          border-radius: 8px;
          padding: 12px 14px;
        }
        .vt-fiscal-block-result {
          background: rgba(28, 160, 196, 0.08);
          border-color: rgba(62, 229, 224, 0.25);
        }
        .vt-fiscal-block-title {
          font-size: 10px;
          letter-spacing: 1px;
          color: var(--text-muted);
          font-weight: 700;
          margin-bottom: 8px;
          padding-bottom: 6px;
          border-bottom: 1px solid rgba(62, 229, 224, 0.1);
        }
        .vt-fiscal-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 4px 0;
          font-size: 12px;
          color: var(--text-secondary);
        }
        .vt-fiscal-row.vt-fin-deduct { color: var(--text-secondary); }
        .vt-fiscal-row.vt-fin-bonus { color: #3ee5e0; }
        .vt-fiscal-row.vt-fin-oculto {
          color: #fbbf24;
          font-style: italic;
        }
        .vt-fiscal-row.vt-fin-oculto-item {
          color: #fb923c;
        }
        .vt-fiscal-row.vt-fin-impacto-ml {
          color: var(--text-secondary);
          font-style: italic;
        }
        .vt-fiscal-sub-bonus {
          color: #3ee5e0 !important;
        }
        .vt-fiscal-sub {
          padding: 2px 0 2px 12px;
          font-size: 11px;
          color: var(--text-muted);
        }
        .vt-fiscal-sub span:last-child { font-family: monospace; }
        .vt-fin-value {
          font-family: ui-sans-serif, system-ui, sans-serif;
          font-variant-numeric: tabular-nums;
          font-size: 13px;
          font-weight: 500;
        }

        /* Subsección labels */
        .vt-fiscal-subsection-label {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.6px;
          text-transform: uppercase;
          color: rgba(148, 232, 230, 0.7);
          margin: 10px 0 5px;
          padding: 4px 6px;
          background: rgba(62, 229, 224, 0.05);
          border-left: 2px solid rgba(62, 229, 224, 0.3);
          border-radius: 0 4px 4px 0;
        }
        .vt-fiscal-subsection-label:first-of-type {
          margin-top: 2px;
        }
        .vt-fiscal-subsection-oculto {
          color: rgba(251, 191, 36, 0.8);
          background: rgba(251, 191, 36, 0.05);
          border-left-color: rgba(251, 191, 36, 0.4);
        }
        .vt-subsection-icon {
          font-size: 11px;
        }

        /* Subtotal ML visible */
        .vt-fin-subtotal-ml {
          border-top: 1px dashed rgba(62, 229, 224, 0.2);
          margin-top: 4px;
          padding-top: 6px;
          font-weight: 600;
          color: rgba(148, 232, 230, 0.7);
          font-size: 12px;
          font-style: italic;
        }
        .vt-fin-subtotal-ml .vt-fin-value {
          font-size: 12px;
          color: rgba(148, 232, 230, 0.7);
        }

        .vt-fin-total {
          border-top: 1px solid rgba(62, 229, 224, 0.15);
          margin-top: 4px;
          padding-top: 8px;
          font-weight: 700;
          color: var(--text-primary);
          font-size: 13px;
        }
        .vt-fin-total .vt-fin-value { font-size: 14px; }
        .vt-fin-total-real {
          border-top: 2px solid #3ee5e0;
          margin-top: 6px;
          padding-top: 8px;
          color: #3ee5e0;
        }
        .vt-fin-total-real .vt-fin-value { color: #3ee5e0; font-size: 15px; font-weight: 700; }
        .vt-fiscal-final {
          margin-top: 6px;
          padding-top: 10px;
          font-size: 14px;
        }
        .vt-fiscal-final .vt-fin-value { font-size: 16px; }
        .vt-val-pos { color: #3ee5e0; }
        .vt-val-neg { color: #f87171; }
        .vt-fiscal-margen {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px dashed rgba(62, 229, 224, 0.15);
          font-size: 12px;
        }
        .vt-fiscal-warning {
          margin-top: 10px;
          padding: 8px 10px;
          background: rgba(255, 167, 38, 0.1);
          color: #fbbf24;
          border: 1px solid rgba(255, 167, 38, 0.25);
          border-radius: 6px;
          font-size: 11px;
          line-height: 1.4;
        }
        .vt-no-data {
          margin-top: 12px;
          padding: 8px 12px;
          background: rgba(255, 167, 38, 0.1);
          color: #fbbf24;
          border-radius: 6px;
          font-size: 12px;
          text-align: center;
        }
        .vt-empty { color: var(--text-muted); padding: 16px 0; margin: 0; }

        /* CARDS MOBILE */
        .vt-cards-mobile { display: none; }

        @media (max-width: 1400px) {
          .vt-producto { max-width: 200px; }
        }

        @media (max-width: 1300px) {
          .vt-fiscal-grid { grid-template-columns: 1fr 1fr; }
          .vt-fiscal-block-result { grid-column: 1 / -1; }
        }

        @media (max-width: 768px) {
          .vt-tabla-desktop { display: none; }
          .vt-cards-mobile { display: flex; flex-direction: column; gap: 10px; }
          .vt-card {
            background: var(--bg-card);
            border-radius: 10px;
            border: 1px solid var(--border-subtle);
            overflow: hidden;
          }
          .vt-card-open { border-color: #3ee5e0; }
          .vt-card-clickable { padding: 12px 14px; cursor: pointer; }
          .vt-card-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
          .vt-card-hora { font-size: 14px; font-weight: 700; color: var(--text-primary); }
          .vt-card-comprador { font-size: 13px; color: var(--text-secondary); margin: 6px 0; }
          .vt-card-producto {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            color: var(--text-primary);
            font-weight: 500;
            margin-bottom: 8px;
            background: rgba(62, 229, 224, 0.04);
            padding: 6px 10px;
            border-radius: 6px;
          }
          .vt-card-producto-text {
            flex: 1;
            display: -webkit-box;
            -webkit-line-clamp: 1;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          .vt-arrow-mobile {
            display: inline-block;
            color: var(--text-muted);
            font-size: 10px;
            transition: transform 0.18s;
          }
          .vt-card-orderid { font-size: 11px; color: var(--text-muted); }
          .vt-card-margen { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
          .vt-card-recibidos {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid rgba(62, 229, 224, 0.08);
          }
          .vt-card-recibido-item {
            display: flex;
            flex-direction: column;
            gap: 2px;
            flex: 1;
          }
          .vt-card-recibido-label {
            font-size: 10px;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.5px;
            font-weight: 600;
          }
          .vt-card-recibido-ml {
            font-size: 13px;
            color: var(--text-muted);
            font-variant-numeric: tabular-nums;
          }
          .vt-card-recibido-neto {
            font-size: 14px;
            color: #3ee5e0;
            font-weight: 700;
            font-variant-numeric: tabular-nums;
          }
          .vt-card-detail {
            padding: 12px 14px 14px;
            background: rgba(10, 18, 28, 0.3);
            border-top: 1px solid var(--border-subtle);
          }
          .vt-card-item { padding: 8px 0; border-bottom: 1px solid rgba(62, 229, 224, 0.06); }
          .vt-card-item:last-child { border-bottom: none; }
          .vt-card-item-row { display: flex; gap: 8px; align-items: flex-start; color: var(--text-secondary); }
          .vt-card-item-title { flex: 1; font-size: 13px; line-height: 1.3; }
          .vt-card-item-meta { justify-content: space-between; margin-top: 4px; font-size: 12px; color: var(--text-muted); }
          .vt-fiscal-grid { display: block; }
          .vt-fiscal-block { margin-top: 10px; }
        }
      `}</style>
    </>
  )
}
