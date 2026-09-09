import { io, Socket } from 'socket.io-client'

// Server-side socket client used by API routes to publish events
// to the realtime mini-service running on port 3003.
const REALTIME_URL = 'http://localhost:3003'

let socket: Socket | null = null

function getSocket(): Socket {
  if (socket) return socket
  socket = io(REALTIME_URL, {
    path: '/',
    transports: ['websocket'],
    reconnection: true,
    // The realtime service may start AFTER this Next.js process (or restart
    // on its own) — never give up trying to reach it.
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5_000,
    timeout: 4_000,
  })
  return socket
}

export interface RealtimeEnvelope<T = unknown> {
  type?: string
  restaurantId: string
  payload: T
}

// Events published while the realtime service is unreachable are queued here
// (bounded) and flushed as soon as the connection is (re)established, so a
// service restart never permanently silences live updates.
const pending: Array<[string, RealtimeEnvelope]> = []
let flushHooked = false

/**
 * Publish an event to all realtime subscribers. Best-effort: failures
 * are logged but never bubble up to the caller (we never want a socket
 * glitch to break an order placement).
 */
export function publishRealtime<T = unknown>(
  event: string,
  envelope: RealtimeEnvelope<T>,
): void {
  try {
    const s = getSocket()
    if (s.connected) {
      s.emit(event, envelope)
      return
    }
    // Not connected — queue the event and kick the client into reconnecting
    // (the built-in reconnection gives up after its attempts are exhausted;
    // connect() restarts it). On connect, flush everything queued.
    if (pending.length < 200) pending.push([event, envelope])
    if (s.disconnected) s.connect()
    if (!flushHooked) {
      flushHooked = true
      s.on('connect', () => {
        const queue = pending.splice(0)
        for (const [evt, env] of queue) {
          try {
            s.emit(evt, env)
          } catch {
            // best-effort
          }
        }
      })
    }
  } catch (err) {
    console.warn('[realtime-publish] failed:', (err as Error)?.message)
  }
}
