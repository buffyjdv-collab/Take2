import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export interface CustomerMenuData {
  restaurant: {
    id: string
    name: string
    logo?: string | null
    tagline?: string | null
    description?: string | null
    address: string
    phone: string
    isOpen: boolean
    openingTime: string
    closingTime: string
    currencySymbol: string
    primaryColor: string
    accentColor: string
    taxRate: number
    serviceChargeRate: number
    acceptUpi: boolean
    acceptCard: boolean
    acceptCash: boolean
    acceptCounter: boolean
    upiId?: string | null
    settings?: any
  }
  table: {
    id: string
    number: string
    label?: string | null
    capacity: number
    status: string
  }
  categories: any[]
  items: any[]
  restaurantWideModifierGroups: any[]
}

export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  let data: any
  try {
    data = await res.json()
  } catch {
    throw new Error(`Request failed (${res.status}) — the server returned an invalid response.`)
  }
  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`)
  }
  return (data && data.data !== undefined ? data.data : data) as T
}

export function useCustomerMenu(tableToken: string | null) {
  return useQuery({
    queryKey: ['customer-menu', tableToken],
    queryFn: () => api<CustomerMenuData>(`/api/customer/menu?table=${tableToken}`),
    enabled: !!tableToken,
    staleTime: 60_000,
  })
}

export function useCustomerOrder(orderId: string | null) {
  return useQuery({
    queryKey: ['customer-order', orderId],
    queryFn: () => api<any>(`/api/customer/order/${orderId}`),
    enabled: !!orderId,
    refetchInterval: 15_000,
  })
}

export function usePlaceOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: any) =>
      api<any>('/api/customer/order', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-order'] })
    },
  })
}

export function useCancelOrder() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderId: string) =>
      api<any>(`/api/customer/order/${orderId}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-order'] })
    },
  })
}

// Fetch ALL active (non-completed, non-cancelled) orders for a given customer
// phone number at the table's restaurant. Used by the multi-order tracking
// list so the customer can see every active order they've placed (e.g. after
// placing a follow-up "order more items" order while a previous one is still
// in progress).
export function useCustomerActiveOrders(phone: string | null, tableToken: string | null) {
  return useQuery({
    queryKey: ['customer-active-orders', phone, tableToken],
    queryFn: () =>
      api<{ orders: any[]; restaurantId: string }>(
        `/api/customer/orders/active?phone=${encodeURIComponent(phone!)}&table=${tableToken}`,
      ),
    enabled: !!phone && !!tableToken,
    refetchInterval: 15_000,
  })
}

export function useCreateServiceRequest() {
  return useMutation({
    mutationFn: (body: any) =>
      api<any>('/api/customer/service-request', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  })
}

export function useInitiatePayment() {
  return useMutation({
    mutationFn: (body: {
      orderId: string
      method:
        | 'UPI'
        | 'QR'
        | 'CARD'
        | 'WALLET'
        | 'NETBANKING'
        | 'CASH'
        | 'COUNTER'
        | 'PAY_LATER'
        | 'CUSTOM'
      paymentMethodId?: string
    }) =>
      api<any>('/api/customer/payment/initiate', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  })
}

export function useVerifyPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { paymentId: string; providerTxnId: string }) =>
      api<any>('/api/customer/payment/verify', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-order'] })
    },
  })
}

// ---------------- Admin hooks ----------------

export function useAdminDashboard() {
  return useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => api<any>('/api/admin/dashboard'),
    refetchInterval: 30_000,
  })
}

export function useAdminOrders(params: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '') qs.set(k, String(v))
  })
  return useQuery({
    queryKey: ['admin-orders', params],
    queryFn: () => api<any>(`/api/admin/orders?${qs.toString()}`),
    refetchInterval: 20_000,
  })
}

