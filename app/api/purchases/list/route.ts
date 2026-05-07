import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    // Traer purchase_orders con info del proveedor
    const { data: orders, error } = await supabase
      .from('purchase_orders')
      .select(`
        id,
        invoice_number,
        invoice_date,
        total_amount,
        status,
        confirmed_at,
        created_at,
        suppliers ( id, name, cuit )
      `)
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    // Para cada orden, traer cantidad de items
    const ordersWithItemCount = await Promise.all(
      (orders ?? []).map(async (o) => {
        const { count } = await supabase
          .from('purchase_order_items')
          .select('id', { count: 'exact', head: true })
          .eq('purchase_order_id', o.id)

        return {
          id: o.id,
          invoice_number: o.invoice_number,
          invoice_date: o.invoice_date,
          total_amount: o.total_amount,
          status: o.status,
          confirmed_at: o.confirmed_at,
          created_at: o.created_at,
          supplier: Array.isArray(o.suppliers) ? o.suppliers[0] : o.suppliers,
          items_count: count ?? 0,
        }
      })
    )

    return NextResponse.json({
      ok: true,
      orders: ordersWithItemCount,
      total: ordersWithItemCount.length,
    })
  } catch (err: any) {
    console.error('[purchases/list] Error:', err)
    return NextResponse.json({ ok: false, error: err?.message ?? 'Error desconocido' }, { status: 500 })
  }
}
