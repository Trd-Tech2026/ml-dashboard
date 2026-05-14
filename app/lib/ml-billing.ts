/**
 * Cliente del Billing API de Mercado Libre.
 *
 * Endpoint: GET /billing/integration/periods/key/{key}/summary/details
 *           ?group=ML&document_type=BILL
 *
 * Recupera percepciones impositivas (IVA, IIBB por jurisdicción, Ganancias)
 * del período mensual de facturación y las agrega en un breakdown manejable.
 *
 * Caching:
 * - Período cerrado: cache eterno
 * - Período en curso: cache de 24 hs
 *
 * IMPORTANTE: El billing API tiene rate limit de 1 query/día/usuario.
 * Por eso siempre que se pueda, usar el cache.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

// ════════════════════════════════════════════════════════════════════
// TIPOS
// ════════════════════════════════════════════════════════════════════

export type PerceptionBreakdown = {
  period_key: string
  iva_credito_fiscal: number
  ganancias_pago_a_cuenta: number
  iibb_pago_a_cuenta_total: number
  iibb_por_jurisdiccion: Record<string, number>
  por_concepto: Record<string, number>
  sin_clasificar: Array<{ label: string; amount: number; type: string }>
  total_general: number
}

// ════════════════════════════════════════════════════════════════════
// MAPEO DE CÓDIGOS ML → CLASIFICACIÓN FISCAL
// ════════════════════════════════════════════════════════════════════
//
// CIVA = Percepción General IVA (3% sobre comisiones ML) → crédito fiscal IVA
// CIRE = Percepción Especial IVA RG 5319/2023 (1-8% sobre ventas) → crédito fiscal IVA
//        NOTA: a pesar del label "RG5319/2023" que suena a Ganancias,
//        la RG 5319 es de IVA. El monto recuperable es contra IVA débito.
//
// IBCF, IBCFME, CGMV   = IIBB CABA (3 alícuotas)
// IIBB, IIBBME         = IIBB Buenos Aires
// IBCO                 = IIBB Corrientes
// IBLP                 = IIBB La Pampa
// IBTU, CBTUPP, CIBT   = IIBB Tucumán
//
// Si en el futuro ML agrega códigos de Ganancias, agregarlos acá con
// tipo: 'ganancias'.

type PerceptionMapping = {
  tipo: 'iva' | 'iibb' | 'ganancias'
  jurisdiccion?: string
  label: string
}

export const PERCEPTION_CODES: Record<string, PerceptionMapping> = {
  // Percepciones IVA (créditos fiscales recuperables)
  CIVA: { tipo: 'iva', label: 'Percepción IVA Régimen General' },
  CIRE: { tipo: 'iva', label: 'Percepción Especial IVA RG 5319/2023' },

  // Percepciones IIBB por jurisdicción
  IBCF:   { tipo: 'iibb', jurisdiccion: 'CABA',         label: 'IIBB CABA s/cargos' },
  IBCFME: { tipo: 'iibb', jurisdiccion: 'CABA',         label: 'IIBB CABA s/envíos' },
  CGMV:   { tipo: 'iibb', jurisdiccion: 'CABA',         label: 'IIBB CABA s/venta CABA' },
  IIBB:   { tipo: 'iibb', jurisdiccion: 'Buenos Aires', label: 'IIBB Buenos Aires s/cargos' },
  IIBBME: { tipo: 'iibb', jurisdiccion: 'Buenos Aires', label: 'IIBB Buenos Aires s/envíos' },
  IBCO:   { tipo: 'iibb', jurisdiccion: 'Corrientes',   label: 'IIBB Corrientes' },
  IBLP:   { tipo: 'iibb', jurisdiccion: 'La Pampa',     label: 'IIBB La Pampa' },
  IBTU:   { tipo: 'iibb', jurisdiccion: 'Tucumán',      label: 'IIBB Tucumán s/cargos' },
  CBTUPP: { tipo: 'iibb', jurisdiccion: 'Tucumán',      label: 'IIBB Tucumán s/envíos' },
  CIBT:   { tipo: 'iibb', jurisdiccion: 'Tucumán',      label: 'IIBB Tucumán s/venta Tuc.' },
}

// ════════════════════════════════════════════════════════════════════
// HELPERS DE FECHAS
// ════════════════════════════════════════════════════════════════════

const TZ = 'America/Argentina/Buenos_Aires'

/** Devuelve la period_key del mes en curso (formato YYYY-MM-01) */
export function currentPeriodKey(): string {
  const ahora = new Date()
  const fechaAR = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora)
  const [yearStr, monthStr] = fechaAR.split('-')
  return `${yearStr}-${monthStr}-01`
}

