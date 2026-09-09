'use client'

import { useEffect, useRef, useState } from 'react'
import { getSocket } from '@/lib/realtime-client'
import type { Socket } from 'socket.io-client'

/**
 * Subscribe to realtime socket events.
 * Returns the socket instance plus a connection flag.
 */
export function useSocket() {
  const [isConnected, setIsConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    const s = getSocket()
    socketRef.current = s
    setIsConnected(s.connected)
    const onConn = () => setIsConnected(true)
    const onDisc = () => setIsConnected(false)
    s.on('connect', onConn)
    s.on('disconnect', onDisc)
    return () => {
      s.off('connect', onConn)
      s.off('disconnect', onDisc)
    }
  }, [])

  return { socket: socketRef.current, isConnected }
}

/**
 * Subscribe to a specific realtime event.
 *
 * NOTE on envelope shape: API routes publish via `publishRealtime()` which
 * wraps the actual payload in `{ restaurantId, payload }`, and the realtime
 * mini-service re-broadcasts that envelope as-is. Consumers (order tracking,
 * app shell, …) only care about the inner payload — so we unwrap it here,
 * centrally. Handlers therefore receive the real payload (e.g. `{ orderId,
 * status, … }`) and NOT the envelope. If an event ever arrives without the
 * envelope wrapper it is passed through unchanged.
 */
export function useSocketEvent<T = unknown>(
  event: string,
  handler: (payload: T) => void,
) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    const s = getSocket()
    const listener = (arg: unknown) => {
      const unwrapped =
        arg &&
        typeof arg === 'object' &&
        'payload' in (arg as Record<string, unknown>) &&
        (arg as Record<string, unknown>).payload !== undefined
          ? (arg as Record<string, unknown>).payload
          : arg
      handlerRef.current(unwrapped as T)
    }
    s.on(event, listener)
    return () => {
      s.off(event, listener)
    }
  }, [event])
}
