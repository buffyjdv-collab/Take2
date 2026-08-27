import bcrypt from 'bcryptjs'
import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { db } from '@/lib/db'

// Role hierarchy for permission checks
export const ROLE_HIERARCHY: Record<string, string[]> = {
  SUPER_ADMIN: ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'KITCHEN_STAFF', 'WAITER', 'CASHIER'],
  RESTAURANT_OWNER: ['RESTAURANT_OWNER', 'MANAGER', 'KITCHEN_STAFF', 'WAITER', 'CASHIER'],
  MANAGER: ['MANAGER', 'KITCHEN_STAFF', 'WAITER', 'CASHIER'],
  KITCHEN_STAFF: ['KITCHEN_STAFF'],
  WAITER: ['WAITER'],
  CASHIER: ['CASHIER'],
}

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  RESTAURANT_OWNER: 'Restaurant Owner',
  MANAGER: 'Manager',
  KITCHEN_STAFF: 'Kitchen Staff',
  WAITER: 'Waiter',
  CASHIER: 'Cashier',
}

export const ALL_ROLES = [
  'SUPER_ADMIN',
  'RESTAURANT_OWNER',
  'MANAGER',
  'KITCHEN_STAFF',
  'WAITER',
  'CASHIER',
] as const

// ----------------------------------------------------------------------------
// GRANULAR RBAC CATALOG — molecular permission matrix
// ----------------------------------------------------------------------------
// Each resource exposes a set of actions (CRUD + view/manage). The super admin
// can toggle any (role, resource, action) tuple via the RBAC manager UI.
// When a row exists in `RolePermission` it OVERRIDES the static default below.
// When no row exists, the static default applies (the `DEFAULT_PERMISSIONS`
// map below preserves backward compatibility with the original PERMISSIONS map).

export interface ResourceSpec {
  key: string
  label: string
  actions: string[] // typically ['CREATE','READ','UPDATE','DELETE'] but may include VIEW, MANAGE, VERIFY, etc.
}

export const RBAC_RESOURCES: ResourceSpec[] = [
  { key: 'DASHBOARD', label: 'Dashboard', actions: ['VIEW'] },
  { key: 'MENU_ITEM', label: 'Menu Items', actions: ['CREATE', 'READ', 'UPDATE', 'DELETE'] },
  { key: 'MENU_CATEGORY', label: 'Menu Categories', actions: ['CREATE', 'READ', 'UPDATE', 'DELETE'] },
  { key: 'MODIFIER_GROUP', label: 'Modifier Groups', actions: ['CREATE', 'READ', 'UPDATE', 'DELETE'] },
  { key: 'TABLE', label: 'Tables & QR', actions: ['CREATE', 'READ', 'UPDATE', 'DELETE'] },
  { key: 'ORDER', label: 'Orders', actions: ['READ', 'UPDATE_STATUS', 'CANCEL'] },
  { key: 'KITCHEN', label: 'Kitchen Display', actions: ['VIEW'] },
  { key: 'WAITER', label: 'Waiter Dashboard', actions: ['VIEW'] },
  { key: 'BILLING', label: 'Billing', actions: ['MANAGE'] },
  { key: 'PAYMENT', label: 'Payments', actions: ['VERIFY', 'MANAGE'] },
  { key: 'REPORTS', label: 'Reports', actions: ['VIEW'] },
  { key: 'STAFF', label: 'Staff', actions: ['CREATE', 'READ', 'UPDATE', 'DELETE'] },
  { key: 'SETTINGS', label: 'Restaurant Settings', actions: ['MANAGE'] },
  { key: 'RESTAURANTS', label: 'Platform — Tenants', actions: ['MANAGE'] },
  { key: 'PLATFORM_USERS', label: 'Platform — All Users', actions: ['VIEW'] },
  { key: 'PLATFORM_FEES', label: 'Platform — Fees', actions: ['MANAGE'] },
  { key: 'RBAC', label: 'Platform — RBAC', actions: ['MANAGE'] },
]

