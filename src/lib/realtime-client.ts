import { io as serverIo, Socket } from 'socket.io-client'

// Singleton realtime client used across admin / kitchen / waiter / customer views.
// The gateway expects path="/" + port specified as ?XTransformPort=3003.
// Override NEXT_PUBLIC_REALTIME_URL when the realtime gateway lives on a
// separate host (e.g. wss://realtime.example.com).
const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL || '/?XTransformPort=3003'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (socket) return socket
  socket = serverIo(REALTIME_URL, {
    path: '/',
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1200,
    reconnectionDelayMax: 6000,
    timeout: 10_000,
  })
  socket.on('connect_error', (err) => {
    // Non-fatal — realtime is best-effort
     
    console.warn('[realtime] connect_error', err?.message)
  })
  return socket
}

export function emitRealtime(event: string, payload: unknown): void {
  try {
    const s = getSocket()
    if (s.connected) {
      s.emit(event, payload)
    } else {
      s.once('connect', () => s.emit(event, payload))
    }
  } catch {
    // ignore
  }
}
