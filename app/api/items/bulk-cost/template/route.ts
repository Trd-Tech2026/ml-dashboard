import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type ItemRow = {
  item_id: string
  seller_sku: string | null
  title: string
  available_quantity: number
  cost: number | null
  iva_rate: number | null
}

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Traer TODOS los items activos paginado
  const itemsRows: ItemRow[] = []
  let from = 0
  const PAGE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('items')
      .select('item_id, seller_sku, title, available_quantity, cost, iva_rate')
      .eq('archived', false)
      .order('seller_sku', { ascending: true, nullsFirst: false })
      .range(from, from + PAGE - 1)
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    if (!data || data.length === 0) break
    itemsRows.push(...(data as ItemRow[]))
    if (data.length < PAGE) break
    from += PAGE
  }

  // ====== AGRUPAR POR SKU ======
  // Si tiene seller_sku, agrupa por sku. Si no tiene, queda como fila individual.
  type Group = {
    key: string
    sku: string | null
    title: string
    cost: number | null
    iva_rate: number
    publications: number
    total_stock: number
  }
  const groupMap = new Map<string, Group>()

  for (const it of itemsRows) {
    const key = it.seller_sku ? `sku:${it.seller_sku}` : `item:${it.item_id}`
    const existing = groupMap.get(key)
    if (existing) {
      existing.publications += 1
      existing.total_stock = Math.max(existing.total_stock, it.available_quantity ?? 0)
      // Si la primera no tenía costo y esta sí, usar la que tiene
      if (existing.cost == null && it.cost != null) {
        existing.cost = Number(it.cost)
        existing.iva_rate = Number(it.iva_rate ?? 21)
      }
    } else {
      groupMap.set(key, {
        key,
        sku: it.seller_sku,
        title: it.title ?? '',
        cost: it.cost != null ? Number(it.cost) : null,
        iva_rate: Number(it.iva_rate ?? 21),
        publications: 1,
        total_stock: it.available_quantity ?? 0,
      })
    }
  }

  const groups = Array.from(groupMap.values()).sort((a, b) => {
    // Sin SKU al final
    if (!a.sku && b.sku) return 1
    if (a.sku && !b.sku) return -1
    return (a.sku ?? '').localeCompare(b.sku ?? '', 'es', { sensitivity: 'base' })
  })

  // Manuales
  const { data: manualRows } = await supabase
    .from('manual_items')
    .select('seller_sku, title, available_quantity, cost, iva_rate')
    .order('seller_sku', { ascending: true })

  // ====== CONSTRUIR EXCEL ======
  const headerRow = [
    'SKU',
    'Tipo',
    'Título',
    'Publicaciones',
    'Stock',
    'Costo actual',
    'IVA actual (%)',
    'NUEVO Costo (sin IVA)',
    'NUEVO IVA (%) - opcional',
  ]
  const rows: any[][] = [headerRow]

  for (const g of groups) {
    rows.push([
      g.sku ?? '(sin SKU)',
      'ML',
      g.title,
      g.publications,
      g.total_stock,
      g.cost != null ? g.cost : '',
      g.iva_rate,
      '',
      '',
    ])
  }

  for (const m of manualRows ?? []) {
    rows.push([
      m.seller_sku ?? '',
      'Manual',
      m.title ?? '',
      1,
      m.available_quantity ?? 0,
      m.cost != null ? Number(m.cost) : '',
      m.iva_rate != null ? Number(m.iva_rate) : 21,
      '',
      '',
    ])
  }

  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = [
    { wch: 22 }, // SKU
    { wch: 9 },  // Tipo
    { wch: 50 }, // Título
    { wch: 13 }, // Publicaciones
    { wch: 8 },  // Stock
    { wch: 14 }, // Costo actual
    { wch: 12 }, // IVA actual
    { wch: 22 }, // NUEVO Costo
    { wch: 24 }, // NUEVO IVA
  ]
  ws['!freeze'] = { xSplit: 0, ySplit: 1 }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Costos')

  const instructions = [
    ['INSTRUCCIONES'],
    [''],
    ['1. Completá la columna "NUEVO Costo (sin IVA)" con el costo unitario sin IVA.'],
    ['2. La columna "NUEVO IVA (%)" es OPCIONAL. Si la dejás vacía, se mantiene el IVA actual.'],
    ['3. Si dejás "NUEVO Costo" vacío en una fila, ese producto NO se modifica.'],
    ['4. NO modifiques las columnas SKU ni Tipo.'],
    ['5. NO borres ni reordenes filas.'],
    ['6. Subí el archivo desde la página /stock/cargador-masivo.'],
    [''],
    ['¿POR QUÉ HAY MENOS FILAS QUE PUBLICACIONES?'],
    ['Cada fila es UN PRODUCTO ÚNICO (por SKU). Si tenés 3 publicaciones del mismo'],
    ['producto (catálogo, tradicional, cuotas), aparece UNA sola vez. La columna'],
    ['"Publicaciones" te dice cuántas publicaciones comparten ese SKU.'],
    ['Cuando cargues el costo, se aplica automáticamente a todas las publicaciones.'],
    [''],
    ['VALORES VÁLIDOS DE IVA:'],
    ['  21   = General'],
    ['  10.5 = Reducido'],
    ['  27   = Servicios'],
    ['  0    = Exento'],
    [''],
    ['CONFLICTOS:'],
    ['Si un producto YA tenía un costo cargado y vos cargás uno distinto, en la vista'],
    ['previa vas a poder elegir si sobreescribir o saltear cada uno.'],
  ]
  const wsInstr = XLSX.utils.aoa_to_sheet(instructions)
  wsInstr['!cols'] = [{ wch: 90 }]
  XLSX.utils.book_append_sheet(wb, wsInstr, 'Instrucciones')

  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })

  const today = new Date().toISOString().slice(0, 10)
  const filename = `costos-trdtech-${today}.xlsx`

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}