/** Convierte una fecha a su period_key correspondiente */
export function periodKeyFromDate(date: Date): string {
  const fechaAR = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
  const [yearStr, monthStr] = fechaAR.split('-')
  return `${yearStr}-${monthStr}-01`
}

/** Detecta si un período ya cerró (su mes siguiente ya empezó) */
function isPeriodClosed(periodKey: string): boolean {
  const [yearStr, monthStr] = periodKey.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const nextMonth = new Date(Date.UTC(year, month, 1))  // mes + 1 (month es 1-indexed pero new Date espera 0-indexed, así que es exacto)
  return Date.now() >= nextMonth.getTime()
}

// ════════════════════════════════════════════════════════════════════
// OAUTH: refresh token
// ════════════════════════════════════════════════════════════════════

async function refreshMLToken(refreshToken: string): Promise<{
  access_token: string
  refresh_token: string
} | null> {
  try {
    const resp = await fetch('https://api.mercadolibre.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.ML_CLIENT_ID!,
        client_secret: process.env.ML_CLIENT_SECRET!,
        refresh_token: refreshToken,
      }),
    })
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  }
}

// ════════════════════════════════════════════════════════════════════
// FETCH AL BILLING API
// ════════════════════════════════════════════════════════════════════

/**
 * Llama al endpoint summary/details del billing API.
 * Requiere document_type=BILL (otros valores: CREDIT_NOTE).
 */
export async function fetchBillingSummary(
  token: string,
  periodKey: string,
  group: 'ML' | 'MP' = 'ML'
): Promise<any> {
  const url = `https://api.mercadolibre.com/billing/integration/periods/key/${periodKey}/summary/details?group=${group}&document_type=BILL`

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`ML billing API error ${resp.status}: ${errText}`)
  }
  return await resp.json()
}

// ════════════════════════════════════════════════════════════════════
// AGGREGATOR: convierte el response de ML en un PerceptionBreakdown
// ════════════════════════════════════════════════════════════════════

/**
 * Itera sobre bill_includes.charges[] y clasifica cada percepción.
 * Solo procesa charges con group_id = 19 (Impuestos) o 31 (Perc. Imp. MP).
 */
export function aggregatePerceptions(
  summaryResponse: any,
  periodKey: string
): PerceptionBreakdown {
  const breakdown: PerceptionBreakdown = {
    period_key: periodKey,
    iva_credito_fiscal: 0,
    ganancias_pago_a_cuenta: 0,
    iibb_pago_a_cuenta_total: 0,
    iibb_por_jurisdiccion: {},
    por_concepto: {},
    sin_clasificar: [],
    total_general: 0,
  }

  const charges = summaryResponse?.bill_includes?.charges ?? []

  for (const charge of charges) {
    const type = String(charge.type ?? '').toUpperCase()
    const amount = Number(charge.amount ?? 0)
    const groupId = Number(charge.group_id ?? 0)

    // Solo procesar percepciones (group_id 19 = Impuestos, 31 = Perc. Imp. MP)
    if (groupId !== 19 && groupId !== 31) continue
    if (amount === 0) continue

    const mapping = PERCEPTION_CODES[type]

    if (!mapping) {
      // Código de percepción desconocido — guardar para revisión
      breakdown.sin_clasificar.push({
        label: String(charge.label ?? ''),
        amount,
        type,
      })
      continue
    }

    // Sumar a por_concepto
    breakdown.por_concepto[type] = (breakdown.por_concepto[type] ?? 0) + amount

    // Clasificar por tipo fiscal
    if (mapping.tipo === 'iva') {
      breakdown.iva_credito_fiscal += amount
    } else if (mapping.tipo === 'iibb') {
      breakdown.iibb_pago_a_cuenta_total += amount
      const jurisdiccion = mapping.jurisdiccion ?? 'Sin jurisdicción'
      breakdown.iibb_por_jurisdiccion[jurisdiccion] =
        (breakdown.iibb_por_jurisdiccion[jurisdiccion] ?? 0) + amount
    } else if (mapping.tipo === 'ganancias') {
      breakdown.ganancias_pago_a_cuenta += amount
    }
  }

  // Total general (suma de los 3 grupos clasificados)
  breakdown.total_general =
    breakdown.iva_credito_fiscal +
    breakdown.iibb_pago_a_cuenta_total +
    breakdown.ganancias_pago_a_cuenta

  return breakdown
}

