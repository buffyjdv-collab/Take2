'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { QrCode, UtensilsCrossed, Zap, BarChart3, BellRing, Loader2, CheckCircle2, Sparkles, Building2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { Separator } from '@/components/ui/separator'
import { SignupWizard } from './signup-wizard'
import { PLANS } from '@/lib/plans'

// Demo-account autofill is a DEV/DEMO convenience. It is hidden unless
// NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS=true is set at BUILD time (NEXT_PUBLIC_*
// vars are inlined into the client bundle) — production leaves it unset so
// no credentials appear on the home page.
const SHOW_DEMO_CREDENTIALS =
  process.env.NEXT_PUBLIC_SHOW_DEMO_CREDENTIALS === 'true'

const DEMO_CREDS = [
  { role: 'Owner', email: 'owner@spicegarden.in' },
  { role: 'Manager', email: 'manager@spicegarden.in' },
  { role: 'Chef', email: 'chef1@spicegarden.in' },
  { role: 'Waiter', email: 'waiter1@spicegarden.in' },
  { role: 'Cashier', email: 'cashier@spicegarden.in' },
  { role: 'Super Admin', email: 'admin@platform.com' },
]

export function LandingPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [signupOpen, setSignupOpen] = useState(false)
  const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY')

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })
      if (res?.error) {
        toast.error('Invalid email or password')
      } else {
        toast.success('Signed in — welcome back!')
        // Force a refresh so server component re-reads session
        setTimeout(() => window.location.reload(), 200)
      }
    } catch (err) {
      toast.error('Sign-in failed')
    } finally {
      setLoading(false)
    }
  }

  const quickLogin = (cred: { email: string; role: string }) => {
    if (!SHOW_DEMO_CREDENTIALS) return
    setEmail(cred.email)
    setPassword('password123')
    toast.info(`Loaded ${cred.role} demo credentials`)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 via-white to-white">
      {/* Nav */}
      <nav className="border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-600 text-white">
              <UtensilsCrossed className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-bold leading-tight">QR Dine</p>
              <p className="text-[10px] text-muted-foreground">Restaurant OS</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSignupOpen(true)}
              className="text-orange-700 hover:bg-orange-50"
            >
              <Building2 className="mr-1.5 h-4 w-4" />
              Start free
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const el = document.getElementById('login')
                el?.scrollIntoView({ behavior: 'smooth' })
              }}
            >
              Sign in
            </Button>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-4">
        {/* Hero */}
        <section className="grid gap-8 py-10 lg:grid-cols-2 lg:py-16">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col justify-center"
          >
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
              <Zap className="h-3 w-3" /> Scan-to-order SaaS for modern restaurants
            </span>
            <h1 className="mt-4 text-4xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-5xl">
              Turn every table into a{' '}
              <span className="text-orange-600">contactless</span> ordering point
            </h1>
            <p className="mt-4 text-base text-muted-foreground">
              Customers scan a QR, browse your menu, customise their dishes,
              and place orders that flow straight into your kitchen — with
              real-time tracking, integrated billing, and live reports.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                size="lg"
                className="bg-orange-600 text-white hover:bg-orange-700"
                onClick={() => setSignupOpen(true)}
              >
                <Building2 className="mr-2 h-5 w-5" />
                Start your restaurant — free trial
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => {
                  window.location.href = '/?table=sg-5-1tgesbnhbx'
                }}
              >
                <QrCode className="mr-2 h-5 w-5" />
                Scan demo menu
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => {
                  const el = document.getElementById('login')
                  el?.scrollIntoView({ behavior: 'smooth' })
                }}
              >
                Staff sign in
              </Button>
            </div>
            <div className="mt-6 flex flex-wrap gap-6 text-xs text-muted-foreground">
              <Stat label="Avg order time saved" value="12 min" />
              <Stat label="Restaurants onboarded" value="340+" />
              <Stat label="Orders processed" value="2.4M+" />
            </div>
          </motion.div>

          {/* Right: phone mockup */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            className="flex justify-center lg:justify-end"
          >
            <div className="relative w-[280px]">
              <div className="aspect-[9/19] rounded-[2rem] border-8 border-slate-900 bg-white shadow-2xl">
                <div className="flex h-full flex-col">
                  <div className="h-6 rounded-t-[1.4rem] bg-slate-900" />
                  <div className="h-1 bg-orange-600" />
                  <div className="flex-1 space-y-2 p-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-600 text-white">
                        <UtensilsCrossed className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-xs font-bold">Spice Garden</p>
                        <p className="text-[9px] text-muted-foreground">Table T5 · Bengaluru</p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[9px] text-orange-700">Starters</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px]">Biryani</span>
                    </div>
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-100 p-1.5">
                        <div className="h-10 w-10 rounded-md bg-orange-100" />
                        <div className="flex-1">
                          <p className="text-[10px] font-semibold">Chicken Biryani</p>
                          <p className="text-[8px] text-muted-foreground">Aromatic basmati rice…</p>
                          <p className="text-[10px] font-bold text-orange-600">₹280</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="m-2 flex items-center justify-between rounded-full bg-orange-600 px-3 py-2 text-white">
                    <span className="text-[10px] font-semibold">View cart · 2</span>
                    <span className="text-[10px] font-bold">₹450</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </section>

        {/* Feature strip */}
        <section className="grid gap-3 py-8 sm:grid-cols-2 lg:grid-cols-4">
          <Feature
            icon={Zap}
            title="Scan-to-order"
            desc="QR codes per table — customers order without an app or signup."
          />
          <Feature
            icon={BellRing}
            title="Real-time kitchen"
            desc="Orders land instantly in the KDS; status updates flow back to customers."
          />
          <Feature
            icon={BarChart3}
            title="Live reports"
            desc="Sales by hour, best-sellers, tax collected, payment breakdowns."
          />
          <Feature
            icon={QrCode}
            title="QR & table ops"
            desc="Generate, regenerate and print QR codes; manage tables & sections."
          />
        </section>

        {/* Pricing */}
        <section id="pricing" className="py-10">
          <div className="mb-6 text-center">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
              <Sparkles className="h-3 w-3" /> Simple, transparent pricing
            </span>
            <h2 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">
              Plans that scale with your restaurant
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Start free for 14 days. No credit card required. Cancel anytime.
            </p>
            <div className="mt-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              <button
                onClick={() => setBillingCycle('MONTHLY')}
                className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${
                  billingCycle === 'MONTHLY' ? 'bg-white shadow-sm text-slate-900' : 'text-muted-foreground'
                }`}
              >
                Monthly
              </button>
              <button
                onClick={() => setBillingCycle('YEARLY')}
                className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-colors ${
                  billingCycle === 'YEARLY' ? 'bg-white shadow-sm text-slate-900' : 'text-muted-foreground'
                }`}
              >
                Yearly <span className="text-emerald-600">-17%</span>
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Object.values(PLANS).map((plan) => {
              const price = billingCycle === 'YEARLY' ? plan.yearlyPrice : plan.monthlyPrice
              const highlight = plan.highlight
              return (
                <div
                  key={plan.id}
                  className={`relative flex flex-col rounded-2xl border bg-white p-5 ${
                    highlight ? 'border-orange-600 shadow-lg shadow-orange-100' : 'border-slate-200'
                  }`}
                >
                  {highlight && (
                    <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-orange-600 px-3 py-0.5 text-[10px] font-bold uppercase text-white">
                      Most popular
                    </span>
                  )}
                  <p className="text-sm font-bold text-slate-900">{plan.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{plan.tagline}</p>
                  <div className="mt-3">
                    <span className="text-3xl font-extrabold">₹{price}</span>
                    <span className="text-xs text-muted-foreground">/mo</span>
                  </div>
                  <Button
                    onClick={() => setSignupOpen(true)}
                    className={`mt-4 ${
                      highlight
                        ? 'bg-orange-600 text-white hover:bg-orange-700'
                        : 'bg-slate-900 text-white hover:bg-slate-800'
                    }`}
                    size="sm"
                  >
                    {plan.id === 'TRIAL' ? 'Start free trial' : `Choose ${plan.name}`}
                  </Button>
                  <ul className="mt-4 space-y-1.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-1.5 text-xs text-slate-700">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </div>
        </section>

        <Separator className="my-6" />

        {/* Login */}
        <section id="login" className="grid gap-6 py-10 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Sign in to your dashboard</CardTitle>
              <CardDescription>
                Use your staff credentials to access the restaurant operations dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-3">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@restaurant.com"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full bg-orange-600 text-white hover:bg-orange-700"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…
                    </>
                  ) : (
                    'Sign in'
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {SHOW_DEMO_CREDENTIALS && (
            <Card className="bg-orange-50/50">
              <CardHeader>
                <CardTitle className="text-base">Demo accounts</CardTitle>
                <CardDescription>
                  All demo accounts use the password{' '}
                  <code className="rounded bg-white px-1 py-0.5 text-xs">
                    password123
                  </code>
                  . Tap a role to autofill.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {DEMO_CREDS.map((c) => (
                  <button
                    key={c.email}
                    onClick={() => quickLogin(c)}
                    className="flex items-center justify-between rounded-lg border border-orange-200 bg-white px-3 py-2 text-left text-sm transition-colors hover:bg-orange-50"
                  >
                    <div>
                      <p className="font-semibold">{c.role}</p>
                      <p className="text-xs text-muted-foreground">{c.email}</p>
                    </div>
                    <span className="text-xs text-orange-600">Use →</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          )}
        </section>

        <footer className="border-t py-6 text-center text-xs text-muted-foreground">
          <p>
            QR Dine · Restaurant operations platform ·
            <a href="/?table=sg-5-1tgesbnhbx" className="ml-1 text-orange-600">
              Try the customer scan demo
            </a>
          </p>
        </footer>
      </main>

      {/* Signup wizard */}
      <SignupWizard
        open={signupOpen}
        onOpenChange={setSignupOpen}
        onSuccess={() => {
          // Pre-fill login form so user can immediately sign in
          setTimeout(() => {
            // Force a session refresh; signup wizard will call reload
          }, 100)
        }}
      />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-lg font-bold text-slate-900">{value}</p>
      <p>{label}</p>
    </div>
  )
}

function Feature({
  icon: Icon,
  title,
  desc,
}: {
  icon: any
  title: string
  desc: string
}) {
  return (
    <div className="rounded-xl border border-orange-100 bg-white p-4">
      <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-orange-100 text-orange-700">
        <Icon className="h-5 w-5" />
      </div>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </div>
  )
}
