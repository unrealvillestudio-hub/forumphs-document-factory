'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

const TABS = [
  { href: '/',   label: 'Actas',      icon: '📄', title: 'Generación de Actas' },
  { href: '/bi', label: 'Informe BI', icon: '📊', title: 'Informe Mensual de Gestión' },
];

export default function NavTabs() {
  const path = usePathname();

  return (
    <div style={{
      position: 'sticky',
      top: 0,
      zIndex: 200,
      height: 44,
      background: 'rgba(14,16,24,0.98)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderBottom: '1px solid rgba(92,52,114,0.3)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 20px',
      gap: 2,
    }}>

      {/* Logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/FPHS_logo-wt.png"
        alt="ForumPHs"
        style={{ height: 15, width: 'auto', opacity: 0.55, marginRight: 14, flexShrink: 0 }}
      />

      {/* Separator */}
      <div style={{ width: 1, height: 18, background: 'rgba(92,52,114,0.35)', marginRight: 12, flexShrink: 0 }} />

      {/* Tabs */}
      {TABS.map(tab => {
        const active = path === tab.href || (tab.href !== '/' && path.startsWith(tab.href));
        return (
          <Link
            key={tab.href}
            href={tab.href}
            title={tab.title}
            style={{ textDecoration: 'none', flexShrink: 0 }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 12px',
              borderRadius: 7,
              fontSize: 11,
              fontFamily: "'DM Sans', sans-serif",
              fontWeight: active ? 600 : 400,
              letterSpacing: '0.05em',
              color: active ? 'var(--parch)' : 'rgba(200,196,190,0.35)',
              background: active ? 'rgba(92,52,114,0.2)' : 'transparent',
              border: active ? '1px solid rgba(92,52,114,0.45)' : '1px solid transparent',
              transition: 'all 0.15s ease',
              cursor: 'pointer',
              userSelect: 'none' as const,
            }}>
              <span style={{ fontSize: 10, lineHeight: 1 }}>{tab.icon}</span>
              {tab.label}
              {active && (
                <span style={{
                  width: 4,
                  height: 4,
                  borderRadius: '50%',
                  background: 'var(--terra)',
                  display: 'inline-block',
                  flexShrink: 0,
                }} />
              )}
            </div>
          </Link>
        );
      })}

      {/* Right: subtle version tag */}
      <div style={{
        marginLeft: 'auto',
        fontSize: 9,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'rgba(200,196,190,0.18)',
        fontFamily: "'DM Sans', sans-serif",
      }}>
        DF v1.5
      </div>
    </div>
  );
}
