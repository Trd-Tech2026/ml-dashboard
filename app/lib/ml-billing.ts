/**
 * Cliente del Billing API de Mercado Libre.
 *
 * Prioridad de fuentes (en este orden):
 * 1. Manual override del usuario (tabla billing_manual_override)
 * 2. Endpoint API ML (summary/details con document_type=BILL)
 * 3. Fallback: mes anterior escalado por relación de facturación
 *
 * El override manual es preciso (viene del panel de ML). El endpoint es
 * preciso pero solo funciona para meses cerrados. El escalado es estimado.
 *
 * Caching:
 * - Período cerrado: cache eterno
 * - Período en curso: cache de 24 hs
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
  is_estimate?: boolean
  source_period_key?: string
  /** Origen del dato: 'API' (endpoint billing), 'MANUAL' (override usuario), 'ESCALADO' (fallback) */
  source?: 'API' | 'MANUAL' | 'ESCALADO'
}

// ════════════════════════════════════════════════════════════════════
// MAPEO DE CÓDIGOS
// ════════════════════════════════════════════════════════════════════

type PerceptionMapping = {
  tipo: 'iva' | 'iibb' | 'ganancias'
  jurisdiccion?: string
  label: string
}

export const PERCEPTION_CODES: Record<string, PerceptionMapping> = {
  CIVA: { tipo: 'iva', label: 'Percepción IVA Régimen General' },
  CIRE: { tipo: 'iva', label: 'Percepción Especial IVA RG 5319/2023' },
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

export function currentPeriodKey(): string {
  const ahora = new Date()
  const fechaAR = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora)
  const [yearStr, monthStr] = fechaAR.split('-')
  return `${yearStr}-${monthStr}-01`
}

export function periodKeyFromDate(date: Date): string {
  const fechaAR = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
  const [yearStr, monthStr] = fechaAR.split('-')
  return `${yearStr}-${monthStr}-01`
}

export function previousPeriodKey(periodKey: string): string {
  const [yearStr, monthStr] = periodKey.split('-')
  let year = Number(yearStr)
  let month = Number(monthStr) - 1
  if (month <= 0) { month = 12; year -= 1 }
  return `${year}-${String(month).padStart(2, '0')}-01`
}

function isPeriodClosed(periodKey: string): boolean {
  const [yearStr, monthStr] = periodKey.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const nextMonth = new Date(Date.UTC(year, month, 1))
  return Date.now() >= nextMonth.getTime()
}

function rangoIsoDelMes(periodKey: string): { desde: string; hasta: string } {
  const desde = new Date(`${periodKey}T00:00:00-03:00`).toISOString()
  const [yearStr, monthStr] = periodKey.split('-')
  let year = Number(yearStr)
  let month = Number(monthStr) + 1
  if (month > 12) { month = 1; year += 1 }
  const proximoPeriodKey = `${year}-${String(month).padStart(2, '0')}-01`
  const hasta = new Date(`${proximoPeriodKey}T00:00:00-03:00`).toISOString()
  return { desde, hasta }
}

// ════════════════════════════════════════════════════════════════════
// OAUTH
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

export async function fetchBillingSummary(
  token: string,
  periodKey: string,
  group: 'ML' | 'MP' = 'ML'
): Promise<any> {
  const url = `https://api.mercadolibre.com/billing/integration/periods/key/${periodKey}/summary/details?group=${group}&document_type=BILL`
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!resp.ok) {
    const errText = await resp.text()
    throw new Error(`ML billing API error ${resp.status}: ${errText}`)
  }
  return await resp.json()
}

// ════════════════════════════════════════════════════════════════════
// AGGREGATOR
// ════════════════════════════════════════════════════════════════════

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

    if (groupId !== 19 && groupId !== 31) continue
    if (amount === 0) continue

    const mapping = PERCEPTION_CODES[type]

    if (!mapping) {
      breakdown.sin_clasificar.push({
        label: String(charge.label ?? ''),
        amount, type,
      })
      continue
    }

    breakdown.por_concepto[type] = (breakdown.por_concepto[type] ?? 0) + amount

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

  breakdown.total_general =
    breakdown.iva_credito_fiscal +
    breakdown.iibb_pago_a_cuenta_total +
    breakdown.ganancias_pago_a_cuenta

  return breakdown
}

export function aggregateMpItems(summaryResponse: any, periodKey: string): PerceptionBreakdown {
  return aggregatePerceptions(summaryResponse, periodKey)
}

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
// CACHE
// ════════════════════════════════════════════════════════════════════

