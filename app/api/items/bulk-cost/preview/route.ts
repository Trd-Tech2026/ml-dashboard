import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

// =============================================================
// ALIASES de columnas — para detectar formato automáticamente
// =============================================================
const SKU_ALIASES = [
  'SKU', 'Sku', 'sku',
  'seller_sku', 'seller sku', 'sellersku',
  'codigo', 'código',
]

const TIPO_ALIASES = ['Tipo', 'tipo', 'TIPO']

const TITULO_ALIASES = [
  'Título', 'Titulo', 'titulo', 'TÍTULO', 'TITULO',
  'descripcion', 'Descripción', 'descripción', 'Descripcion',
  'producto', 'Producto', 'nombre', 'Nombre',
]

const COSTO_NEW_ALIASES = [
  'NUEVO Costo (sin IVA)', 'NUEVO Costo', 'Nuevo Costo', 'NUEVO_COSTO',
  'nuevo_costo', 'Costo nuevo', 'costo nuevo',
  'NEW_COST', 'new_cost',
]

const COSTO_CURRENT_ALIASES = [
  'Costo actual', 'costo actual', 'Costo Actual',
  'precio_compra', 'Precio Compra', 'precio compra', 'Precio_Compra',
  'Costo', 'costo', 'COSTO',
  'Cost', 'cost',
]

const IVA_NEW_ALIASES = [
  'NUEVO IVA (%) - opcional', 'NUEVO IVA (%)', 'NUEVO IVA',
  'Nuevo IVA', 'nuevo_iva', 'IVA nuevo',
]

const IVA_CURRENT_ALIASES = [
  'IVA actual (%)', 'IVA actual', 'iva actual', 'IVA Actual',
  'alicuota_iva', 'Alicuota IVA', 'Alícuota IVA', 'alicuota',
  'IVA', 'iva',
]

function findColumnIndex(headers: string[], aliases: string[]): number {
  // Match exacto primero
  for (const alias of aliases) {
    const idx = headers.findIndex(h => h === alias)
    if (idx !== -1) return idx
  }
  // Match case-insensitive
  for (const alias of aliases) {
    const aliasLower = alias.toLowerCase()
    const idx = headers.findIndex(h => String(h ?? '').trim().toLowerCase() === aliasLower)
    if (idx !== -1) return idx
  }
  // Match parcial
  for (const alias of aliases) {
    const aliasLower = alias.toLowerCase()
    const idx = headers.findIndex(h => String(h ?? '').trim().toLowerCase().includes(aliasLower))
    if (idx !== -1) return idx
  }
  return -1
}

// =============================================================
// PARSERS robustos
// =============================================================
function parseCost(raw: any): number | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const s = String(raw).trim()
  if (!s) return null
  // Limpiar: quitar $, espacios. Manejar formatos AR ("1.234,56") y US ("1,234.56")
  let clean = s.replace(/[$\s]/g, '')
  // Si tiene tanto '.' como ',' asumimos formato AR (1.234,56)
  if (clean.includes('.') && clean.includes(',')) {
    clean = clean.replace(/\./g, '').replace(',', '.')
  } else if (clean.includes(',') && !clean.includes('.')) {
    // Solo coma → puede ser decimal AR
    clean = clean.replace(',', '.')
  }
  const num = parseFloat(clean)
  return Number.isFinite(num) ? num : null
}

function parseIva(raw: any): number | null {
  if (raw == null || raw === '') return null
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  const s = String(raw).trim()
  if (!s) return null

  const lower = s.toLowerCase()
  if (lower.includes('exento') || lower.includes('no gravado') || lower.includes('no_gravado')) return 0

  // Quitar % y espacios, parsear
  let clean = s.replace('%', '').replace(/\s/g, '')
  if (clean.includes('.') && clean.includes(',')) {
    clean = clean.replace(/\./g, '').replace(',', '.')
  } else if (clean.includes(',') && !clean.includes('.')) {
    clean = clean.replace(',', '.')
  }
  const num = parseFloat(clean)
  return Number.isFinite(num) ? num : null
}

function isHeaderLikeRow(row: any[]): boolean {
  // Una fila parece header si tiene strings cortos que coinciden con aliases conocidos
  const stringValues = row.map(c => String(c ?? '').trim()).filter(s => s)
  if (stringValues.length < 3) return false

  const allKnownHeaders = [
    ...SKU_ALIASES, ...TIPO_ALIASES, ...TITULO_ALIASES,
    ...COSTO_NEW_ALIASES, ...COSTO_CURRENT_ALIASES,
    ...IVA_NEW_ALIASES, ...IVA_CURRENT_ALIASES,
    'Stock', 'stock', 'Publicaciones', 'ID interno', 'id_interno',
  ].map(h => h.toLowerCase())

  let matches = 0
  for (const val of stringValues) {
    const valLower = val.toLowerCase()
    if (allKnownHeaders.some(h => valLower === h || valLower.includes(h))) {
      matches++
    }
  }
  return matches >= 2
}

