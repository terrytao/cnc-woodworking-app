const http = require('http')
const { handler } = require('./handler')

const PORT = process.env.PORT || 3001

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    })
    res.end()
    return
  }

  if (req.method !== 'POST') {
    res.writeHead(405)
    res.end('Method Not Allowed')
    return
  }

  let rawBody = ''
  req.on('data', chunk => { rawBody += chunk })
  req.on('end', async () => {
    const event = {
      body: rawBody,
      httpMethod: req.method,
      requestContext: { http: { method: req.method } },
    }
    try {
      const result = await handler(event)
      res.writeHead(result.statusCode, result.headers)
      res.end(result.body)
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: err.message }))
    }
  })
})

server.listen(PORT, () => {
  console.log(`Local backend running at http://localhost:${PORT}`)
})
