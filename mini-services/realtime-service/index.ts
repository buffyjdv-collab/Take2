import { createServer } from 'http'
import { Server } from 'socket.io'

// HARD-CODED port — do not use env (per project rules)
const PORT = 3003

const httpServer = createServer((req, res) => {
  // Simple health check
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, service: 'realtime', port: PORT }))
    return
  }
  res.writeHead(404)
  res.end('Not found')
})

const io = new Server(httpServer, {
  // Caddy uses path="/" + ?XTransformPort=3003 — keep path as "/"
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60_000,
  pingInterval: 25_000,
})

interface RealtimeEnvelope<T = unknown> {
  type?: string
  restaurantId?: string
  payload?: T
  [k: string]: unknown
}

io.on('connection', (socket) => {
  // eslint-disable-next-line no-console
  console.log(`[realtime] client connected: ${socket.id}`)

  // Allow clients to subscribe to a specific restaurant's events
  socket.on('subscribe:restaurant', (restaurantId: string) => {
    if (restaurantId) socket.join(`restaurant:${restaurantId}`)
  })

  // Server-emitted events from API routes
  const forward = (
    event: string,
    envelope: RealtimeEnvelope,
  ) => {
    // Broadcast globally — clients filter by restaurantId.
    // (No client currently joins restaurant rooms; the extra room-scoped
    // emit used to deliver EVERY event TWICE to room members, double-firing
    // customer toasts. Global-only keeps delivery exactly once.)
    io.emit(event, envelope)
  }

  // Pass-through forwarding so API routes can emit and have the server rebroadcast
  ;[
    'order:new',
    'order:updated',
    'order:statusChanged',
    'service:new',
    'payment:confirmed',
    'table:updated',
    'menu:updated',
    // Platform fee lifecycle events
    'platform:feeRequested',
    'platform:feePaymentInit',
    'platform:feePaid',
    'platform:feeCollected',
    'platform:feeOverdue',
  ].forEach((evt) => {
    socket.on(evt, (data: RealtimeEnvelope) => forward(evt, data))
  })

  socket.on('disconnect', (reason) => {
    // eslint-disable-next-line no-console
    console.log(`[realtime] client disconnected: ${socket.id} (${reason})`)
  })
})

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[realtime] socket.io listening on port ${PORT}`)
})
