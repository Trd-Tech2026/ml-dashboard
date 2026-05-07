import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type ConfirmItem = {
  supplier_code: string | null
  description: string | null
  quantity: number
  unit_cost: number | null
  seller_sku: string
  is_manual: boolean
}

type ConfirmBody = {
  supplier: { name: string | null; cuit: string | null }
  invoice: { number: string | null; date: string | null; type: string | null; total_amount: number | null }
  items: ConfirmItem[]
  file_path: string | null
  ai_extracted_data: any
}

export async function POST(request: Request) {
  let body: ConfirmBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const { supplier, invoice, items, file_path, ai_extracted_data } = body

  // Validaciones
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ ok: false, error: 'No hay items para procesar' }, { status: 400 })
  }
  for (const item of items) {
    if (!item.seller_sku) {
      return NextResponse.json({ ok: false, error: `Falta seller_sku en algún item` }, { status: 400 })
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return NextResponse.json({ ok: false, error: `Cantidad inválida para ${item.seller_sku}` }, { status: 400 })
    }
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    // 1. Crear o encontrar el proveedor
    let supplierId: number | null = null
    if (supplier?.cuit || supplier?.name) {
      const cuitClean = supplier.cuit ? supplier.cuit.replace(/[^0-9]/g, '') : null

      // Buscar por CUIT primero
      if (cuitClean) {
        const { data: existing } = await supabase
          .from('suppliers')
          .select('id')
          .eq('cuit', cuitClean)
          .maybeSingle()
        if (existing) supplierId = existing.id
      }

      // Si no se encontró, buscar por nombre
      if (!supplierId && supplier.name) {
        const { data: existingByName } = await supabase
          .from('suppliers')
          .select('id')
          .ilike('name', supplier.name)
          .maybeSingle()
        if (existingByName) supplierId = existingByName.id
      }

      // Si sigue sin existir, crear
      if (!supplierId) {
        const { data: newSupplier, error: supError } = await supabase
          .from('suppliers')
          .insert({
            name: supplier.name ?? 'Sin nombre',
            cuit: cuitClean,
          })
          .select('id')
          .single()
        if (supError) {
          return NextResponse.json({ ok: false, error: `Error creando proveedor: ${supError.message}` }, { status: 500 })
        }
        supplierId = newSupplier.id
      }
    }

    // 2. Crear la purchase order (cabecera)
    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .insert({
        supplier_id: supplierId,
        invoice_number: invoice?.number ?? null,
        invoice_date: invoice?.date ?? null,
        total_amount: invoice?.total_amount ?? null,
        status: 'confirmed',
        invoice_file_url: file_path,
        ai_extracted_data: ai_extracted_data ?? null,
        confirmed_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (poError) {
      return NextResponse.json({ ok: false, error: `Error creando orden: ${poError.message}` }, { status: 500 })
    }

    const purchaseOrderId = po.id

    // 3. Crear las líneas + actualizar stock + movimientos
    const stockResults: Array<{ sku: string; before: number; after: number; success: boolean; error?: string }> = []

    for (const item of items) {
      // 3a. Crear línea en purchase_order_items
      const { error: lineError } = await supabase
        .from('purchase_order_items')
        .insert({
          purchase_order_id: purchaseOrderId,
          raw_description: item.description,
          raw_supplier_code: item.supplier_code,
          raw_quantity: item.quantity,
          raw_unit_cost: item.unit_cost,
          seller_sku: item.seller_sku,
          matched_to_manual: item.is_manual,
          quantity: item.quantity,
          unit_cost: item.unit_cost,
        })

      if (lineError) {
        stockResults.push({
          sku: item.seller_sku,
          before: 0,
          after: 0,
          success: false,
          error: `Línea: ${lineError.message}`,
        })
        continue
      }

      // 3b. Actualizar stock (items o manual_items)
      if (item.is_manual) {
        // Manual item: sumar a available_quantity
        const { data: current } = await supabase
          .from('manual_items')
          .select('available_quantity')
          .eq('seller_sku', item.seller_sku)
          .maybeSingle()

        const before = current?.available_quantity ?? 0
        const after = before + item.quantity

        const { error: updateError } = await supabase
          .from('manual_items')
          .update({ available_quantity: after })
          .eq('seller_sku', item.seller_sku)

        if (updateError) {
          stockResults.push({
            sku: item.seller_sku,
            before,
            after: before,
            success: false,
            error: `Update manual: ${updateError.message}`,
          })
          continue
        }

        stockResults.push({ sku: item.seller_sku, before, after, success: true })
      } else {
        // Item de ML: hay múltiples publicaciones con el mismo SKU
        // Sumamos la cantidad a todas las publicaciones (criterio: cada publicación refleja el mismo stock físico)
        // Actualizamos available_quantity de todos los items con ese seller_sku

        const { data: existingItems } = await supabase
          .from('items')
          .select('item_id, available_quantity')
          .eq('seller_sku', item.seller_sku)
          .eq('archived', false)

        if (!existingItems || existingItems.length === 0) {
          stockResults.push({
            sku: item.seller_sku,
            before: 0,
            after: 0,
            success: false,
            error: 'SKU no encontrado en items',
          })
          continue
        }

        // Tomar el stock mínimo (es el "real")
        const before = Math.min(...existingItems.map(i => i.available_quantity))
        const after = before + item.quantity

        // Actualizar TODAS las publicaciones a este nuevo valor
        const { error: updateError } = await supabase
          .from('items')
          .update({ available_quantity: after })
          .eq('seller_sku', item.seller_sku)
          .eq('archived', false)

        if (updateError) {
          stockResults.push({
            sku: item.seller_sku,
            before,
            after: before,
            success: false,
            error: `Update items: ${updateError.message}`,
          })
          continue
        }

        stockResults.push({ sku: item.seller_sku, before, after, success: true })
      }

      // 3c. Registrar movimiento
      await supabase
        .from('stock_movements')
        .insert({
          seller_sku: item.seller_sku,
          movement_type: 'purchase_in',
          quantity_delta: item.quantity,
          reference_type: 'purchase_order',
          reference_id: String(purchaseOrderId),
          is_manual_item: item.is_manual,
          notes: `Factura ${invoice?.number ?? ''} - ${supplier?.name ?? ''}`,
        })

      // 3d. Aprender el mapping del proveedor
      if (supplierId && item.supplier_code) {
        await supabase
          .from('supplier_sku_mapping')
          .upsert({
            supplier_id: supplierId,
            supplier_code: item.supplier_code,
            supplier_description: item.description,
            seller_sku: item.seller_sku,
            is_manual_item: item.is_manual,
            last_used_at: new Date().toISOString(),
          }, { onConflict: 'supplier_id,supplier_code' })
      }
    }

    const failed = stockResults.filter(r => !r.success)
    const succeeded = stockResults.filter(r => r.success)

    return NextResponse.json({
      ok: true,
      purchase_order_id: purchaseOrderId,
      supplier_id: supplierId,
      total_items: items.length,
      succeeded: succeeded.length,
      failed: failed.length,
      results: stockResults,
    })

  } catch (err: any) {
    console.error('[purchases/confirm] Error:', err)
    return NextResponse.json({ ok: false, error: err?.message ?? 'Error desconocido' }, { status: 500 })
  }
}
