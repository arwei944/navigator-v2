import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'

const OUT = process.argv[2] || '_probe-report.json'
const PORT = Number(process.argv[3] || 4599)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '600'
}

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors)
    res.end()
    return
  }
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    if (body) {
      try {
        writeFileSync(OUT, body, 'utf8')
        process.stdout.write(`saved ${body.length} bytes -> ${OUT}\n`)
      } catch (e) {
        process.stdout.write(`write error: ${e.message}\n`)
      }
    } else {
      process.stdout.write('empty body\n')
    }
    res.writeHead(200, { ...cors, 'Content-Type': 'text/plain' })
    res.end('ok')
  })
})

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`collector listening on http://127.0.0.1:${PORT}/report\n`)
})