'use client'

import { useRef, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface CategoryTabsProps {
  categories: Array<{ id: string; name: string; icon?: string | null }>
  activeId: string
  onChange: (id: string) => void
}

export function CategoryTabs({ categories, activeId, onChange }: CategoryTabsProps) {
  const effectiveActive = activeId || categories[0]?.id || ''
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateScrollState = () => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 4)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
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
  }, [categories.length])

  useEffect(() => {
    if (!effectiveActive || !scrollRef.current) return
    const idx = categories.findIndex((c) => c.id === effectiveActive)
    if (idx < 0) return
    const tabEl = scrollRef.current.children[idx] as HTMLElement | undefined
    if (tabEl) {
      tabEl.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      })
    }
    setTimeout(updateScrollState, 250)
  }, [effectiveActive, categories.length])

  const selectCategory = (id: string) => {
    onChange(id)
    const el = document.getElementById(`cat-${id}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const scrollByTabs = (dir: 'left' | 'right') => {
    const el = scrollRef.current
    if (!el) return
    const delta = el.clientWidth * 0.7
    el.scrollBy({
      left: dir === 'left' ? -delta : delta,
      behavior: 'smooth',
    })
  }

  return (
    <div className="sticky top-[57px] z-20 -mb-px border-b border-slate-100 bg-white">
      <div className="mx-auto max-w-3xl px-2">
        <div className="relative">
          {/* Left gradient fade */}
          {canScrollLeft && (
            <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-8 bg-gradient-to-r from-white to-transparent" />
          )}

          {/* Right gradient fade */}
          {canScrollRight && (
            <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-8 bg-gradient-to-l from-white to-transparent" />
          )}

          {/* Left chevron */}
          {canScrollLeft && (
            <button
              onClick={() => scrollByTabs('left')}
              className="absolute left-1 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white text-slate-500 shadow-md ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900"
              aria-label="Scroll categories left"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}

          {/* Tabs row */}
          <div
            ref={scrollRef}
            className="flex gap-0 overflow-x-auto py-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{
              scrollSnapType: 'x mandatory',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            {categories.map((c) => {
              const active = c.id === effectiveActive
              return (
                <button
                  key={c.id}
                  onClick={() => selectCategory(c.id)}
                  style={{ scrollSnapAlign: 'center' }}
                  className={cn(
                    'relative shrink-0 px-4 py-3.5 text-[13px] font-medium transition-colors',
                    active
                      ? 'text-orange-600'
                      : 'text-slate-500 hover:text-slate-800',
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    {c.icon && <span className="text-sm">{c.icon}</span>}
                    {c.name}
                  </span>
                  {/* Underline indicator — Swiggy style */}
                  {active && (
                    <span className="absolute inset-x-3 -bottom-px h-[3px] rounded-full bg-orange-600 transition-all" />
                  )}
                </button>
              )
            })}
          </div>

          {/* Right chevron */}
          {canScrollRight && (
            <button
              onClick={() => scrollByTabs('right')}
              className="absolute right-1 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white text-slate-500 shadow-md ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900"
              aria-label="Scroll categories right"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