// Map of (resource.action) -> [roles] — used as the default when no DB override exists.
// This preserves the original PERMISSIONS map semantics so existing code keeps working.
export const DEFAULT_PERMISSIONS: Record<string, string[]> = {
  // Admin/dashboard access
  'DASHBOARD.VIEW': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'CASHIER'],
  // Menu management
  'MENU_ITEM.CREATE': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  'MENU_ITEM.READ': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'KITCHEN_STAFF', 'WAITER', 'CASHIER'],
  'MENU_ITEM.UPDATE': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  'MENU_ITEM.DELETE': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  'MENU_CATEGORY.CREATE': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  'MENU_CATEGORY.READ': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  'MENU_CATEGORY.UPDATE': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  'MENU_CATEGORY.DELETE': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  'MODIFIER_GROUP.CREATE': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  'MODIFIER_GROUP.READ': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  'MODIFIER_GROUP.UPDATE': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  'MODIFIER_GROUP.DELETE': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  // Table & QR management
  'TABLE.CREATE': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  'TABLE.READ': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER'],
  'TABLE.UPDATE': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  'TABLE.DELETE': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  // Order management
  'ORDER.READ': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'KITCHEN_STAFF', 'WAITER', 'CASHIER'],
  'ORDER.UPDATE_STATUS': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'KITCHEN_STAFF', 'WAITER'],
  'ORDER.CANCEL': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'CASHIER'],
  // Kitchen display
  'KITCHEN.VIEW': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'KITCHEN_STAFF'],
  // Waiter
  'WAITER.VIEW': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER'],
  // Billing & payments
  'BILLING.MANAGE': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'CASHIER'],
  'PAYMENT.VERIFY': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'CASHIER'],
  'PAYMENT.MANAGE': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'CASHIER'],
  // Reports
  'REPORTS.VIEW': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'CASHIER'],
  // Staff management
  'STAFF.CREATE': ['SUPER_ADMIN', 'RESTAURANT_OWNER'],
  'STAFF.READ': ['SUPER_ADMIN', 'RESTAURANT_OWNER'],
  'STAFF.UPDATE': ['SUPER_ADMIN', 'RESTAURANT_OWNER'],
  'STAFF.DELETE': ['SUPER_ADMIN', 'RESTAURANT_OWNER'],
  // Restaurant settings
  'SETTINGS.MANAGE': ['SUPER_ADMIN', 'RESTAURANT_OWNER'],
  // Multi-restaurant management (super admin only)
  'RESTAURANTS.MANAGE': ['SUPER_ADMIN'],
  'PLATFORM_USERS.VIEW': ['SUPER_ADMIN'],
  'PLATFORM_FEES.MANAGE': ['SUPER_ADMIN'],
  'RBAC.MANAGE': ['SUPER_ADMIN'],
}

// Legacy permission keys still used by older code paths (e.g. 'dashboard.view',
// 'menu.create'). We keep an alias map so old callers keep working.
export const LEGACY_PERMISSION_ALIAS: Record<string, string> = {
  'dashboard.view': 'DASHBOARD.VIEW',
  'menu.create': 'MENU_ITEM.CREATE',
  'menu.update': 'MENU_ITEM.UPDATE',
  'menu.delete': 'MENU_ITEM.DELETE',
  'tables.manage': 'TABLE.UPDATE',
  'orders.view': 'ORDER.READ',
  'orders.update_status': 'ORDER.UPDATE_STATUS',
  'orders.cancel': 'ORDER.CANCEL',
  'kitchen.view': 'KITCHEN.VIEW',
  'waiter.view': 'WAITER.VIEW',
  'billing.manage': 'BILLING.MANAGE',
  'payments.verify': 'PAYMENT.VERIFY',
  'reports.view': 'REPORTS.VIEW',
  'staff.manage': 'STAFF.READ',
  'settings.manage': 'SETTINGS.MANAGE',
  'restaurants.manage': 'RESTAURANTS.MANAGE',
}

// Backward-compat export — callers use `PERMISSIONS` directly.
export const PERMISSIONS = DEFAULT_PERMISSIONS

// ----------------------------------------------------------------------------
// In-process cache for DB-backed permission overrides.
// We avoid hitting the DB on every hasPermission() call by caching the override
// map for 30 seconds. The cache is keyed by role.
// ----------------------------------------------------------------------------

type OverrideMap = Record<string, boolean> // key: `${resource}.${action}` -> allowed
const overrideCache = new Map<string, { expiresAt: number; data: OverrideMap }>()
const CACHE_TTL_MS = 30_000

async function loadOverridesForRole(role: string): Promise<OverrideMap> {
  const cached = overrideCache.get(role)
  if (cached && cached.expiresAt > Date.now()) return cached.data
  try {
    const rows = await db.rolePermission.findMany({ where: { role } })
    const map: OverrideMap = {}
    for (const r of rows) {
      map[`${r.resource}.${r.action}`] = r.allowed
    }
    overrideCache.set(role, { expiresAt: Date.now() + CACHE_TTL_MS, data: map })
    return map
  } catch {
    // DB unavailable (e.g. during build or first-run) — fall back to static.
    return {}
  }
}

/** Clear the in-memory override cache (call after super admin updates RBAC). */
export function invalidateRbacCache(role?: string) {
  if (role) overrideCache.delete(role)
  else overrideCache.clear()
}

// ----------------------------------------------------------------------------
// Permission check helpers
// ----------------------------------------------------------------------------

