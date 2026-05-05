import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // 60 segundos para que tenga tiempo el OCR

const EXTRACTION_PROMPT = `Sos un experto en leer facturas argentinas de compra de mercadería.

Extraé los siguientes datos de la factura adjunta y devolvé SOLO un JSON válido, sin texto adicional.

Estructura del JSON:
{
  "supplier": {
    "name": "Nombre del proveedor (razón social)",
    "cuit": "CUIT del proveedor (solo números, sin guiones)"
  },
  "invoice": {
    "number": "Número completo de la factura (ej: 0001-00012345 o 00001A12345)",
    "date": "Fecha en formato YYYY-MM-DD",
    "type": "A | B | C | E | M (tipo de factura)",
    "total_amount": 12345.67
  },
  "items": [
    {
      "supplier_code": "Código del producto del proveedor (puede ser SKU, ID, código interno) o null si no hay",
      "description": "Descripción completa del producto",
      "quantity": 5,
      "unit_cost": 1234.56,
      "subtotal": 6172.80
    }
  ]
}

Reglas importantes:
- Si un dato no aparece en la factura, usá null.
- En "items", incluí TODOS los productos de la factura (no resumas).
- "quantity" debe ser un número entero (las cantidades suelen serlo).
- Los costos deben ser el costo SIN IVA si es factura A, o el precio final si es B/C.
- No inventes datos que no estén en la factura.
- Devolvé SOLO el JSON, sin "json" ni markdown ni explicaciones.`

export async function POST(request: Request) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: 'ANTHROPIC_API_KEY no configurada en Vercel' }, { status: 500 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ ok: false, error: 'No se envió archivo' }, { status: 400 })
    }

    // Validar tipo de archivo
    const validTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    if (!validTypes.includes(file.type)) {
      return NextResponse.json({
        ok: false,
        error: `Tipo de archivo no soportado: ${file.type}. Solo PDF, JPG, PNG o WEBP.`,
      }, { status: 400 })
    }

    // Validar tamaño (max 10 MB)
    const MAX_SIZE = 10 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return NextResponse.json({
        ok: false,
        error: `Archivo demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Máximo 10 MB.`,
      }, { status: 400 })
    }

    // Leer el archivo en base64
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const base64 = buffer.toString('base64')

    // Subir a Supabase Storage
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const timestamp = Date.now()
    const cleanName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
    const fileName = `${timestamp}_${cleanName}`

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('invoices')
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      console.error('[ocr-invoice] Upload error:', uploadError)
      return NextResponse.json({ ok: false, error: `Error al subir archivo: ${uploadError.message}` }, { status: 500 })
    }

    // Llamar a Claude API
    const anthropic = new Anthropic({ apiKey })

    const isPdf = file.type === 'application/pdf'

    const messageContent: any[] = isPdf
      ? [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          },
          { type: 'text', text: EXTRACTION_PROMPT },
        ]
      : [
          {
            type: 'image',
            source: { type: 'base64', media_type: file.type, data: base64 },
          },
          { type: 'text', text: EXTRACTION_PROMPT },
        ]

    let claudeResponse
    try {
      claudeResponse = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        messages: [{ role: 'user', content: messageContent }],
      })
    } catch (err: any) {
      console.error('[ocr-invoice] Claude API error:', err)
      // Si falla, borramos el archivo subido
      await supabase.storage.from('invoices').remove([fileName])
      return NextResponse.json({
        ok: false,
        error: `Error de Claude API: ${err?.message ?? 'desconocido'}`,
      }, { status: 500 })
    }

    // Extraer el texto de la respuesta
    const textBlock = claudeResponse.content.find(b => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ ok: false, error: 'Claude no devolvió texto' }, { status: 500 })
    }

    let raw = textBlock.text.trim()
    // Limpiar markdown si hay
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

    // Parsear JSON
    let extracted: any
    try {
      extracted = JSON.parse(raw)
    } catch (err) {
      console.error('[ocr-invoice] JSON parse error. Raw:', raw)
      return NextResponse.json({
        ok: false,
        error: 'Claude no devolvió JSON válido. Probá con otra factura o subí una versión más clara.',
        raw_response: raw.slice(0, 500),
      }, { status: 500 })
    }

    // Devolver datos extraídos + nombre del archivo (para guardar después)
    return NextResponse.json({
      ok: true,
      file_path: fileName,
      extracted,
      usage: {
        input_tokens: claudeResponse.usage.input_tokens,
        output_tokens: claudeResponse.usage.output_tokens,
      },
    })

  } catch (err: any) {
    console.error('[ocr-invoice] Unexpected error:', err)
    return NextResponse.json({
      ok: false,
      error: err?.message ?? 'Error desconocido',
    }, { status: 500 })
  }
}