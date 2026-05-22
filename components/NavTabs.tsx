'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/',    label: 'Actas',       short: 'Actas' },
  { href: '/bi',  label: 'Informe BI',  short: 'BI' },
  { href: '/fie', label: 'Suite FIE',   short: 'FIE' },
] as const

export default function NavTabs() {
  const pathname = usePathname()

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 200,
      height: '44px',
      background: 'rgba(14,16,24,0.98)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderBottom: '1px solid rgba(92,52,114,0.3)',
      display: 'flex', alignItems: 'center',
      padding: '0 20px', gap: '2px',
    }}>
      {/* Wordmark */}
      <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 0, lineHeight: 1, marginRight: '14px', flexShrink: 0 }}>
        <span style={{ fontFamily: "'EB Garamond', serif", fontWeight: 400, color: 'rgba(240,237,232,0.55)', fontSize: '14px' }}>Forum</span>
        <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, color: '#C4622D', letterSpacing: '0.06em', fontSize: '13px' }}>PH</span>
        <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, color: '#C4622D', letterSpacing: '0.04em', fontSize: '13px' }}>s</span>
      </div>

      {/* Separator */}
      <div style={{ width: '1px', height: '18px', background: 'rgba(92,52,114,0.35)', marginRight: '12px', flexShrink: 0 }} />

      {/* Tabs */}
      {TABS.map(tab => {
        const active = pathname === tab.href
        return (
          <Link key={tab.href} href={tab.href} title={tab.label} style={{ textDecoration: 'none', flexShrink: 0 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              padding: '4px 12px', borderRadius: '7px',
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '11px',
              fontWeight: active ? 600 : 400,
              letterSpacing: '0.05em',
              color: active ? 'var(--parch, #F0EDE8)' : 'rgba(200,196,190,0.35)',
              background: active ? 'rgba(92,52,114,0.2)' : 'transparent',
              border: active ? '1px solid rgba(92,52,114,0.45)' : '1px solid transparent',
              transition: 'all 0.15s ease',
              cursor: 'pointer',
              userSelect: 'none',
            }}>
              {tab.label}
              {active && (
                <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#C4622D', display: 'inline-block', flexShrink: 0 }} />
              )}
            </div>
          </Link>
        )
      })}

      {/* Version tag */}
      <div style={{ marginLeft: 'auto', fontFamily: "'DM Sans', sans-serif", fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(200,196,190,0.18)' }}>
        DF v2.0
      </div>
    </div>
  )
}
