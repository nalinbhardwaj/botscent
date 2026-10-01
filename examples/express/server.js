// The server half on Express, required from CommonJS. Express runs at the origin,
// which cannot see whether a CDN in front of it stores HTML, so the Server-Timing
// transport is off unless turned on with botscent({ transport: 'always' }).
const express = require('express')
const { botscent } = require('botscent/express')

const app = express()
app.use(botscent())

// The request verdict is req.botscent. The stale botscent entry stands in for one a
// cache might replay; the middleware removes it from every response.
app.all('/verdict', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
  res.set('Server-Timing', 'botscent;desc="1;chatgpt;1;signer.web-bot-auth.verified", app;dur=1')
  res.json({ verdict: req.botscent, bytes: Buffer.isBuffer(req.body) ? req.body.length : 0 })
})

app.listen(Number(process.env.PORT ?? 3000), '127.0.0.1')
