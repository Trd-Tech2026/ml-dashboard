// app/lib/ml-billing.ts
//
// Cliente del Billing API de Mercado Libre.
// Captura percepciones mensuales (IVA, IIBB por jurisdicción, Ganancias)
// que NO aparecen en los charges_details de MP por payment.

import type { SupabaseClient } from '@supabase/supabase-js'

// =============================================================================
// Mapeo de códigos de percepción → categoría estructurada
// =============================================================================
// Estos códigos coinciden con los nombres de archivo del reporte ZIP de ML.

type PerceptionMeta = {
  label: string
  tipo: 'IVA' | 'Ganancias' | 'IIBB'
  jurisdiccion: string
  naturaleza:
    | 'credito_fiscal_iva'
    | 'pago_a_cuenta_ganancias'
    | 'pago_a_cuenta_iibb'
}

export const PERCEPTION_CODES: Record<string, PerceptionMeta> = {
  // IVA Nacional
  CIVA:   { label: 'Percepción IVA Régimen General',          tipo: 'IVA',       jurisdiccion: 'Nacional',     naturaleza: 'credito_fiscal_iva' },
  // Ganancias Nacional (RG AFIP régimen especial)
  CIRE:   { label: 'Percepción Ganancias Régimen Especial',   tipo: 'Ganancias', jurisdiccion: 'Nacional',     naturaleza: 'pago_a_cuenta_ganancias' },
  // IIBB CABA
  IBCF:   { label: 'Percepción IIBB CABA s/cargos',           tipo: 'IIBB',      jurisdiccion: 'CABA',         naturaleza: 'pago_a_cuenta_iibb' },
  IBCFME: { label: 'Percepción IIBB CABA s/envíos',           tipo: 'IIBB',      jurisdiccion: 'CABA',         naturaleza: 'pago_a_cuenta_iibb' },
  CGMV:   { label: 'Percepción IIBB CABA s/venta a comp CABA',tipo: 'IIBB',      jurisdiccion: 'CABA',         naturaleza: 'pago_a_cuenta_iibb' },
  // IIBB Buenos Aires
  IIBB:   { label: 'Percepción IIBB Buenos Aires s/cargos',   tipo: 'IIBB',      jurisdiccion: 'Buenos Aires', naturaleza: 'pago_a_cuenta_iibb' },
  IIBBME: { label: 'Percepción IIBB Buenos Aires s/envíos',   tipo: 'IIBB',      jurisdiccion: 'Buenos Aires', naturaleza: 'pago_a_cuenta_iibb' },
  // IIBB otras provincias
  IBCO:   { label: 'Percepción IIBB Corrientes',              tipo: 'IIBB',      jurisdiccion: 'Corrientes',   naturaleza: 'pago_a_cuenta_iibb' },
  IBLP:   { label: 'Percepción IIBB La Pampa',                tipo: 'IIBB',      jurisdiccion: 'La Pampa',     naturaleza: 'pago_a_cuenta_iibb' },
  IBTU:   { label: 'Percepción IIBB Tucumán s/cargos',        tipo: 'IIBB',      jurisdiccion: 'Tucumán',      naturaleza: 'pago_a_cuenta_iibb' },
  CBTUPP: { label: 'Percepción IIBB Tucumán s/envíos',        tipo: 'IIBB',      jurisdiccion: 'Tucumán',      naturaleza: 'pago_a_cuenta_iibb' },
  CIBT:   { label: 'Percepción IIBB Tucumán s/venta a comp Tuc.',tipo: 'IIBB',   jurisdiccion: 'Tucumán',      naturaleza: 'pago_a_cuenta_iibb' },
}