/** Stub para compatibilidad: agrega items de MP (igual lógica) */
export function aggregateMpItems(summaryResponse: any, periodKey: string): PerceptionBreakdown {
  return aggregatePerceptions(summaryResponse, periodKey)
}

/** Mergea dos breakdowns (útil si se traen ML y MP por separado) */
export function merge_breakdowns(a: PerceptionBreakdown, b: PerceptionBreakdown): PerceptionBreakdown {
  const merged: PerceptionBreakdown = {
    period_key: a.period_key,
    iva_credito_fiscal: a.iva_credito_fiscal + b.iva_credito_fiscal,
    ganancias_pago_a_cuenta: a.ganancias_pago_a_cuenta + b.ganancias_pago_a_cuenta,
    iibb_pago_a_cuenta_total: a.iibb_pago_a_cuenta_total + b.iibb_pago_a_cuenta_total,
    iibb_por_jurisdiccion: { ...a.iibb_por_jurisdiccion },
    por_concepto: { ...a.por_concepto },
    sin_clasificar: [...a.sin_clasificar, ...b.sin_clasificar],
    total_general: a.total_general + b.total_general,
  }
  for (const [j, v] of Object.entries(b.iibb_por_jurisdiccion)) {
    merged.iibb_por_jurisdiccion[j] = (merged.iibb_por_jurisdiccion[j] ?? 0) + v
  }
  for (const [c, v] of Object.entries(b.por_concepto)) {
    merged.por_concepto[c] = (merged.por_concepto[c] ?? 0) + v
  }
  return merged
}

// ════════════════════════════════════════════════════════════════════
// CACHE CON SUPABASE
// ════════════════════════════════════════════════════════════════════

const TTL_HOURS_PERIOD_OPEN = 24

/**
 * Obtiene el breakdown del período, usando cache si está fresco.
 * - Si el período está cerrado, cache eterno.
 * - Si está en curso, cache de 24 hs.
 * - forceRefresh = true ignora cache y hace fetch siempre.
 *
 * Refresca el access_token de ML proactivamente antes del fetch.
 */
export async function getCachedOrFetch(
  supabase: SupabaseClient,
  token: string,
  periodKey: string,
  forceRefresh: boolean = false
): Promise<PerceptionBreakdown> {
  // 1. Check cache
  if (!forceRefresh) {
    const { data: cached } = await supabase
      .from('ml_billing_periods')
      .select('*')
      .eq('period_key', periodKey)
      .maybeSingle()

    if (cached) {
      const status = cached.status
      const updatedAt = new Date(cached.updated_at).getTime()
      const ageHours = (Date.now() - updatedAt) / (1000 * 60 * 60)

      if (status === 'CLOSED') {
        return cached.breakdown as PerceptionBreakdown
      }
      if (status === 'OPEN' && ageHours < TTL_HOURS_PERIOD_OPEN) {
        return cached.breakdown as PerceptionBreakdown
      }
      // Si está expirado, sigue con el fetch
    }
  }

  // 2. Refresh proactivo del token desde la DB
  const { data: tokenRow } = await supabase
    .from('ml_tokens')
    .select('*')
    .neq('access_token', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let activeToken = token
  if (tokenRow?.refresh_token) {
    const refreshed = await refreshMLToken(tokenRow.refresh_token)
    if (refreshed?.access_token) {
      activeToken = refreshed.access_token
      // refresh_token rota en cada uso, hay que guardarlo
      if (refreshed.refresh_token) {
        try {
          await supabase.from('ml_tokens').update({
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token,
          }).eq('id', tokenRow.id)
        } catch (e) {
          console.error('Error actualizando token:', e)
        }
      }
    }
  }

  // 3. Fetch al billing API
  const summary = await fetchBillingSummary(activeToken, periodKey, 'ML')
  const breakdown = aggregatePerceptions(summary, periodKey)

  // 4. Guardar en cache
  const status = isPeriodClosed(periodKey) ? 'CLOSED' : 'OPEN'
  try {
    await supabase.from('ml_billing_periods').upsert({
      period_key: periodKey,
      breakdown: breakdown as any,
      status,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'period_key' })
  } catch (e) {
    console.error('Error guardando cache de billing:', e)
  }

  return breakdown
}