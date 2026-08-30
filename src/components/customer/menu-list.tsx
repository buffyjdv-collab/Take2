'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, ChevronRight as ArrowRight } from 'lucide-react'
import { MenuItemCardCompact } from './menu-item-card'
import type { MenuItemWithRelations } from './types'

interface MenuListProps {
  categories: Array<{ id: string; name: string; icon?: string | null; description?: string | null }>
  items: MenuItemWithRelations[]
  onSelectItem: (id: string) => void
  activeCategoryId: string
  onActiveCategoryChange: (id: string) => void
}

/**
 * CategoryCarousel
 * Horizontal, finger-swipeable carousel of compact menu item cards laid out
 * as **2 columns** — each viewport shows two cards side-by-side, with a small
 * peek of the next card inviting a swipe. Native `scroll-snap` provides the
 * finger-friendly momentum snapping on touch devices.
 *
 * Implementation notes:
 *  - Outer container: `overflow-x-auto` + `scroll-snap-type: x mandatory`
 *  - Inner: simple flex row, each card `basis-[46%] shrink-0 snap-start`
 *    → 2 cards × 46% + gap-2.5 (10px) ≈ 92% of viewport, leaving an 8% peek
 *  - `WebkitOverflowScrolling: touch` enables native momentum on iOS
 *  - Scrollbars hidden for a clean look
 */
function CategoryCarousel({
  id,
  items,
  onSelectItem,
}: {
  id: string
  items: MenuItemWithRelations[]
  onSelectItem: (id: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const updateScrollState = () => {
    const el = scrollRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  useEffect(() => {
    updateScrollState()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', updateScrollState, { passive: true })
    window.addEventListener('resize', updateScrollState)
    return () => {
      el.removeEventListener('scroll', updateScrollState)
      window.removeEventListener('resize', updateScrollState)
    }
  }, [items.length])

  const scrollByPage = (dir: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    // Advance by roughly 2 card widths (= one "page" of 2 columns).
    const delta = el.clientWidth * 0.85
    el.scrollBy({
      left: dir === 'left' ? -delta : delta,
      behavior: 'smooth',
    })
  }

  return (
    <div className="relative">
      {/* Left edge fade */}
      {canLeft && (
        <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-6 bg-gradient-to-r from-slate-50 to-transparent" />
      )}
      {/* Right edge fade */}
      {canRight && (
        <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-6 bg-gradient-to-l from-slate-50 to-transparent" />
      )}

      {/* Left chevron (desktop / non-touch) */}
      {canLeft && (
        <button
          onClick={() => scrollByPage('left')}
          className="absolute -left-2 top-1/2 z-20 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white text-slate-600 shadow-md ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900 sm:flex"
          aria-label="Scroll items left"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      {/* Right chevron */}
      {canRight && (
        <button
          onClick={() => scrollByPage('right')}
          className="absolute -right-2 top-1/2 z-20 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white text-slate-600 shadow-md ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900 sm:flex"
          aria-label="Scroll items right"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}

      <div
        ref={scrollRef}
        className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {items.map((item, idx) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(idx * 0.02, 0.15) }}
            className="shrink-0 basis-[46%] snap-start sm:basis-[220px]"
          >
            <MenuItemCardCompact item={item} onSelect={() => onSelectItem(item.id)} />
          </motion.div>
        ))}
        {/* Trailing spacer so the last card can snap to start without being
            glued to the right edge of the viewport. */}
        <div className="shrink-0 basis-2" aria-hidden="true" />
      </div>
    </div>
  )
}

export function MenuList({
  categories,
  items,
  onSelectItem,
  activeCategoryId,
  onActiveCategoryChange,
}: MenuListProps) {
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible.length === 0) return
        const top = visible[0]
        const id = (top.target as HTMLElement).dataset.categoryId
        if (id && id !== activeCategoryId) {
          onActiveCategoryChange(id)
        }
      },
      {
        rootMargin: '-100px 0px -60% 0px',
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    )
    Object.values(sectionRefs.current).forEach((el) => {
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [categories, activeCategoryId, onActiveCategoryChange])

  return (
    <main className="mx-auto max-w-3xl px-4 pb-36 pt-3">
      {categories.map((cat) => {
        const catItems = items.filter((i) => i.category?.id === cat.id)
        if (catItems.length === 0) return null
        return (
          <section
            key={cat.id}
            id={`cat-${cat.id}`}
            data-category-id={cat.id}
            ref={(el) => {
              sectionRefs.current[cat.id] = el
            }}
            className="mb-5 scroll-mt-[108px]"
          >
            {/* Category header */}
            <div className="mb-2.5 mt-3 flex items-end justify-between gap-2">
              <div className="min-w-0">
                <h2 className="flex items-center gap-1.5 text-[19px] font-extrabold tracking-tight text-slate-900">
                  {cat.icon && <span className="text-base">{cat.icon}</span>}
                  <span className="truncate">{cat.name}</span>
                  <span className="ml-1 text-[12px] font-medium text-slate-400">
                    {catItems.length}
                  </span>
                </h2>
                {cat.description && (
                  <p className="mt-0.5 line-clamp-1 text-[12px] text-slate-500">
                    {cat.description}
                  </p>
                )}
              </div>
              {/* Subtle "swipe →" hint — only shown on touch when there are enough items */}
              {catItems.length > 2 && (
                <span className="hidden shrink-0 items-center gap-0.5 text-[11px] font-medium text-slate-400 sm:flex">
                  Swipe
                  <ArrowRight className="h-3 w-3" />
                </span>
              )}
            </div>

            {/* Swipeable carousel */}
            <CategoryCarousel
              id={cat.id}
              items={catItems}
              onSelectItem={onSelectItem}
            />
          </section>
        )
      })}
    </main>
  )
}