// =============================================================
// ENDPOINT
// =============================================================
export async function POST(request: Request) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido (debe ser multipart/form-data)' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json({ ok: false, error: 'Falta el archivo' }, { status: 400 })
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ ok: false, error: 'Archivo demasiado grande (máx 20 MB)' }, { status: 400 })
  }

  let workbook: XLSX.WorkBook
  try {
    const buffer = await file.arrayBuffer()
    workbook = XLSX.read(buffer, { type: 'array' })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: 'No se pudo leer el archivo. Asegurate de que sea un .xlsx válido.' }, { status: 400 })
  }

  // Buscar la hoja: priorizar "Costos", "Actualización", o usar la primera
  const sheetName =
    workbook.SheetNames.find(n => n.toLowerCase().includes('costo')) ??
    workbook.SheetNames.find(n => n.toLowerCase().includes('actualiza')) ??
    workbook.SheetNames.find(n => n.toLowerCase().includes('producto')) ??
    workbook.SheetNames[0]

  if (!sheetName) {
    return NextResponse.json({ ok: false, error: 'El archivo no tiene hojas' }, { status: 400 })
  }
  const sheet = workbook.Sheets[sheetName]

  // Leer como matriz cruda (header: 1)
  const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true })

  if (allRows.length === 0) {
    return NextResponse.json({ ok: false, error: 'La hoja está vacía' }, { status: 400 })
  }

  // ====== Detectar fila de headers reales ======
  // Caso A: la fila 0 es un header válido (mapeo directo de XLSX)
  // Caso B: la fila 0 es un header programático (raro), la fila 1 tiene los headers humanos reales

  let headerRowIdx = 0
  let headers: string[] = (allRows[0] ?? []).map(c => String(c ?? '').trim())

  // Buscar SKU en la fila 0
  let skuIdx = findColumnIndex(headers, SKU_ALIASES)

  // Si no encontramos SKU en la fila 0, probar con la fila 1
  if (skuIdx === -1 && allRows.length > 1) {
    const row1 = (allRows[1] ?? []).map(c => String(c ?? '').trim())
    const skuIdxRow1 = findColumnIndex(row1, SKU_ALIASES)
    if (skuIdxRow1 !== -1) {
      headerRowIdx = 1
      headers = row1
      skuIdx = skuIdxRow1
    }
  }

  // Si la fila 1 ES un header humano (incluso teniendo headers válidos en fila 0), saltarla
  let dataStartIdx = headerRowIdx + 1
  if (dataStartIdx < allRows.length && isHeaderLikeRow(allRows[dataStartIdx])) {
    dataStartIdx++
  }

  if (skuIdx === -1) {
    return NextResponse.json({
      ok: false,
      error: 'No se encontró una columna de SKU en el archivo. Verificá que tu Excel tenga una columna llamada "SKU", "sku" o "seller_sku".',
      hojas_encontradas: workbook.SheetNames,
      headers_detectados: headers.slice(0, 10),
    }, { status: 400 })
  }

  // Detectar columnas de costo e IVA
  const costoNewIdx = findColumnIndex(headers, COSTO_NEW_ALIASES)
  const costoCurrentIdx = findColumnIndex(headers, COSTO_CURRENT_ALIASES)
  const ivaNewIdx = findColumnIndex(headers, IVA_NEW_ALIASES)
  const ivaCurrentIdx = findColumnIndex(headers, IVA_CURRENT_ALIASES)
  const tipoIdx = findColumnIndex(headers, TIPO_ALIASES)
  const tituloIdx = findColumnIndex(headers, TITULO_ALIASES)

  // ===== Lógica de selección de columna de costo =====
  // Si hay "NUEVO Costo": esa es la fuente principal
  // Si NO hay "NUEVO Costo" pero sí "Costo actual"/"precio_compra": usar esa como nueva
  const usarCostoActualComoNuevo = costoNewIdx === -1 && costoCurrentIdx !== -1
  const costoIdx = costoNewIdx !== -1 ? costoNewIdx : costoCurrentIdx
  const ivaIdx = ivaNewIdx !== -1 ? ivaNewIdx : ivaCurrentIdx

  if (costoIdx === -1) {
    return NextResponse.json({
      ok: false,
      error: 'No se encontró una columna de costo. Tu Excel debería tener una columna "Costo actual", "precio_compra", "Costo", o "NUEVO Costo".',
      hojas_encontradas: workbook.SheetNames,
      headers_detectados: headers.slice(0, 15),
    }, { status: 400 })
  }

  // ====== Procesar filas ======
  type RawFiltered = {
    fila_excel: number
    sku: string
    tipoStr: string
    titulo: string
    costo_actual_raw: any
    iva_actual_raw: any
    costo_nuevo_raw: any
    iva_nuevo_raw: any
  }
  const filtered: RawFiltered[] = []

  for (let i = dataStartIdx; i < allRows.length; i++) {
    const row = allRows[i]
    if (!row || row.length === 0) continue

    const sku = String(row[skuIdx] ?? '').trim()
    if (!sku) continue
    if (sku.toLowerCase() === 'sku') continue // saltar filas que sean headers extra

    const costoRaw = costoIdx !== -1 ? row[costoIdx] : ''
    if (costoRaw === '' || costoRaw === null || costoRaw === undefined) continue

    filtered.push({
      fila_excel: i + 1, // 1-based para mostrar al usuario
      sku,
      tipoStr: tipoIdx !== -1 ? String(row[tipoIdx] ?? '').trim() : '',
      titulo: tituloIdx !== -1 ? String(row[tituloIdx] ?? '').trim() : '',
      costo_actual_raw: costoCurrentIdx !== -1 && costoCurrentIdx !== costoIdx ? row[costoCurrentIdx] : '',
      iva_actual_raw: ivaCurrentIdx !== -1 && ivaCurrentIdx !== ivaIdx ? row[ivaCurrentIdx] : '',
      costo_nuevo_raw: costoRaw,
      iva_nuevo_raw: ivaIdx !== -1 ? row[ivaIdx] : '',
    })
  }

  if (filtered.length === 0) {
    return NextResponse.json({
      ok: true,
      items: [],
      summary: { total: 0, actualizar: 0, sin_cambios: 0, conflicto: 0, no_encontrado: 0, error: 0, duplicados: 0 },
      message: usarCostoActualComoNuevo
        ? `Detectamos formato propio. Columna usada para costos: "${headers[costoIdx]}". Pero no se encontró ningún producto con costo cargado.`
        : 'No se encontraron filas con "NUEVO Costo" cargado.',
      formato_detectado: {
        hoja: sheetName,
        columna_sku: headers[skuIdx],
        columna_costo: headers[costoIdx],
        columna_iva: ivaIdx !== -1 ? headers[ivaIdx] : null,
        usar_costo_actual_como_nuevo: usarCostoActualComoNuevo,
      },
    })
  }

  // ====== Pre-cargar datos de la BD ======
  // SIEMPRE buscamos en items Y en manual_items (independiente del Tipo del Excel)
  const allSkus = Array.from(new Set(filtered.map(f => f.sku)))

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  type ItemRow = { item_id: string; seller_sku: string | null; title: string; cost: number | null; iva_rate: number | null; archived: boolean }
  const itemsBySku = new Map<string, ItemRow[]>()
  for (let i = 0; i < allSkus.length; i += 500) {
    const chunk = allSkus.slice(i, i + 500)
    const { data } = await supabase
      .from('items')
      .select('item_id, seller_sku, title, cost, iva_rate, archived')
      .in('seller_sku', chunk)
    if (data) {
      for (const it of data as ItemRow[]) {
        if (!it.seller_sku) continue
        if (!itemsBySku.has(it.seller_sku)) itemsBySku.set(it.seller_sku, [])
        itemsBySku.get(it.seller_sku)!.push(it)
      }
    }
  }

  type ManualRow = { seller_sku: string; title: string; cost: number | null; iva_rate: number | null }
  const manualsBySku = new Map<string, ManualRow>()
  const { data: manualData } = await supabase
    .from('manual_items')
    .select('seller_sku, title, cost, iva_rate')
    .in('seller_sku', allSkus)
  if (manualData) {
    for (const m of manualData as ManualRow[]) {
      manualsBySku.set(m.seller_sku, m)
    }
  }

  // ====== Procesar cada fila ======
  const results: RowResult[] = filtered.map(f => {
    const costoNuevo = parseCost(f.costo_nuevo_raw)
    const ivaActual = parseIva(f.iva_actual_raw) ?? 21
    const ivaNuevoParsed = parseIva(f.iva_nuevo_raw)
    const ivaNuevo = ivaNuevoParsed ?? ivaActual

    // Determinar tipo de matching: primero en items (ML), después en manual
    const matchesML = itemsBySku.get(f.sku) ?? []
    const matchManual = manualsBySku.get(f.sku)

    // Si el Excel dice "Manual" explícitamente, ir directo al manual
    const explicitManual = f.tipoStr.toLowerCase().startsWith('man')

    let tipo: 'ML' | 'Manual'
    let useManual = false
    if (explicitManual && matchManual) {
      tipo = 'Manual'
      useManual = true
    } else if (matchesML.length > 0) {
      tipo = 'ML'
    } else if (matchManual) {
      tipo = 'Manual'
      useManual = true
    } else {
      tipo = explicitManual ? 'Manual' : 'ML'
    }

    const base = {
      fila_excel: f.fila_excel,
      sku: f.sku,
      tipo,
      titulo: f.titulo || (matchesML[0]?.title ?? matchManual?.title ?? ''),
      iva_actual: ivaActual,
      costo_nuevo: costoNuevo ?? 0,
      iva_nuevo: ivaNuevo,
    }

    // Validaciones
    if (costoNuevo == null || !Number.isFinite(costoNuevo) || costoNuevo < 0) {
      return {
        ...base,
        costo_actual: null,
        estado: 'error' as Estado,
        matched_keys: [],
        matched_count: 0,
        warning: null,
        error: `Costo inválido: "${f.costo_nuevo_raw}"`,
      }
    }
    if (!Number.isFinite(ivaNuevo) || ivaNuevo < 0 || ivaNuevo > 100) {
      return {
        ...base,
        costo_actual: null,
        estado: 'error' as Estado,
        matched_keys: [],
        matched_count: 0,
        warning: null,
        error: `IVA inválido: "${f.iva_nuevo_raw ?? f.iva_actual_raw}".`,
      }
    }

    // Matching
    if (useManual && matchManual) {
      const dbCost = matchManual.cost != null ? Number(matchManual.cost) : null
      const dbIva = matchManual.iva_rate != null ? Number(matchManual.iva_rate) : 21

      let estado: Estado
      if (dbCost === costoNuevo && dbIva === ivaNuevo) estado = 'sin_cambios'
      else if (dbCost == null || dbCost === 0) estado = 'actualizar'
      else estado = 'conflicto'

      return {
        ...base,
        costo_actual: dbCost,
        estado,
        matched_keys: [`MANUAL:${matchManual.seller_sku}`],
        matched_count: 1,
        warning: null,
        error: null,
      }
    }

    if (matchesML.length === 0) {
      return {
        ...base,
        costo_actual: null,
        estado: 'no_encontrado' as Estado,
        matched_keys: [],
        matched_count: 0,
        warning: null,
        error: null,
      }
    }

    const matchedKeys = matchesML.map(m => m.item_id)
    const archivedCount = matchesML.filter(m => m.archived).length
    const isDuplicated = matchesML.length > 1

    const allCosts = matchesML.map(m => m.cost != null ? Number(m.cost) : null)
    const allIvas = matchesML.map(m => m.iva_rate != null ? Number(m.iva_rate) : 21)
    const firstCost = allCosts[0]
    const firstIva = allIvas[0]
    const allSameCost = allCosts.every(c => c === firstCost)
    const allSameIva = allIvas.every(i => i === firstIva)

    let estado: Estado
    if (allSameCost && allSameIva && firstCost === costoNuevo && firstIva === ivaNuevo) {
      estado = 'sin_cambios'
    } else if (allSameCost && (firstCost == null || firstCost === 0)) {
      estado = 'actualizar'
    } else {
      estado = 'conflicto'
    }

    const warnings: string[] = []
    if (isDuplicated) {
      warnings.push(`Este SKU matchea con ${matchesML.length} publicaciones (se actualizan todas).`)
    }
    if (archivedCount > 0) {
      warnings.push(`${archivedCount} publicación${archivedCount === 1 ? ' está archivada' : 'es están archivadas'}.`)
    }
    if (estado === 'conflicto' && !allSameCost) {
      warnings.push('Las publicaciones tienen costos distintos entre sí.')
    }

    return {
      ...base,
      costo_actual: firstCost,
      estado,
      matched_keys: matchedKeys,
      matched_count: matchesML.length,
      warning: warnings.length > 0 ? warnings.join(' ') : null,
      error: null,
    }
  })

  const summary = {
    total: results.length,
    actualizar: results.filter(r => r.estado === 'actualizar').length,
    sin_cambios: results.filter(r => r.estado === 'sin_cambios').length,
    conflicto: results.filter(r => r.estado === 'conflicto').length,
    no_encontrado: results.filter(r => r.estado === 'no_encontrado').length,
    error: results.filter(r => r.estado === 'error').length,
    duplicados: results.filter(r => r.matched_count > 1).length,
  }

  return NextResponse.json({
    ok: true,
    items: results,
    summary,
    formato_detectado: {
      hoja: sheetName,
      columna_sku: headers[skuIdx],
      columna_costo: headers[costoIdx],
      columna_iva: ivaIdx !== -1 ? headers[ivaIdx] : null,
      usar_costo_actual_como_nuevo: usarCostoActualComoNuevo,
      filas_procesadas: filtered.length,
    },
    message: usarCostoActualComoNuevo
      ? `Detectamos tu formato (Tienda Nube u otro). Usamos la columna "${headers[costoIdx]}" como costo nuevo de TODAS las filas. Si querés modificar solo algunas, usá nuestra plantilla con columna "NUEVO Costo".`
      : null,
  })
}