// app/lib/telegram.ts
// Helper para notificaciones de Telegram - TRDTECH ML Dashboard

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? ''
const API = `https://api.telegram.org/bot${BOT_TOKEN}`

const TZ = 'America/Argentina/Buenos_Aires'

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(n)
}

function logisticLabel(type: string | null): string {
  if (type === 'self_service') return '🛵 Flex'
  if (type === 'fulfillment') return '🏭 Full'
  if (type === 'cross_docking') return '🚚 Correo ML'
  return '📦 Envío'
}

export type DailyTotals = {
  totalHoy: number
  ventasHoy: number
  totalAyer: number
  ventasAyer: number
}

export async function tgNuevaVenta(
  order: any,
  netRecibido: number,
  logisticType: string | null,
  receiverAddress: string | null,
  itemTitle: string,
  itemQty: number,
  thumbnailUrl: string | null,
  daily: DailyTotals,
  margen: number | null,
): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return

  const pctVsAyer = daily.totalAyer > 0
    ? ((daily.totalHoy - daily.totalAyer) / daily.totalAyer * 100).toFixed(0)
    : null
  const tendencia = pctVsAyer !== null
    ? (Number(pctVsAyer) >= 0 ? `⬆️ +${pctVsAyer}%` : `⬇️ ${pctVsAyer}%`)
    : '—'

  const margenStr = margen !== null ? `📊 Margen: <b>${margen.toFixed(1)}%</b>\n` : ''
  const direccionStr = receiverAddress ? `📍 ${receiverAddress}\n` : ''

  const caption = [
    `🛍 <b>NUEVA VENTA</b>`,
    ``,
    `📦 <b>${itemTitle}</b>`,
    `🔢 Cantidad: ${itemQty} unidad${itemQty > 1 ? 'es' : ''}`,
    `${logisticLabel(logisticType)}`,
    direccionStr.trim() ? direccionStr.trim() : null,
    ``,
    `💰 Neto recibido: <b>${formatARS(netRecibido)}</b>`,
    margenStr.trim() ? margenStr.trim() : null,
    ``,
    `━━━━━━━━━━━━━━━━`,
    `📈 <b>HOY: ${formatARS(daily.totalHoy)}</b> · ${daily.ventasHoy} venta${daily.ventasHoy !== 1 ? 's' : ''}`,
    `   ${tendencia} vs ayer (${formatARS(daily.totalAyer)})`,
  ].filter(l => l !== null).join('\n')

  try {
    if (thumbnailUrl) {
      const res = await fetch(`${API}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          photo: thumbnailUrl,
          caption,
          parse_mode: 'HTML',
        }),
      })
      const data = await res.json()
      // Si la foto falla (URL inválida), mandamos solo texto
      if (!data.ok) {
        await tgSendMessage(caption)
      }
    } else {
      await tgSendMessage(caption)
    }
  } catch (e) {
    console.error('Telegram nueva venta error:', e)
  }
}

export async function tgCancelacion(
  order: any,
  itemTitle: string,
  totalAmount: number,
): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return

  const now = new Date().toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', timeZone: TZ,
  })

  const text = [
    `❌ <b>CANCELACIÓN</b> · ${now}`,
    ``,
    `📦 ${itemTitle}`,
    `💰 ${formatARS(totalAmount)}`,
    `🆔 Order #${order.id}`,
    `👤 ${order.buyer?.nickname ?? '—'}`,
  ].join('\n')

  await tgSendMessage(text)
}

export async function tgStockCritico(
  sellerSku: string,
  title: string,
  stockActual: number,
): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return

  const text = [
    `⚠️ <b>STOCK CRÍTICO</b>`,
    ``,
    `📦 ${title}`,
    `🏷️ SKU: <code>${sellerSku}</code>`,
    `🔢 Solo <b>${stockActual} unidad${stockActual !== 1 ? 'es' : ''}</b> restante${stockActual !== 1 ? 's' : ''}`,
    ``,
    `👉 Reponés antes de quedarte sin stock.`,
  ].join('\n')

  await tgSendMessage(text)
}

export async function tgSendMessage(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return
  try {
    await fetch(`${API}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: 'HTML',
      }),
    })
  } catch (e) {
    console.error('Telegram sendMessage error:', e)
  }
}