const TTL_HOURS_PERIOD_OPEN = 24

export async function getCachedOrFetch(
  supabase: SupabaseClient,
  token: string,
  periodKey: string,
  forceRefresh: boolean = false
): Promise<PerceptionBreakdown> {
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
    }
  }

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

  const summary = await fetchBillingSummary(activeToken, periodKey, 'ML')
  const breakdown = aggregatePerceptions(summary, periodKey)

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

// ════════════════════════════════════════════════════════════════════
// HELPERS PARA OVERRIDE Y ESCALADO
// ════════════════════════════════════════════════════════════════════

async function fetchManualOverride(
  supabase: any,
  periodKey: string
): Promise<{ percepciones_totales: number; updated_at: string } | null> {
  try {
    const { data } = await supabase
      .from('billing_manual_override')
      .select('percepciones_totales, updated_at')
      .eq('period_key', periodKey)
      .maybeSingle()
    if (!data) return null
    return {
      percepciones_totales: Number(data.percepciones_totales),
      updated_at: data.updated_at,
    }
  } catch (e) {
    console.error('Error fetchManualOverride:', e)
    return null
  }
}

/**
 * Devuelve los "Cargos pendientes de pago" cargados manualmente para el período.
 * Es un valor opcional que el usuario carga desde el panel de ML.
 * Se usa como gasto adicional del mes (típicamente publicidad, mantenimiento, etc.).
 */
export async function fetchCargosPendientesManual(
  supabase: any,
  periodKey?: string
): Promise<number> {
  try {
    const pk = periodKey ?? currentPeriodKey()
    const { data } = await supabase
      .from('billing_manual_override')
      .select('cargos_pendientes')
      .eq('period_key', pk)
      .maybeSingle()
    return data?.cargos_pendientes ? Number(data.cargos_pendientes) : 0
  } catch {
    return 0
  }
}

async function fetchFacturacionDePeriodo(
  supabase: any,
  periodKey: string
): Promise<number> {
  const { desde, hasta } = rangoIsoDelMes(periodKey)
  const { data } = await supabase
    .from('orders')
    .select('total_amount')
    .eq('status', 'paid')
    .gte('date_created', desde)
    .lt('date_created', hasta)
  if (!data) return 0
  return (data as any[]).reduce((s, o) => s + Number(o.total_amount ?? 0), 0)
}

/**
 * Toma un monto total manual y lo expande a un breakdown completo usando las
 * proporciones del mes anterior cerrado (% IVA, % IIBB por jurisdicción).
 */
function expandFromManualTotal(
  montoTotal: number,
  prevBd: PerceptionBreakdown,
  newPeriodKey: string
): PerceptionBreakdown {
  if (prevBd.total_general === 0) {
    // Sin referencia previa, todo va a IIBB (más conservador para no inflar IVA crédito)
    return {
      period_key: newPeriodKey,
      iva_credito_fiscal: 0,
      ganancias_pago_a_cuenta: 0,
      iibb_pago_a_cuenta_total: montoTotal,
      iibb_por_jurisdiccion: {},
      por_concepto: {},
      sin_clasificar: [],
      total_general: montoTotal,
      source: 'MANUAL',
      source_period_key: 'MANUAL',
    }
  }

  const propIva = prevBd.iva_credito_fiscal / prevBd.total_general
  const propIibb = prevBd.iibb_pago_a_cuenta_total / prevBd.total_general
  const propGan = prevBd.ganancias_pago_a_cuenta / prevBd.total_general

  const ivaCred = montoTotal * propIva
  const iibbTotal = montoTotal * propIibb
  const gan = montoTotal * propGan

  // Distribuir IIBB por jurisdicción según proporciones del mes anterior
  const iibbPorJur: Record<string, number> = {}
  if (prevBd.iibb_pago_a_cuenta_total > 0) {
    for (const [j, v] of Object.entries(prevBd.iibb_por_jurisdiccion)) {
      const propJur = v / prevBd.iibb_pago_a_cuenta_total
      iibbPorJur[j] = iibbTotal * propJur
    }
  }

  // Distribuir por_concepto proporcionalmente también (útil para UI)
  const porConcepto: Record<string, number> = {}
  if (prevBd.total_general > 0) {
    for (const [c, v] of Object.entries(prevBd.por_concepto)) {
      porConcepto[c] = (v / prevBd.total_general) * montoTotal
    }
  }

  return {
    period_key: newPeriodKey,
    iva_credito_fiscal: ivaCred,
    ganancias_pago_a_cuenta: gan,
    iibb_pago_a_cuenta_total: iibbTotal,
    iibb_por_jurisdiccion: iibbPorJur,
    por_concepto: porConcepto,
    sin_clasificar: [],
    total_general: montoTotal,
    source: 'MANUAL',
    source_period_key: prevBd.period_key,
  }
}