// Reglas de clasificación por substring del label.
// Orden CRÍTICO: las reglas más específicas (con subtipo "venta"/"envíos") deben
// estar antes que las genéricas, para que un label como
// "Percepción IIBB CABA s/envíos" matchee IBCFME y no IBCF.
const LABEL_RULES: Array<{ jurisdiccion: string; subtipo?: string; code: string }> = [
  { jurisdiccion: 'IVA',          code: 'CIVA' },
  { jurisdiccion: 'Ganancias',    code: 'CIRE' },
  // CABA — específicos primero
  { jurisdiccion: 'CABA',         subtipo: 'venta',  code: 'CGMV' },
  { jurisdiccion: 'CABA',         subtipo: 'envío',  code: 'IBCFME' },
  { jurisdiccion: 'CABA',                            code: 'IBCF' },
  // Buenos Aires
  { jurisdiccion: 'Buenos Aires', subtipo: 'envío',  code: 'IIBBME' },
  { jurisdiccion: 'Buenos Aires',                    code: 'IIBB' },
  // Tucumán
  { jurisdiccion: 'Tucumán',      subtipo: 'venta',  code: 'CIBT' },
  { jurisdiccion: 'Tucumán',      subtipo: 'envío',  code: 'CBTUPP' },
  { jurisdiccion: 'Tucumán',                         code: 'IBTU' },
  // Otras (una sola variante)
  { jurisdiccion: 'Corrientes',                      code: 'IBCO' },
  { jurisdiccion: 'La Pampa',                        code: 'IBLP' },
]

function classifyLabel(label: string): string | null {
  if (!label) return null
  const text = label.toLowerCase()
  for (const rule of LABEL_RULES) {
    if (!text.includes(rule.jurisdiccion.toLowerCase())) continue
    if (rule.subtipo && !text.includes(rule.subtipo.toLowerCase())) continue
    return rule.code
  }
  return null
}

// =============================================================================
// Tipos del breakdown que vamos a consumir desde rentabilidad
// =============================================================================

export type PerceptionBreakdown = {
  period_key: string                              // 'YYYY-MM-01'
  iva_credito_fiscal: number                      // recuperable en DDJJ IVA
  ganancias_pago_a_cuenta: number                 // recuperable en DDJJ Ganancias anual
  iibb_pago_a_cuenta_total: number                // suma de todas las jurisdicciones
  iibb_por_jurisdiccion: Record<string, number>   // detalle
  por_concepto: Record<string, number>            // breakdown por código
  sin_clasificar: Array<{ label: string; amount: number }>
  total_general: number                           // suma de todo lo fiscal
}

// =============================================================================
// Llamadas a la API de ML
// =============================================================================

const ML_BASE = 'https://api.mercadolibre.com'

export async function fetchBillingSummary(
  token: string,
  periodKey: string,
  group: 'ML' | 'MP' = 'ML'
): Promise<any> {
  const url = `${ML_BASE}/billing/integration/periods/key/${periodKey}/summary/details?group=${group}&document_type=BILL`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new Error(`ML billing summary ${res.status}: ${await res.text()}`)
  }
  return await res.json()
}

// =============================================================================
// Agregador: procesa la respuesta y devuelve el breakdown estructurado
// =============================================================================

