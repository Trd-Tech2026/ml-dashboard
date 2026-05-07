import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  let body: { purchase_order_id: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const { purchase_order_id } = body
  if (!purchase_order_id) {
    return NextResponse.json({ ok: false, error: 'Falta purchase_order_id' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    // 1. Verificar que existe y NO está ya cancelada
    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .select('id, status, invoice_number')
      .eq('id', purchase_order_id)
      .maybeSingle()

    if (poError || !po) {
      return NextResponse.json({ ok: false, error: 'Orden no encontrada' }, { status: 404 })
    }
    if (po.status === 'cancelled') {
      return NextResponse.json({ ok: false, error: 'Esta orden ya fue anulada anteriormente' }, { status: 400 })
    }

    // 2. Traer todas las líneas (items) de esa orden
    const { data: items, error: itemsError } = await supabase
      .from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', purchase_order_id)

    if (itemsError) {
      return NextResponse.json({ ok: false, error: `Error trayendo items: ${itemsError.message}` }, { status: 500 })
    }

    if (!items || items.length === 0) {
      // No hay items, solo marco como cancelada
      await supabase.from('purchase_orders').update({ status: 'cancelled' }).eq('id', purchase_order_id)
      return NextResponse.json({ ok: true, message: 'Orden cancelada (sin items)', items_reverted: 0 })
    }

    // 3. Por cada item, restar el stock que se había sumado
    const reverts: Array<{ sku: string; before: number; after: number; success: boolean; error?: string }> = []

    for (const item of items) {
      if (!item.seller_sku) continue

      const qty = item.quantity ?? 0
      if (qty <= 0) continue

      if (item.matched_to_manual) {
        // Manual: restar de manual_items
        const { data: current } = await supabase
          .from('manual_items')
          .select('available_quantity')
          .eq('seller_sku', item.seller_sku)
          .maybeSingle()

        const before = current?.available_quantity ?? 0
        const after = Math.max(0, before - qty) // no permitir negativo

        const { error: updateError } = await supabase
          .from('manual_items')
          .update({ available_quantity: after })
          .eq('seller_sku', item.seller_sku)

        if (updateError) {
          reverts.push({ sku: item.seller_sku, before, after: before, success: false, error: updateError.message })
          continue
        }

        reverts.push({ sku: item.seller_sku, before, after, success: true })
      } else {
        // ML: restar de items (todas las publicaciones del mismo SKU)
        const { data: existingItems } = await supabase
          .from('items')
          .select('item_id, available_quantity')
          .eq('seller_sku', item.seller_sku)
          .eq('archived', false)

        if (!existingItems || existingItems.length === 0) {
          reverts.push({ sku: item.seller_sku, before: 0, after: 0, success: false, error: 'SKU no encontrado' })
          continue
        }

        const before = Math.min(...existingItems.map(i => i.available_quantity))
        const after = Math.max(0, before - qty)

        const { error: updateError } = await supabase
          .from('items')
          .update({ available_quantity: after })
          .eq('seller_sku', item.seller_sku)
          .eq('archived', false)

        if (updateError) {
          reverts.push({ sku: item.seller_sku, before, after: before, success: false, error: updateError.message })
          continue
        }

        reverts.push({ sku: item.seller_sku, before, after, success: true })
      }

      // 4. Registrar movimiento de reversión
      await supabase
        .from('stock_movements')
        .insert({
          seller_sku: item.seller_sku,
          movement_type: 'manual_adjust',
          quantity_delta: -qty,
          reference_type: 'purchase_order_cancel',
          reference_id: String(purchase_order_id),
          is_manual_item: !!item.matched_to_manual,
          notes: `Anulación de factura ${po.invoice_number ?? '(sin número)'}`,
        })
    }

    // 5. Marcar la orden como cancelada
    const { error: cancelError } = await supabase
      .from('purchase_orders')
      .update({ status: 'cancelled' })
      .eq('id', purchase_order_id)

    if (cancelError) {
      return NextResponse.json({ ok: false, error: `Error marcando como cancelada: ${cancelError.message}` }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      purchase_order_id,
      items_reverted: reverts.filter(r => r.success).length,
      items_failed: reverts.filter(r => !r.success).length,
      results: reverts,
    })
  } catch (err: any) {
    console.error('[purchases/cancel] Error:', err)
    return NextResponse.json({ ok: false, error: err?.message ?? 'Error desconocido' }, { status: 500 })
  }
}