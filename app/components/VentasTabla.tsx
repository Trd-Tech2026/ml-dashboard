'use client'

import { useState } from 'react'

// ===== Tipos =====
export type OrderItem = {
  item_id: string
  title: string
  quantity: number
  unit_price: number
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
}

type Props = {
  ordenes: OrderWithItems[]
  /** Si es true, muestra HORA. Si es false, muestra FECHA. */
  mostrarHora?: boolean
  /** Zona horaria a usar para formatear hora/fecha */
  timeZone?: string
}

// ===== Helpers =====
function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  }).format(n)
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

// ===== Componente =====
export default function VentasTabla({ ordenes, mostrarHora = true, timeZone = 'America/Argentina/Buenos_Aires' }: Props) {
  const [expandida, setExpandida] = useState<number | null>(null)

  const formatTiempo = (iso: string): string => {
    const d = new Date(iso)
    if (mostrarHora) {
      return d.toLocaleTimeString('es-AR', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone,
      })
    }
    return d.toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone,
    })
  }

  const toggle = (orderId: number) => {
    setExpandida(prev => (prev === orderId ? null : orderId))
  }

  if (ordenes.length === 0) {
    return <p className="vt-empty">No hay ventas en este período.</p>
  }

  return (
    <>
      {/* Tabla desktop */}
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
              <th style={{ textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {ordenes.map((o) => {
              const isOpen = expandida === o.order_id
              const tieneVarios = (o.items?.length ?? 0) > 1
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
                    <td className="vt-total">{formatARS(Number(o.total_amount ?? 0))}</td>
                  </tr>
                  {isOpen && (
                    <tr key={`${o.order_id}-detail`} className="vt-detail-row">
                      <td colSpan={7}>
                        <div className="vt-detail">
                          <div className="vt-detail-title">Productos de esta venta</div>
                          <table className="vt-subtabla">
                            <thead>
                              <tr>
                                <th style={{ width: '60px' }}>Cant.</th>
                                <th>Producto</th>
                                <th style={{ width: '120px' }}>SKU</th>
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

                          {/* Desglose financiero */}
                          {o.net_received > 0 && (
                            <div className="vt-financial">
                              <div className="vt-financial-row">
                                <span className="vt-fin-label">Total cobrado al comprador</span>
                                <span className="vt-fin-value">{formatARS(o.total_amount)}</span>
                              </div>
                              {o.marketplace_fee > 0 && (
                                <div className="vt-financial-row vt-fin-deduct">
                                  <span className="vt-fin-label">— Comisión ML + impuestos</span>
                                  <span className="vt-fin-value">−{formatARS(o.marketplace_fee)}</span>
                                </div>
                              )}
                              {o.shipping_cost > 0 && (
                                <div className="vt-financial-row vt-fin-deduct">
                                  <span className="vt-fin-label">— Costo de envío</span>
                                  <span className="vt-fin-value">−{formatARS(o.shipping_cost)}</span>
                                </div>
                              )}
                              {o.discounts > 0 && (
                                <div className="vt-financial-row vt-fin-bonus">
                                  <span className="vt-fin-label">+ Descuentos y bonificaciones</span>
                                  <span className="vt-fin-value">+{formatARS(o.discounts)}</span>
                                </div>
                              )}
                              <div className="vt-financial-row vt-fin-total">
                                <span className="vt-fin-label">💰 Recibís</span>
                                <span className="vt-fin-value">{formatARS(o.net_received)}</span>
                              </div>
                            </div>
                          )}
                          {o.net_received === 0 && o.status === 'paid' && (
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

      {/* Cards mobile */}
      <div className="vt-cards-mobile">
        {ordenes.map((o) => {
          const isOpen = expandida === o.order_id
          const tieneVarios = (o.items?.length ?? 0) > 1
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
                  <span className="vt-card-total">{formatARS(Number(o.total_amount ?? 0))}</span>
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
                  {/* Desglose financiero mobile */}
                  {o.net_received > 0 && (
                    <div className="vt-financial">
                      <div className="vt-financial-row">
                        <span className="vt-fin-label">Total</span>
                        <span className="vt-fin-value">{formatARS(o.total_amount)}</span>
                      </div>
                      {o.marketplace_fee > 0 && (
                        <div className="vt-financial-row vt-fin-deduct">
                          <span className="vt-fin-label">— ML + impuestos</span>
                          <span className="vt-fin-value">−{formatARS(o.marketplace_fee)}</span>
                        </div>
                      )}
                      {o.shipping_cost > 0 && (
                        <div className="vt-financial-row vt-fin-deduct">
                          <span className="vt-fin-label">— Envío</span>
                          <span className="vt-fin-value">−{formatARS(o.shipping_cost)}</span>
                        </div>
                      )}
                      {o.discounts > 0 && (
                        <div className="vt-financial-row vt-fin-bonus">
                          <span className="vt-fin-label">+ Bonificaciones</span>
                          <span className="vt-fin-value">+{formatARS(o.discounts)}</span>
                        </div>
                      )}
                      <div className="vt-financial-row vt-fin-total">
                        <span className="vt-fin-label">💰 Recibís</span>
                        <span className="vt-fin-value">{formatARS(o.net_received)}</span>
                      </div>
                    </div>
                  )}
                  {o.net_received === 0 && o.status === 'paid' && (
                    <div className="vt-no-data">Datos financieros no disponibles.</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <style>{`
        /* ===== TABLA DESKTOP ===== */
        .vt-tabla-desktop table {
          width: 100%;
          border-collapse: collapse;
        }
        .vt-tabla-desktop thead tr {
          border-bottom: 2px solid #eee;
          text-align: left;
        }
        .vt-tabla-desktop th {
          padding: 12px 8px;
          color: #666;
          font-size: 13px;
        }
        .vt-row {
          border-bottom: 1px solid #f0f0f0;
          cursor: pointer;
          transition: background-color 0.12s;
        }
        .vt-row:hover {
          background-color: #fafafa;
        }
        .vt-row-open {
          background-color: #f5f9ff;
        }
        .vt-row-open:hover {
          background-color: #f5f9ff;
        }
        .vt-tabla-desktop td {
          padding: 12px 8px;
          font-size: 14px;
          vertical-align: middle;
        }
        .vt-arrow-cell {
          width: 32px;
          text-align: center;
        }
        .vt-arrow {
          display: inline-block;
          color: #999;
          font-size: 11px;
          transition: transform 0.18s;
        }
        .vt-arrow-open {
          transform: rotate(90deg);
          color: #2196F3;
        }
        .vt-order-id {
          font-size: 13px;
          color: #666;
        }
        .vt-producto {
          max-width: 320px;
          font-size: 13px;
          color: #333;
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
          background: #e3f2fd;
          color: #1565c0;
          font-size: 11px;
          padding: 2px 7px;
          border-radius: 10px;
          margin-left: 6px;
          font-weight: 600;
          white-space: nowrap;
        }
        .vt-total {
          text-align: right;
          font-weight: bold;
        }
        .vt-badge {
          color: white;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: bold;
          display: inline-block;
        }
        .vt-detail-row {
          background-color: #fafbfc;
        }
        .vt-detail {
          padding: 16px 24px 20px;
          border-left: 3px solid #2196F3;
          margin: 4px 0 4px 16px;
        }
        .vt-detail-title {
          font-size: 12px;
          font-weight: 700;
          color: #555;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 10px;
        }
        .vt-subtabla {
          width: 100%;
          border-collapse: collapse;
          background: white;
          border-radius: 6px;
          overflow: hidden;
        }
        .vt-subtabla th {
          background: #f5f5f5;
          padding: 8px 12px;
          font-size: 11px;
          font-weight: 600;
          color: #666;
          text-transform: uppercase;
          text-align: left;
          letter-spacing: 0.4px;
        }
        .vt-subtabla td {
          padding: 10px 12px;
          font-size: 13px;
          border-top: 1px solid #f0f0f0;
        }
        .vt-sku {
          font-family: monospace;
          font-size: 11px;
          color: #888;
        }

        /* Desglose financiero (Recibís) */
        .vt-financial {
          margin-top: 14px;
          background: white;
          border: 1px solid #e5e5e5;
          border-radius: 8px;
          padding: 12px 16px;
        }
        .vt-financial-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 0;
          font-size: 13px;
          color: #555;
        }
        .vt-financial-row.vt-fin-deduct {
          color: #d32f2f;
        }
        .vt-financial-row.vt-fin-bonus {
          color: #2e7d32;
        }
        .vt-financial-row.vt-fin-total {
          border-top: 2px solid #f0f0f0;
          margin-top: 4px;
          padding-top: 10px;
          font-weight: 700;
          color: #2e7d32;
          font-size: 15px;
        }
        .vt-fin-label {
          flex: 1;
        }
        .vt-fin-value {
          font-family: monospace;
          font-size: 14px;
        }
        .vt-fin-total .vt-fin-value {
          font-size: 16px;
        }
        .vt-no-data {
          margin-top: 12px;
          padding: 8px 12px;
          background: #fff3e0;
          color: #e65100;
          border-radius: 6px;
          font-size: 12px;
          text-align: center;
        }

        .vt-empty {
          color: #999;
          padding: 16px 0;
          margin: 0;
        }

        /* ===== CARDS MOBILE ===== */
        .vt-cards-mobile {
          display: none;
        }

        @media (max-width: 768px) {
          .vt-tabla-desktop {
            display: none;
          }
          .vt-cards-mobile {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          .vt-card {
            background-color: #fafafa;
            border-radius: 10px;
            border: 1px solid #eee;
            overflow: hidden;
          }
          .vt-card-open {
            border-color: #2196F3;
          }
          .vt-card-clickable {
            padding: 12px 14px;
            cursor: pointer;
          }
          .vt-card-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .vt-card-hora {
            font-size: 14px;
            font-weight: bold;
            color: #333;
          }
          .vt-card-comprador {
            font-size: 14px;
            color: #555;
            margin: 6px 0;
          }
          .vt-card-producto {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            color: #333;
            margin-bottom: 8px;
            background: white;
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
            color: #999;
            font-size: 10px;
            transition: transform 0.18s;
          }
          .vt-card-orderid {
            font-size: 12px;
            color: #999;
          }
          .vt-card-total {
            font-size: 15px;
            font-weight: bold;
            color: #333;
          }
          .vt-card-detail {
            padding: 12px 14px 14px;
            background: white;
            border-top: 1px solid #eee;
          }
          .vt-card-item {
            padding: 8px 0;
            border-bottom: 1px solid #f5f5f5;
          }
          .vt-card-item:last-child {
            border-bottom: none;
          }
          .vt-card-item-row {
            display: flex;
            gap: 8px;
            align-items: flex-start;
          }
          .vt-card-item-title {
            flex: 1;
            font-size: 13px;
            color: #333;
            line-height: 1.3;
          }
          .vt-card-item-meta {
            justify-content: space-between;
            margin-top: 4px;
            font-size: 12px;
            color: #888;
          }
        }
      `}</style>
    </>
  )
}