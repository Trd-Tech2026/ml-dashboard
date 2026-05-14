import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { currentPeriodKey } from '../../lib/ml-billing'

export const dynamic = 'force-dynamic'

function sb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const period = searchParams.get('period') || currentPeriodKey()

  const { data, error } = await sb()
    .from('billing_manual_override')
    .select('*')
    .eq('period_key', period)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, period, override: data })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const period = String(body.period || currentPeriodKey())
    const percepciones = Number(body.percepciones_totales)
    const cargosPendientes = Number(body.cargos_pendientes ?? 0)
    const notes = body.notes ? String(body.notes) : null

    if (!Number.isFinite(percepciones) || percepciones < 0) {
      return NextResponse.json({ error: 'percepciones_totales inválido' }, { status: 400 })
    }
    if (!Number.isFinite(cargosPendientes) || cargosPendientes < 0) {
      return NextResponse.json({ error: 'cargos_pendientes inválido' }, { status: 400 })
    }

    const { data, error } = await sb()
      .from('billing_manual_override')
      .upsert({
        period_key: period,
        percepciones_totales: percepciones,
        cargos_pendientes: cargosPendientes,
        notes,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'period_key' })
      .select()
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, override: data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url)
  const period = searchParams.get('period') || currentPeriodKey()

  const { error } = await sb()
    .from('billing_manual_override')
    .delete()
    .eq('period_key', period)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}