const Anthropic = require('@anthropic-ai/sdk')

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
- Do not include any text outside the JSON object.`

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

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(parsed) }
  } catch (err) {
    console.error('Anthropic error:', err)
    return { statusCode: 500, headers: CORS_HEADERS, body: JSON.stringify({ error: err.message || 'Internal server error' }) }
  }
}