export function useAdminOrder(id: string | null) {
  return useQuery({
    queryKey: ['admin-order', id],
    queryFn: () => api<any>(`/api/admin/orders/${id}`),
    enabled: !!id,
  })
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string
      status: string
      cancelReason?: string
    }) =>
      api<any>(`/api/admin/orders/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-orders'] })
      qc.invalidateQueries({ queryKey: ['admin-order'] })
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] })
    },
  })
}

// Restaurant owner / cashier requests customer payment before accepting (PRE)
// or after the order is served (POST).
export function useRequestPayment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, when }: { id: string; when: 'PRE' | 'POST' }) =>
      api<any>(`/api/admin/orders/${id}/request-payment`, {
        method: 'POST',
        body: JSON.stringify({ when }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-orders'] })
      qc.invalidateQueries({ queryKey: ['admin-order'] })
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] })
    },
  })
}

// Waiter / owner / manager / cashier marks an order as paid in cash.
// The acting user's name is recorded on the order (cashReceivedByName) so the
// payments report can attribute the collection to a specific person.
export function useMarkCashPaid() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, method }: { id: string; method?: 'CASH' | 'COUNTER' }) =>
      api<any>(`/api/admin/orders/${id}/mark-cash-paid`, {
        method: 'POST',
        body: JSON.stringify({ method: method || 'CASH' }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-orders'] })
      qc.invalidateQueries({ queryKey: ['admin-order'] })
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] })
    },
  })
}

export function useAdminCategories() {
  return useQuery({
    queryKey: ['admin-categories'],
    queryFn: () => api<any[]>(`/api/admin/menu/categories`),
  })
}

export function useAdminMenuItems() {
  return useQuery({
    queryKey: ['admin-menu-items'],
    queryFn: () => api<any[]>(`/api/admin/menu/items`),
  })
}

export function useAdminModifierGroups() {
  return useQuery({
    queryKey: ['admin-modifier-groups'],
    queryFn: () => api<any[]>(`/api/admin/menu/modifier-groups`),
  })
}

export function useAdminTables() {
  return useQuery({
    queryKey: ['admin-tables'],
    queryFn: () => api<any[]>(`/api/admin/tables`),
  })
}

export function useAdminStaff() {
  return useQuery({
    queryKey: ['admin-staff'],
    queryFn: () => api<any[]>(`/api/admin/staff`),
  })
}

export function useAdminReports(range: string, from?: string, to?: string) {
  const qs = new URLSearchParams({ range })
  if (from) qs.set('from', from)
  if (to) qs.set('to', to)
  return useQuery({
    queryKey: ['admin-reports', range, from, to],
    queryFn: () => api<any>(`/api/admin/reports?${qs.toString()}`),
  })
}

export function useAdminSettings(restaurantId?: string) {
  const qs = restaurantId ? `?restaurantId=${restaurantId}` : ''
  return useQuery({
    queryKey: ['admin-settings', restaurantId],
    queryFn: () => api<any>(`/api/admin/settings${qs}`),
  })
}

// ---------------- Payment Methods (Zepto-style) ----------------

export function usePaymentMethods(restaurantId?: string) {
  const qs = restaurantId ? `?restaurantId=${restaurantId}` : ''
  return useQuery<{ methods: any[]; presets: any[] }>({
    queryKey: ['admin-payment-methods', restaurantId],
    queryFn: () => api(`/api/admin/payment-methods${qs}`),
  })
}

export function useCreatePaymentMethod(restaurantId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: any) =>
      api<any>(`/api/admin/payment-methods${restaurantId ? `?restaurantId=${restaurantId}` : ''}`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-payment-methods'] })
      qc.invalidateQueries({ queryKey: ['admin-settings'] })
    },
  })
}

export function useUpdatePaymentMethod(restaurantId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Record<string, unknown>) =>
      api<any>(`/api/admin/payment-methods/${id}${restaurantId ? `?restaurantId=${restaurantId}` : ''}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-payment-methods'] })
      qc.invalidateQueries({ queryKey: ['admin-settings'] })
    },
  })
}

export function useDeletePaymentMethod(restaurantId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      api<any>(`/api/admin/payment-methods/${id}${restaurantId ? `?restaurantId=${restaurantId}` : ''}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-payment-methods'] })
      qc.invalidateQueries({ queryKey: ['admin-settings'] })
    },
  })
}

export function useReorderPaymentMethods(restaurantId?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      api<any>(`/api/admin/payment-methods/reorder${restaurantId ? `?restaurantId=${restaurantId}` : ''}`, {
        method: 'POST',
        body: JSON.stringify({ orderedIds }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-payment-methods'] })
    },
  })
}

export function useAdminServiceRequests(status?: string) {
  const qs = status ? `?status=${status}` : ''
  return useQuery({
    queryKey: ['admin-service-requests', status],
    queryFn: () => api<any[]>(`/api/admin/service-requests${qs}`),
    refetchInterval: 20_000,
  })
}
