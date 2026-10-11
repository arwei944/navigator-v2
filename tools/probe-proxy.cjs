// 并发探测本机代理端口：能否 CONNECT 到 github:443（node 侧比 curl 稳）
const net = require('net')
const { readFileSync } = require('fs')

// 端口清单由 bash 的 netstat 生成到 /tmp/ports.txt（本会话 execSync 不可用）
const list = readFileSync(__dirname + '/proxy-ports.txt', 'utf8').split(/\s+/).map(Number).filter(Boolean).sort((a, b) => a - b)
console.log('候选端口', list.length, '个')

function probe(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port })
    let done = false
    const finish = (ok, note) => { if (done) return; done = true; try { sock.destroy() } catch {} resolve({ port, ok, note }) }
    sock.setTimeout(2500)
    sock.on('error', (e) => finish(false, e.code || e.message))
    sock.on('timeout', () => finish(false, 'timeout'))
    sock.on('connect', () => {
      sock.write('CONNECT github.com:443 HTTP/1.1\r\nHost: github.com:443\r\n\r\n')
      let buf = ''
      sock.on('data', (d) => {
        buf += d.toString()
        if (buf.includes('\r\n\r\n')) {
          const status = Number((buf.split(' ')[1] || '0'))
          finish(status === 200, 'CONNECT ' + status)
        }
      })
    })
  })
}

Promise.all(list.map(probe)).then((rs) => {
  const good = rs.filter((r) => r.ok).map((r) => r.port)
  console.log('可 CONNECT github 的端口:', good.length ? good.join(' ') : '(无)')
  const maybe = rs.filter((r) => !r.ok && r.note !== 'timeout' && r.note !== 'ECONNREFUSED').slice(0, 5)
  if (maybe.length) console.log('其他响应:', maybe.map((r) => `${r.port}:${r.note}`).join(' '))
  process.exit(0)
})