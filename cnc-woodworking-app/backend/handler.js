const Anthropic = require('@anthropic-ai/sdk')
const { processPartsArray, buildFullGcode } = require('./joineryEngine')

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
}

const SYSTEM_PROMPT = `You are a woodworking assistant. Given a description or image of a furniture piece, identify what it is and list its main component parts with approximate dimensions.

Return ONLY valid JSON in this exact shape — no markdown, no explanation:
{
  "furnitureType": "string (e.g. 'Bookshelf', 'Cabinet', 'Dining Table')",
  "description": "string (one sentence describing the piece)",
  "overallDimensions": {
    "width": number,
    "height": number,
    "depth": number,
    "unit": "string (match the requested units)"
  },
  "parts": [
    {
      "name": "string (e.g. 'Side Panel', 'Top', 'Shelf')",
      "length": number,
      "width": number,
      "thickness": number,
      "notes": "string or null (e.g. 'x2', 'adjustable', 'with dado groove')"
    }
  ]
}

Rules:
- Use the units specified by the caller (inches or millimeters).
- Include all major structural parts. Omit hardware (screws, hinges).
- If a dimension is truly unknown, use null.
- Do not include any text outside the JSON object.

Stock selection rules based on table size:
- Side tables and nightstands (under 24" wide): legs 1.5"×1.5", rails 0.75"×2.5"
- Coffee tables (24-36" wide): legs 1.75"×1.75", rails 0.75"×3.5"
- Dining tables 4 person (36-48" long): legs 2.5"×2.5", rails 0.75"×3.5"
- Dining tables 6 person (60-72" long): legs 3.0"×3.0", rails 1.0"×4.0"
- Dining tables 8+ person (84"+ long): legs 3.5"×3.5", rails 1.5"×4.5"
- Farm/conference tables: legs 3.5"×3.5", rails 1.5"×4.5"

Always return leg width and thickness equal to each other (square legs).
Always return dimensions in decimal inches.`

exports.handler = async (event) => {
  if (event.requestContext?.http?.method === 'OPTIONS' || event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: '' }
  }

  let body
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  const { prompt, image, units = 'inches' } = body || {}

  if (!prompt && !image) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Provide either prompt or image' }) }
  }

  let userContent
  if (image) {
    userContent = [
      { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
      { type: 'text', text: `Identify the furniture in this image and list all major parts with dimensions in ${units}.` }
    ]
  } else {
    userContent = `${prompt}\n\nPlease respond with dimensions in ${units}.`
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent }],
    })

    let text = response.content.find(b => b.type === 'text')?.text || ''
    // Strip markdown code fences if present
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return { statusCode: 502, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Model returned non-JSON response', raw: text.slice(0, 200) }) }
    }

    const enrichedParts = processPartsArray(parsed.parts || [])
    const fullGcode     = buildFullGcode(enrichedParts)
    const responseBody  = { ...parsed, parts: enrichedParts, gcode: fullGcode }

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(responseBody) }
  } catch (err) {
    console.error('Anthropic error:', err)
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message || 'Internal server error' }) }
  }
}