/**
 * Check whether a role has the given permission.
 *
 * Permission key may be in either:
 *   - Legacy form:  'menu.create', 'dashboard.view', etc.
 *   - New form:     'MENU_ITEM.CREATE', 'ORDER.READ', etc.
 *
 * Resolution order:
 *   1. SUPER_ADMIN always has every permission (except legacy 'restaurants.manage'
 *      which is super-admin-only anyway).
 *   2. If a DB override exists for (role, resource, action), use it.
 *   3. Otherwise fall back to DEFAULT_PERMISSIONS.
 */
export function hasPermission(role: string, permission: string): boolean {
  // SUPER_ADMIN has every permission
  if (role === 'SUPER_ADMIN') return true

  // Normalise the permission key to the new RESOURCE.ACTION form
  const normKey = LEGACY_PERMISSION_ALIAS[permission] || permission.toUpperCase()
  const defaultRoles = DEFAULT_PERMISSIONS[normKey]
  if (!defaultRoles) return false
  if (!defaultRoles.includes(role)) {
    // Static default denies — but a DB override might still allow.
    // We only consult overrides synchronously if already cached; the async
    // variant `hasPermissionAsync` should be used by API routes for accuracy.
    const cached = overrideCache.get(role)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data[normKey] === true
    }
    return false
  }
  // Static default allows — a DB override might still deny.
  const cached = overrideCache.get(role)
  if (cached && cached.expiresAt > Date.now()) {
    if (normKey in cached.data) return cached.data[normKey]
  }
  return true
}

/**
 * Async variant of hasPermission — consults the DB for overrides.
 * Use this in API route handlers (server-side) for accurate RBAC decisions.
 */
export async function hasPermissionAsync(
  role: string,
  permission: string,
): Promise<boolean> {
  if (role === 'SUPER_ADMIN') return true
  const normKey = LEGACY_PERMISSION_ALIAS[permission] || permission.toUpperCase()
  const defaultRoles = DEFAULT_PERMISSIONS[normKey]
  if (!defaultRoles) return false
  const overrides = await loadOverridesForRole(role)
  if (normKey in overrides) return overrides[normKey] === true
  return defaultRoles.includes(role)
}

export function canAccessRole(actorRole: string, targetRole: string): boolean {
  if (actorRole === 'SUPER_ADMIN') return true
  const allowed = ROLE_HIERARCHY[actorRole] || []
  return allowed.includes(targetRole)
}

// ----------------------------------------------------------------------------
// MODULE ACCESS (sidebar visibility)
// ----------------------------------------------------------------------------

// All sidebar module keys (must match `key` values in src/components/sidebar.tsx NAV array).
export const SIDEBAR_MODULES: Array<{ key: string; label: string; group: 'platform' | 'restaurant' }> = [
  // Platform
  { key: 'platform-dashboard', label: 'Platform Overview', group: 'platform' },
  { key: 'platform-restaurants', label: 'Tenants', group: 'platform' },
  { key: 'platform-users', label: 'All Users', group: 'platform' },
  { key: 'platform-fees', label: 'Platform Fees', group: 'platform' },
  { key: 'platform-fee-config', label: 'Fee Configuration', group: 'platform' },
  { key: 'platform-plans', label: 'Plans & Billing', group: 'platform' },
  { key: 'platform-rbac', label: 'RBAC & Modules', group: 'platform' },
  // Restaurant
  { key: 'dashboard', label: 'Dashboard', group: 'restaurant' },
  { key: 'orders', label: 'Orders', group: 'restaurant' },
  { key: 'menu', label: 'Menu', group: 'restaurant' },
  { key: 'modifiers', label: 'Modifiers', group: 'restaurant' },
  { key: 'tables', label: 'Tables & QR', group: 'restaurant' },
  { key: 'kitchen', label: 'Kitchen', group: 'restaurant' },
  { key: 'waiter', label: 'Waiter', group: 'restaurant' },
  { key: 'billing', label: 'Billing', group: 'restaurant' },
  { key: 'reports', label: 'Reports', group: 'restaurant' },
  { key: 'staff', label: 'Staff', group: 'restaurant' },
  { key: 'settings', label: 'Settings', group: 'restaurant' },
]

// Default visibility per module (when no DB override exists).
// This mirrors the original `permission` field on each NAV item.
export const DEFAULT_MODULE_VISIBILITY: Record<string, string[]> = {
  'platform-dashboard': ['SUPER_ADMIN'],
  'platform-restaurants': ['SUPER_ADMIN'],
  'platform-users': ['SUPER_ADMIN'],
  'platform-fees': ['SUPER_ADMIN'],
  'platform-fee-config': ['SUPER_ADMIN'],
  'platform-plans': ['SUPER_ADMIN'],
  'platform-rbac': ['SUPER_ADMIN'],
  dashboard: ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'CASHIER'],
  orders: ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'KITCHEN_STAFF', 'WAITER', 'CASHIER'],
  menu: ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  modifiers: ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  tables: ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  kitchen: ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'KITCHEN_STAFF'],
  waiter: ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER'],
  billing: ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'CASHIER'],
  reports: ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'CASHIER'],
  staff: ['SUPER_ADMIN', 'RESTAURANT_OWNER'],
  settings: ['SUPER_ADMIN', 'RESTAURANT_OWNER'],
}

