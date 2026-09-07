/**
 * UPI payment helpers — generate deep links and QR data for UPI payments.
 */

/**
 * Build a UPI deep link (upi://pay?...) for the given UPI ID, amount, and
 * order reference. This link, when opened on a mobile device, will launch the
 * user's default UPI app (GPay / PhonePe / Paytm / BHIM etc.) pre-filled with
 * the payment details.
 *
 * @param upiId      The merchant's UPI VPA (e.g. "restaurant@okhdfcbank")
 * @param amount     The amount in INR (e.g. 250.00)
 * @param orderRef   A short order reference (e.g. "SG-000123")
 * @param merchantName  Optional merchant name to show in the UPI app
 */
export function buildUpiDeepLink(
  upiId: string,
  amount: number,
  orderRef: string,
  merchantName?: string,
): string {
  const params = new URLSearchParams({
    pa: upiId, // payee address (VPA)
    am: amount.toFixed(2), // amount
    cu: 'INR', // currency
    tn: `Order ${orderRef}`, // transaction note
  })
  if (merchantName) {
    params.set('pn', merchantName) // payee name
  }
  // tr = transaction reference (unique per order)
  params.set('tr', orderRef.replace(/[^a-zA-Z0-9]/g, ''))
  return `upi://pay?${params.toString()}`
}

/**
 * Generate the string that should be encoded into a QR code for UPI payment.
 * This is the same deep link — UPI QR codes are just the upi:// URL encoded
 * as a QR code. Any UPI app can scan this QR and initiate the payment.
 */
export function buildUpiQrPayload(
  upiId: string,
  amount: number,
  orderRef: string,
  merchantName?: string,
): string {
  return buildUpiDeepLink(upiId, amount, orderRef, merchantName)
}
