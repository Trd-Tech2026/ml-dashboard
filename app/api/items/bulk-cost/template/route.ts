import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Traer TODOS los items activos paginado
  const itemsRows: any[] = []
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
    itemsRows.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  // Manuales
  const { data: manualRows } = await supabase
    .from('manual_items')
    .select('seller_sku, title, available_quantity, cost, iva_rate')
    .order('seller_sku', { ascending: true })

  // Construir filas de Excel
  const headerRow = [
    'SKU',
    'Tipo',
    'Título',
    'Stock',
    'Costo actual',
    'IVA actual (%)',
    'NUEVO Costo (sin IVA)',
    'NUEVO IVA (%) - opcional',
  ]

  const rows: any[][] = [headerRow]

  for (const it of itemsRows) {
    rows.push([
      it.seller_sku ?? '(sin SKU)',
      'ML',
      it.title ?? '',
      it.available_quantity ?? 0,
      it.cost != null ? Number(it.cost) : '',
      it.iva_rate != null ? Number(it.iva_rate) : 21,
      '', // NUEVO Costo - vacío para que el usuario complete
      '', // NUEVO IVA - opcional
    ])
  }

  for (const m of manualRows ?? []) {
    rows.push([
      m.seller_sku ?? '',
      'Manual',
      m.title ?? '',
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
    { wch: 8 },  // Stock
    { wch: 14 }, // Costo actual
    { wch: 12 }, // IVA actual
    { wch: 22 }, // NUEVO Costo
    { wch: 24 }, // NUEVO IVA
  ]
  // Freeze del header
  ws['!freeze'] = { xSplit: 0, ySplit: 1 }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Costos')

  // Hoja de instrucciones
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
    ['VALORES VÁLIDOS DE IVA:'],
    ['  21   = General'],
    ['  10.5 = Reducido'],
    ['  27   = Servicios'],
    ['  0    = Exento'],
    [''],
    ['CONFLICTOS:'],
    ['Si un producto YA tenía un costo cargado y vos cargás uno distinto, en la vista'],
    ['previa vas a poder elegir si sobreescribir o saltear cada uno.'],
    [''],
    ['SKUs DUPLICADOS:'],
    ['Si tenés varias publicaciones con el mismo SKU, al actualizar el costo se aplica'],
    ['a TODAS las publicaciones que comparten ese SKU. Es lo natural porque es el mismo'],
    ['producto físico.'],
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