// In-process cache for module visibility overrides
const moduleCache = new Map<string, { expiresAt: number; data: Record<string, boolean> }>()

async function loadModuleOverridesForRole(role: string): Promise<Record<string, boolean>> {
  const cached = moduleCache.get(role)
  if (cached && cached.expiresAt > Date.now()) return cached.data
  try {
    const rows = await db.roleModuleAccess.findMany({ where: { role } })
    const map: Record<string, boolean> = {}
    for (const r of rows) {
      map[r.moduleKey] = r.visible
    }
    moduleCache.set(role, { expiresAt: Date.now() + CACHE_TTL_MS, data: map })
    return map
  } catch {
    return {}
  }
}

/** Clear the in-memory module-visibility cache (call after super admin updates RBAC). */
export function invalidateModuleCache(role?: string) {
  if (role) moduleCache.delete(role)
  else moduleCache.clear()
}

/**
 * Check whether a role can see a sidebar module.
 * Resolution order:
 *   1. SUPER_ADMIN sees every module.
 *   2. If a DB override exists for (role, moduleKey), use it.
 *   3. Otherwise fall back to DEFAULT_MODULE_VISIBILITY.
 */
export function hasModuleAccess(role: string, moduleKey: string): boolean {
  if (role === 'SUPER_ADMIN') return true
  const defaultRoles = DEFAULT_MODULE_VISIBILITY[moduleKey]
  if (!defaultRoles) return false
  const cached = moduleCache.get(role)
  if (cached && cached.expiresAt > Date.now()) {
    if (moduleKey in cached.data) return cached.data[moduleKey]
  }
  return defaultRoles.includes(role)
}

/** Async variant — use server-side for accurate decisions. */
export async function hasModuleAccessAsync(
  role: string,
  moduleKey: string,
): Promise<boolean> {
  if (role === 'SUPER_ADMIN') return true
  const defaultRoles = DEFAULT_MODULE_VISIBILITY[moduleKey]
  if (!defaultRoles) return false
  const overrides = await loadModuleOverridesForRole(role)
  if (moduleKey in overrides) return overrides[moduleKey]
  return defaultRoles.includes(role)
}

/**
 * Filter a list of module keys down to the ones the role can see.
 * Server-side: pre-fetches all overrides for the role in one query.
 */
export async function getVisibleModulesForRole(
  role: string,
  moduleKeys: string[],
): Promise<string[]> {
  if (role === 'SUPER_ADMIN') return moduleKeys
  const overrides = await loadModuleOverridesForRole(role)
  return moduleKeys.filter((k) => {
    if (k in overrides) return overrides[k]
    const def = DEFAULT_MODULE_VISIBILITY[k]
    return def ? def.includes(role) : false
  })
}

// ----------------------------------------------------------------------------
// NextAuth configuration
// ----------------------------------------------------------------------------

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        try {
          const user = await db.user.findUnique({
            where: { email: credentials.email.toLowerCase() },
            include: { restaurant: true, branch: true },
          })
          if (!user || !user.active) return null
          const valid = await bcrypt.compare(credentials.password, user.passwordHash)
          if (!valid) return null
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            restaurantId: user.restaurantId,
            branchId: user.branchId,
            restaurantName: user.restaurant?.name,
            restaurantSlug: user.restaurant?.slug,
          } as any
        } catch (err) {
          console.error('[auth] authorize error:', err)
          return null
        }
      },
    }),
  ],
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: '/' },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id
        token.role = (user as any).role
        token.restaurantId = (user as any).restaurantId
        token.branchId = (user as any).branchId
        token.restaurantName = (user as any).restaurantName
        token.restaurantSlug = (user as any).restaurantSlug
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        ;(session.user as any).id = token.id
        ;(session.user as any).role = token.role
        ;(session.user as any).restaurantId = token.restaurantId
        ;(session.user as any).branchId = token.branchId
        ;(session.user as any).restaurantName = token.restaurantName
        ;(session.user as any).restaurantSlug = token.restaurantSlug
      }
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET || 'spice-garden-quick-order-secret-key-2026-very-long-and-stable-do-not-change',
  // Gracefully handle stale JWT cookies — don't crash the page, just treat as no session
  logger: {
    error(code: string, message: any) {
      if (code === 'JWT_SESSION_ERROR') {
        console.warn('[next-auth] Stale JWT cookie — user will be asked to sign in again.')
        return
      }
      console.error(`[next-auth][${code}]`, message)
    },
  },
}