export function aggregatePerceptions(summaryResponse: any, periodKey: string): PerceptionBreakdown {
  const bd: PerceptionBreakdown = {
    period_key: periodKey,
    iva_credito_fiscal: 0,
    ganancias_pago_a_cuenta: 0,
    iibb_pago_a_cuenta_total: 0,
    iibb_por_jurisdiccion: {},
    por_concepto: {},
    sin_clasificar: [],
    total_general: 0,
  }

  // La respuesta puede venir envuelta en 'summary' o no
  const root = summaryResponse?.summary ?? summaryResponse

  // charges incluye percepciones (y otros cargos que ignoramos)
  const charges = Array.isArray(root?.charges) ? root.charges : []
  // tax es donde algunas variantes ponen las percepciones discriminadas
  const taxes = Array.isArray(root?.tax) ? root.tax : []

  const candidates = [...charges, ...taxes]

  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue
    const label: string = item.label ?? item.description ?? item.transaction_detail ?? ''
    const amount = Number(item.amount ?? item.detail_amount ?? 0) || 0

    // Solo conceptos que sean percepciones
    if (!/perce?p/i.test(label) && !/retenc/i.test(label)) continue

    const code = classifyLabel(label)
    if (!code || !PERCEPTION_CODES[code]) {
      bd.sin_clasificar.push({ label, amount })
      continue
    }

    const meta = PERCEPTION_CODES[code]
    bd.por_concepto[meta.label] = (bd.por_concepto[meta.label] ?? 0) + amount
    bd.total_general += amount

    switch (meta.naturaleza) {
      case 'credito_fiscal_iva':
        bd.iva_credito_fiscal += amount
        break
      case 'pago_a_cuenta_ganancias':
        bd.ganancias_pago_a_cuenta += amount
        break
      case 'pago_a_cuenta_iibb':
        bd.iibb_pago_a_cuenta_total += amount
        bd.iibb_por_jurisdiccion[meta.jurisdiccion] =
          (bd.iibb_por_jurisdiccion[meta.jurisdiccion] ?? 0) + amount
        break
    }
  }

  // Redondear a 2 decimales
  const round2 = (n: number) => Math.round(n * 100) / 100
  bd.iva_credito_fiscal = round2(bd.iva_credito_fiscal)
  bd.ganancias_pago_a_cuenta = round2(bd.ganancias_pago_a_cuenta)
  bd.iibb_pago_a_cuenta_total = round2(bd.iibb_pago_a_cuenta_total)
  bd.total_general = round2(bd.total_general)
  for (const j of Object.keys(bd.iibb_por_jurisdiccion)) {
    bd.iibb_por_jurisdiccion[j] = round2(bd.iibb_por_jurisdiccion[j])
  }
  for (const k of Object.keys(bd.por_concepto)) {
    bd.por_concepto[k] = round2(bd.por_concepto[k])
  }

  return bd
}

// =============================================================================
// Helpers de período
// =============================================================================

const TZ = 'America/Argentina/Buenos_Aires'

export function periodKeyFromDate(date: Date): string {
  const fechaAR = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
  const [y, m] = fechaAR.split('-')
  return `${y}-${m}-01`
}

export function currentPeriodKey(): string {
  return periodKeyFromDate(new Date())
}

// =============================================================================
// Cache en Supabase
// =============================================================================
// Política: los períodos EN CURSO se actualizan cada 24hs.
// Los períodos CERRADOS son inmutables, se cachean para siempre.

const TTL_MS_PERIODO_ACTUAL = 24 * 60 * 60 * 1000

export async function getCachedOrFetch(
  supabase: SupabaseClient,
  token: string,
  periodKey: string,
  forceRefresh = false
): Promise<PerceptionBreakdown> {
  const today = currentPeriodKey()
  const esActual = periodKey === today

  if (!forceRefresh) {
    const { data: cached } = await supabase
      .from('ml_billing_periods')
      .select('breakdown, updated_at, status')
      .eq('period_key', periodKey)
      .maybeSingle()

    if (cached?.breakdown) {
      const age = Date.now() - new Date(cached.updated_at).getTime()
      // Período cerrado: cache eterno
      if (cached.status === 'CERRADO') {
        return cached.breakdown as PerceptionBreakdown
      }
      // Período en curso: 24hs de TTL
      if (esActual && age < TTL_MS_PERIODO_ACTUAL) {
        return cached.breakdown as PerceptionBreakdown
      }
    }
  }

  // Cache miss o forceRefresh: pegar a ML
  const summary = await fetchBillingSummary(token, periodKey, 'ML')
  const breakdown = aggregatePerceptions(summary, periodKey)

  await supabase
    .from('ml_billing_periods')
    .upsert(
      {
        period_key: periodKey,
        breakdown,
        status: esActual ? 'EN CURSO' : 'CERRADO',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'period_key' }
    )

  return breakdown
}