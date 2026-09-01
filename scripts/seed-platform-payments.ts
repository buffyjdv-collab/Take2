/**
 * Seed platform payment methods (super admin's own payment config).
 * Idempotent — safe to run multiple times.
 *
 * Run via:  bun run scripts/seed-platform-payments.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const DEFAULTS = [
  {
    type: 'UPI',
    label: 'UPI',
    description: 'GPay / PhonePe / Paytm / BHIM',
    icon: 'Smartphone',
    accentColor: '#7C3AED',
    priority: 10,
    config: JSON.stringify({ upiId: 'platform@okhdfcbank' }),
  },
  {
    type: 'QR',
    label: 'Scan QR',
    description: 'Scan our QR with any UPI app',
    icon: 'QrCode',
    accentColor: '#9333EA',
    priority: 20,
    config: JSON.stringify({ upiId: 'platform@okhdfcbank' }),
  },
  {
    type: 'CARD',
    label: 'Credit / Debit Card',
    description: 'Visa · Mastercard · RuPay · Amex',
    icon: 'CreditCard',
    accentColor: '#2563EB',
    priority: 30,
    config: JSON.stringify({ provider: 'MOCK' }),
  },
  {
    type: 'WALLET',
    label: 'Mobile Wallet',
    description: 'PhonePe · Paytm · Mobikwik',
    icon: 'Wallet',
    accentColor: '#F59E0B',
    priority: 40,
    config: JSON.stringify({ provider: 'MOCK' }),
  },
  {
    type: 'NETBANKING',
    label: 'Net Banking',
    description: 'All major Indian banks',
    icon: 'Building2',
    accentColor: '#0891B2',
    priority: 50,
    config: JSON.stringify({ provider: 'MOCK' }),
  },
]

async function main() {
  for (const d of DEFAULTS) {
    const existing = await db.platformPaymentMethod.findFirst({
      where: { type: d.type },
    })
    if (existing) {
      await db.platformPaymentMethod.update({
        where: { id: existing.id },
        data: {
          label: d.label,
          description: d.description,
          icon: d.icon,
          accentColor: d.accentColor,
          priority: d.priority,
        },
      })
      console.log(`[platform-payment-methods] updated ${d.type}`)
    } else {
      await db.platformPaymentMethod.create({
        data: { ...d, active: true },
      })
      console.log(`[platform-payment-methods] created ${d.type}`)
    }
  }
  console.log('Done.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
