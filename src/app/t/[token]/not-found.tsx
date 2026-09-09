import { QrCode } from 'lucide-react'

/**
 * Scoped not-found for /t/<token> — shown when a scanned QR code points to
 * a table that no longer exists (e.g. the QR was regenerated or the table
 * was deleted). Kept friendly and mobile-first: the visitor is almost
 * always a customer sitting at a table, so guide them to ask the staff.
 */
export default function ScanNotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white p-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-orange-50">
        <QrCode className="h-10 w-10 text-orange-500" />
      </div>
      <h1 className="mt-5 text-2xl font-extrabold text-slate-900">
        QR code not recognised
      </h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500">
        This table code is no longer valid — it may have been regenerated or
        replaced. Please ask the restaurant staff for the current QR code or
        call your waiter to take your order.
      </p>
    </div>
  )
}
