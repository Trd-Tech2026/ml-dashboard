import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ ok: false, error: 'Body inválido' }, { status: 400 })
  }

  const { calcActual, calcPrev, period, labelPeriodo, labelComparacion, iibbPct } = body

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ ok: false, error: 'Falta ANTHROPIC_API_KEY en variables de entorno' }, { status: 500 })
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const formatARS = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n)

  // Armar el prompt con contexto del negocio
  const dataResumen = `
DATOS DEL PERÍODO ACTUAL (${labelPeriodo}):
- Facturación: ${formatARS(calcActual.facturacion)}
- Comisión ML: ${formatARS(calcActual.comision)} (${calcActual.comisionPct.toFixed(1)}% efectivo)
- Envíos ME: ${formatARS(calcActual.envios)} (${calcActual.envioCount} envíos)
- Bonificación Flex (a favor): ${formatARS(calcActual.flexBonif)} (${calcActual.flexCount} ventas Flex)
- IIBB (${iibbPct}%): ${formatARS(calcActual.iibb)}
- Costo mercadería: ${formatARS(calcActual.costoMerca)} (cobertura ${calcActual.coberturaCosto.toFixed(0)}%)
- Publicidad: ${formatARS(calcActual.publicidad)}
- Gastos varios: ${formatARS(calcActual.gastosVarios)}
- GANANCIA NETA: ${formatARS(calcActual.ganancia)}
- MARGEN: ${calcActual.margen.toFixed(1)}%
- Ventas: ${calcActual.ventas}
- Unidades: ${calcActual.unidades}
- Ticket promedio: ${formatARS(calcActual.ticketPromedio)}
- Días activos: ${calcActual.diasActivos}/${calcActual.diasTotales}
- Mejor día: ${formatARS(calcActual.mejorDiaMonto)}
- ROAS: ${calcActual.publicidad > 0 ? `×${calcActual.roas.toFixed(1)}` : 'sin publicidad'}

DATOS DEL PERÍODO PREVIO (${labelComparacion}):
- Facturación: ${formatARS(calcPrev.facturacion)}
- Ganancia: ${formatARS(calcPrev.ganancia)}
- Margen: ${calcPrev.margen.toFixed(1)}%
- Ventas: ${calcPrev.ventas}
`.trim()

  const systemPrompt = `Sos un analista financiero experto en e-commerce de Mercado Libre Argentina.
Recibís métricas de un vendedor (TRDTECH, rubro electro/hogar) y le das insights accionables breves.

REGLAS:
- Respondé en español rioplatense, casual pero profesional. Tuteo argentino ("tu negocio", "que tenés").
- Devolvé SIEMPRE un JSON con esta estructura exacta:
{
  "resumen": "Un párrafo de 2-3 oraciones con la situación general",
  "insights": [
    { "tipo": "positivo" | "alerta" | "oportunidad" | "info", "titulo": "...", "detalle": "..." },
    ... (3-5 insights)
  ],
  "accion_principal": "La UNA cosa más importante a hacer ahora"
}
- Los "insights" deben ser concretos y basarse en los números, no genéricos.
- Si la cobertura de costos es < 80%, agregá una alerta sobre eso.
- Si la comisión efectiva supera 18%, mencionalo.
- Si hay publicidad y ROAS < 5, alertá.
- Si el margen es negativo, priorizá esa alerta.
- Si Flex tiene buena bonificación, marcalo como positivo.
- NO uses emojis dentro de los strings. Cada insight ya va a ir con un emoji según su "tipo".
- Sé específico con los números. Por ejemplo: "tu comisión efectiva (21.5%) está 3 puntos arriba del promedio del rubro" en vez de "tu comisión es alta".

NO devuelvas nada más que el JSON. Sin preámbulo. Sin markdown. Solo JSON puro.`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: dataResumen }],
    })

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as any).text)
      .join('')
      .trim()

    // Extraer JSON (por si Claude lo devuelve con backticks)
    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()

    let parsed
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      return NextResponse.json({
        ok: false,
        error: 'La IA devolvió un formato inválido. Probá de nuevo.',
        raw: cleaned.slice(0, 500),
      }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      insights: parsed,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    })
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err?.message ?? 'Error llamando a la IA',
    }, { status: 500 })
  }
}