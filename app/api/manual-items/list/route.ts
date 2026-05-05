import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const search = (searchParams.get('search') ?? '').trim()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let query = supabase
    .from('manual_items')
    .select('seller_sku, title, available_quantity, cost, notes, created_at, updated_at')
    .order('title', { ascending: true })

  if (search) {
    const safe = search.replace(/[,()]/g, ' ')
    query = query.or(`title.ilike.%${safe}%,seller_sku.ilike.%${safe}%`)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    items: data ?? [],
    total: (data ?? []).length,
  })
}