const http = require('http')

const base = (process.env.BASE_PATH || '').trim().replace(/\/+$/, '')
const port = process.env.PORT || 3000
const path = base ? `${base}/health` : '/health'

http
  .get(`http://127.0.0.1:${port}${path}`, (res) => {
    res.resume()
    process.exit(res.statusCode === 200 ? 0 : 1)
  })
  .on('error', () => process.exit(1))
