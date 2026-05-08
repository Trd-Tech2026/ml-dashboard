import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Trae todos los registros de tax_config
  const { data, error } = await supabase
    .from('tax_config')
    .select('id, name, type, percentage, jurisdiction, active, notes, updated_at')
    .order('type', { ascending: true })
    .order('id', { ascending: false })

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  // Stats de cobertura de costos en items
  const { count: totalItems } = await supabase
    .from('items')
    .select('item_id', { count: 'exact', head: true })
    .eq('archived', false)

  const { count: itemsConCosto } = await supabase
    .from('items')
    .select('item_id', { count: 'exact', head: true })
    .eq('archived', false)
    .not('cost', 'is', null)
    .gt('cost', 0)

  return NextResponse.json({
    ok: true,
    taxConfigs: data ?? [],
    itemsStats: {
      total: totalItems ?? 0,
      conCosto: itemsConCosto ?? 0,
      sinCosto: (totalItems ?? 0) - (itemsConCosto ?? 0),
    },
  })
}