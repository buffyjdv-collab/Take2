/**
 * Repro + fix proof for: "Unable to edit or modify item — invalid input:
 * expected string, received null"
 *
 * The edit dialog round-trips the raw GET row. For items stored with a NULL
 * description / tags (both `String?` in Prisma), the PATCH body contained
 * nulls and menuItemSchema rejected the whole save.
 */
import { menuItemSchema } from '../src/lib/validations'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, extra?: string) {
  if (ok) {
    pass++
    console.log(`  PASS  ${label}`)
  } else {
    fail++
    console.log(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`)
  }
}

console.log('menuItemSchema.partial() — the exact path used by PATCH /api/admin/menu/items/[id]:')

// 1. The bug repro: raw DB row with null description / tags / image
const rawRow = {
  name: 'Masala Dosa',
  description: null,
  image: null,
  tags: null,
  categoryId: 'cat_123',
  basePrice: 80,
}
const r1 = menuItemSchema.partial().safeParse(rawRow)
check(
  'null description + null tags + null image accepted',
  r1.success,
  r1.success ? '' : r1.error.issues[0]?.message,
)

// 2. Transformed values: null -> ''
if (r1.success) {
  check('null description -> ""', r1.data.description === '')
  check('null tags -> ""', r1.data.tags === '')
}

// 3. Image-only edit on an item with null description (the exact user scenario)
const r2 = menuItemSchema.partial().safeParse({
  ...rawRow,
  description: null,
  tags: null,
  image: '/uploads/1738-new-photo.png',
})
check(
  'image change on item with null description/tags succeeds',
  r2.success,
  r2.success ? '' : r2.error.issues[0]?.message,
)
if (r2.success) check('image value preserved', r2.data.image === '/uploads/1738-new-photo.png')

// 4. Real values still validate and are untouched
const r3 = menuItemSchema.partial().safeParse({ description: 'Crispy dosa', tags: 'bestseller' })
check('string description/tags still accepted', r3.success)
if (r3.success) {
  check('string description preserved', r3.data.description === 'Crispy dosa')
  check('string tags preserved', r3.data.tags === 'bestseller')
}

// 5. Missing fields still optional (partial PATCH)
const r4 = menuItemSchema.partial().safeParse({ soldOut: true })
check('partial PATCH without description/tags still works', r4.success)

// 6. Over-length strings still rejected after null-normalisation
const r5 = menuItemSchema.partial().safeParse({ description: 'x'.repeat(601) })
check('>600 char description still rejected', !r5.success)

// 7. Full schema (POST route path) with nulls
const r6 = menuItemSchema.safeParse({ ...rawRow })
check(
  'full-create schema also tolerates nulls',
  r6.success,
  r6.success ? '' : r6.error.issues[0]?.message,
)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
