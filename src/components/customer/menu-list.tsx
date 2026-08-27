'use client'

import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { MenuSection } from './menu-item-card'
import type { MenuItemWithRelations } from './types'

interface MenuListProps {
  categories: Array<{ id: string; name: string; icon?: string | null; description?: string | null }>
  items: MenuItemWithRelations[]
  onSelectItem: (id: string) => void
  activeCategoryId: string
  onActiveCategoryChange: (id: string) => void
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
            className="mb-2 scroll-mt-[108px]"
          >
            <div className="mb-3 mt-4">
              <h2 className="text-[20px] font-extrabold tracking-tight text-slate-900">
                {cat.icon && <span className="mr-1.5">{cat.icon}</span>}
                {cat.name}
                <span className="ml-2 text-[13px] font-medium text-slate-400">
                  ({catItems.length})
                </span>
              </h2>
            </div>
            <div className="flex flex-col">
              {catItems.map((item, idx) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(idx * 0.03, 0.2) }}
                >
                  <MenuSection item={item} onSelect={() => onSelectItem(item.id)} />
                </motion.div>
              ))}
            </div>
          </section>
        )
      })}
    </main>
  )
}