function scaleBreakdown(
  bd: PerceptionBreakdown,
  k: number,
  newPeriodKey: string
): PerceptionBreakdown {
  return {
    period_key: newPeriodKey,
    source_period_key: bd.period_key,
    iva_credito_fiscal: bd.iva_credito_fiscal * k,
    ganancias_pago_a_cuenta: bd.ganancias_pago_a_cuenta * k,
    iibb_pago_a_cuenta_total: bd.iibb_pago_a_cuenta_total * k,
    iibb_por_jurisdiccion: Object.fromEntries(
      Object.entries(bd.iibb_por_jurisdiccion).map(([j, v]) => [j, (v as number) * k])
    ),
    por_concepto: Object.fromEntries(
      Object.entries(bd.por_concepto).map(([c, v]) => [c, (v as number) * k])
    ),
    sin_clasificar: bd.sin_clasificar,
    total_general: bd.total_general * k,
    is_estimate: true,
    source: 'ESCALADO',
  }
}

// ════════════════════════════════════════════════════════════════════
// FETCH PRINCIPAL: con override manual + fallback escalado
// ════════════════════════════════════════════════════════════════════

/**
 * Devuelve el breakdown de percepciones del mes en curso, en este orden:
 *
 * 1. Si hay un override manual cargado → usar ese (expandido por proporciones del mes anterior).
 * 2. Si el endpoint API devuelve datos reales → usar esos.
 * 3. Si todo falla, escalar el mes anterior por relación de facturación.
 *
 * El campo `source` del breakdown indica de dónde vino el dato.
 */
export async function fetchBillingWithFallback(
  supabase: any
): Promise<PerceptionBreakdown | null> {
  try {
    const currentPK = currentPeriodKey()
    const prevPK = previousPeriodKey(currentPK)

    const { data: tokenData } = await supabase
      .from('ml_tokens')
      .select('*')
      .neq('access_token', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!tokenData) return null

    // Traer el breakdown del mes anterior (necesario para proporciones y escalado)
    let prevBd: PerceptionBreakdown | null = null
    try {
      prevBd = await getCachedOrFetch(supabase, tokenData.access_token, prevPK, false)
    } catch (e) {
      console.error('Error trayendo mes anterior:', e)
    }

    // 1. Manual override
    const override = await fetchManualOverride(supabase, currentPK)
    if (override && override.percepciones_totales > 0) {
      if (prevBd && prevBd.total_general > 0) {
        return expandFromManualTotal(override.percepciones_totales, prevBd, currentPK)
      }
      // Sin referencia previa, todo a IIBB como heurística conservadora
      return expandFromManualTotal(override.percepciones_totales, {
        period_key: prevPK,
        iva_credito_fiscal: 0,
        ganancias_pago_a_cuenta: 0,
        iibb_pago_a_cuenta_total: 0,
        iibb_por_jurisdiccion: {},
        por_concepto: {},
        sin_clasificar: [],
        total_general: 0,
      }, currentPK)
    }

    // 2. Endpoint API ML para mes en curso (puede venir vacío si aún no se cerró)
    try {
      const currentBd = await getCachedOrFetch(supabase, tokenData.access_token, currentPK, false)
      if (currentBd && currentBd.total_general > 0) {
        return { ...currentBd, source: 'API' }
      }
    } catch (e) {
      console.error('Error API mes en curso:', e)
    }

    // 3. Escalado heurístico desde el mes anterior
    if (!prevBd || prevBd.total_general === 0) return null

    const [factCurrent, factPrev] = await Promise.all([
      fetchFacturacionDePeriodo(supabase, currentPK),
      fetchFacturacionDePeriodo(supabase, prevPK),
    ])
    if (factPrev === 0) return null

    const k = factCurrent / factPrev
    return scaleBreakdown(prevBd, k, currentPK)
  } catch (e) {
    console.error('Error en fetchBillingWithFallback:', e)
    return null
  }
}