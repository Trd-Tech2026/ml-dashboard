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
  matched_keys: string[]   // 'item_id' para ML, 'MANUAL:seller_sku' para manuales
  matched_count: number
  warning: string | null
  error: string | null
}

function pickField(row: any, ...keys: string[]): any {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') return row[k]
  }
  return ''
}

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

  // Buscar la hoja "Costos" o usar la primera
  const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('costo')) ?? workbook.SheetNames[0]
  if (!sheetName) {
    return NextResponse.json({ ok: false, error: 'El archivo no tiene hojas' }, { status: 400 })
  }
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: '', raw: true })

  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: 'La hoja está vacía' }, { status: 400 })
  }

  // Filtrar filas con NUEVO Costo cargado
  type RawFiltered = {
    fila_excel: number
    sku: string
    tipo: 'ML' | 'Manual'
    titulo: string
    costo_actual_raw: any
    iva_actual_raw: any
    costo_nuevo_raw: any
    iva_nuevo_raw: any
  }
  const filtered: RawFiltered[] = []
  rows.forEach((r, idx) => {
    const sku = String(pickField(r, 'SKU', 'Sku', 'sku') ?? '').trim()
    const newCostRaw = pickField(r, 'NUEVO Costo (sin IVA)', 'NUEVO Costo', 'Nuevo Costo', 'NUEVO_COSTO', 'nuevo_costo', 'Costo nuevo')
    if (!sku) return
    if (newCostRaw === '' || newCostRaw === null || newCostRaw === undefined) return

    const tipoRaw = String(pickField(r, 'Tipo', 'tipo', 'TIPO') ?? 'ML').trim().toLowerCase()
    const tipo: 'ML' | 'Manual' = tipoRaw.startsWith('man') ? 'Manual' : 'ML'

    filtered.push({
      fila_excel: idx + 2, // +1 por header, +1 por base 1
      sku,
      tipo,
      titulo: String(pickField(r, 'Título', 'Titulo', 'titulo', 'TITULO') ?? ''),
      costo_actual_raw: pickField(r, 'Costo actual', 'costo actual', 'Costo Actual'),
      iva_actual_raw: pickField(r, 'IVA actual (%)', 'IVA actual', 'iva actual'),
      costo_nuevo_raw: newCostRaw,
      iva_nuevo_raw: pickField(r, 'NUEVO IVA (%) - opcional', 'NUEVO IVA (%)', 'NUEVO IVA', 'Nuevo IVA', 'IVA nuevo'),
    })
  })

  if (filtered.length === 0) {
    return NextResponse.json({
      ok: true,
      items: [],
      summary: { total: 0, actualizar: 0, sin_cambios: 0, conflicto: 0, no_encontrado: 0, error: 0, duplicados: 0 },
      message: 'No se encontraron filas con "NUEVO Costo" cargado. ¿Completaste esa columna en el Excel?',
    })
  }

  // Pre-cargar de la BD
  const skusML = Array.from(new Set(filtered.filter(f => f.tipo === 'ML').map(f => f.sku)))
  const skusManual = Array.from(new Set(filtered.filter(f => f.tipo === 'Manual').map(f => f.sku)))

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  type ItemRow = { item_id: string; seller_sku: string | null; title: string; cost: number | null; iva_rate: number | null; archived: boolean }
  const itemsBySku = new Map<string, ItemRow[]>()
  if (skusML.length > 0) {
    for (let i = 0; i < skusML.length; i += 500) {
      const chunk = skusML.slice(i, i + 500)
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
  }

  type ManualRow = { seller_sku: string; title: string; cost: number | null; iva_rate: number | null }
  const manualsBySku = new Map<string, ManualRow>()
  if (skusManual.length > 0) {
    const { data } = await supabase
      .from('manual_items')
      .select('seller_sku, title, cost, iva_rate')
      .in('seller_sku', skusManual)
    if (data) {
      for (const m of data as ManualRow[]) {
        manualsBySku.set(m.seller_sku, m)
      }
    }
  }

  // Procesar cada fila
  const results: RowResult[] = filtered.map(f => {
    const costoNuevo = Number(f.costo_nuevo_raw)
    const ivaNuevoRaw = f.iva_nuevo_raw
    const ivaActual = (f.iva_actual_raw === '' || f.iva_actual_raw === null || f.iva_actual_raw === undefined)
      ? 21
      : Number(f.iva_actual_raw)
    const ivaNuevo = (ivaNuevoRaw === '' || ivaNuevoRaw === null || ivaNuevoRaw === undefined)
      ? ivaActual
      : Number(ivaNuevoRaw)

    const base: Omit<RowResult, 'estado' | 'matched_keys' | 'matched_count' | 'warning' | 'error' | 'costo_actual'> = {
      fila_excel: f.fila_excel,
      sku: f.sku,
      tipo: f.tipo,
      titulo: f.titulo,
      iva_actual: Number.isFinite(ivaActual) ? ivaActual : 21,
      costo_nuevo: costoNuevo,
      iva_nuevo: Number.isFinite(ivaNuevo) ? ivaNuevo : 21,
    }

    // Validaciones
    if (!Number.isFinite(costoNuevo) || costoNuevo < 0) {
      return {
        ...base,
        costo_actual: null,
        estado: 'error',
        matched_keys: [],
        matched_count: 0,
        warning: null,
        error: `Costo nuevo inválido: "${f.costo_nuevo_raw}"`,
      }
    }
    if (!Number.isFinite(ivaNuevo) || ivaNuevo < 0 || ivaNuevo > 100) {
      return {
        ...base,
        costo_actual: null,
        estado: 'error',
        matched_keys: [],
        matched_count: 0,
        warning: null,
        error: `IVA nuevo inválido: "${ivaNuevoRaw}". Debe ser un número entre 0 y 100.`,
      }
    }

    // Matching
    if (f.tipo === 'Manual') {
      const m = manualsBySku.get(f.sku)
      if (!m) {
        return {
          ...base,
          costo_actual: null,
          estado: 'no_encontrado',
          matched_keys: [],
          matched_count: 0,
          warning: null,
          error: null,
        }
      }
      const dbCost = m.cost != null ? Number(m.cost) : null
      const dbIva = m.iva_rate != null ? Number(m.iva_rate) : 21

      let estado: Estado
      if (dbCost === costoNuevo && dbIva === ivaNuevo) estado = 'sin_cambios'
      else if (dbCost == null || dbCost === 0) estado = 'actualizar'
      else estado = 'conflicto'

      return {
        ...base,
        costo_actual: dbCost,
        estado,
        matched_keys: [`MANUAL:${m.seller_sku}`],
        matched_count: 1,
        warning: null,
        error: null,
      }
    } else {
      // ML
      const matches = itemsBySku.get(f.sku) ?? []
      if (matches.length === 0) {
        return {
          ...base,
          costo_actual: null,
          estado: 'no_encontrado',
          matched_keys: [],
          matched_count: 0,
          warning: null,
          error: null,
        }
      }

      const matchedKeys = matches.map(m => m.item_id)
      const archivedCount = matches.filter(m => m.archived).length
      const isDuplicated = matches.length > 1

      // Tomar el primer cost como referencia (si todos coinciden)
      const allCosts = matches.map(m => m.cost != null ? Number(m.cost) : null)
      const allIvas = matches.map(m => m.iva_rate != null ? Number(m.iva_rate) : 21)
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

      // Construir warning
      const warnings: string[] = []
      if (isDuplicated) {
        warnings.push(`Este SKU matchea con ${matches.length} publicaciones (se actualizan todas).`)
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
        matched_count: matches.length,
        warning: warnings.length > 0 ? warnings.join(' ') : null,
        error: null,
      }
    }
  })

  // Summary
  const summary = {
    total: results.length,
    actualizar: results.filter(r => r.estado === 'actualizar').length,
    sin_cambios: results.filter(r => r.estado === 'sin_cambios').length,
    conflicto: results.filter(r => r.estado === 'conflicto').length,
    no_encontrado: results.filter(r => r.estado === 'no_encontrado').length,
    error: results.filter(r => r.estado === 'error').length,
    duplicados: results.filter(r => r.matched_count > 1).length,
  }

  return NextResponse.json({ ok: true, items: results, summary })
}
