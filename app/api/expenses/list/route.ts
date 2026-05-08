import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const fromDate = searchParams.get('from')
  const toDate = searchParams.get('to')
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') ?? '100', 10)))

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  let query = supabase
    .from('quick_expenses')
    .select('id, date, amount, category, description, created_at')
    .order('date', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit)

  if (fromDate) query = query.gte('date', fromDate)
  if (toDate) query = query.lte('date', toDate)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const total = (data ?? []).reduce((s, r: any) => s + Number(r.amount ?? 0), 0)

  return NextResponse.json({
    ok: true,
    expenses: data ?? [],
    total,
    count: data?.length ?? 0,
  })
}
