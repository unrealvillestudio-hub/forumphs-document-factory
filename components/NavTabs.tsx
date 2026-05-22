'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/',    label: 'Actas'      },
  { href: '/bi',  label: 'Informe BI' },
  { href: '/fie', label: 'Suite FIE'  },
] as const

export default function NavTabs() {
  const pathname = usePathname()

  return (
    <>
      {/* ── Recursos gráficos globales — instanciados UNA vez en layout ── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=EB+Garamond:wght@400&family=Cinzel:wght@600&family=DM+Sans:wght@400;500;600;700&display=swap');

        /* Grain — textura que rompe el plano liso */
        body::before {
          content: '';
          position: fixed; inset: 0;
          pointer-events: none; z-index: 0;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E");
          background-repeat: repeat; background-size: 180px 180px;
        }

        /* Vignette — profundidad perimetral */
        body::after {
          content: '';
          position: fixed; inset: 0;
          pointer-events: none; z-index: 0;
          background: radial-gradient(ellipse 120% 80% at 50% 50%,
            transparent 40%, rgba(8,6,14,0.45) 100%);
        }

        /* Glow amatista — ambient top-right */
        .fphs-glow-am {
          position: fixed; top: -120px; right: -80px;
          width: 480px; height: 480px; border-radius: 50%;
          background: radial-gradient(circle, rgba(92,52,114,0.12) 0%, transparent 70%);
          pointer-events: none; z-index: 0;
          animation: glow-drift 12s ease-in-out infinite alternate;
        }

        /* Glow terra — ambient bottom-left */
        .fphs-glow-terra {
          position: fixed; bottom: -100px; left: -60px;
          width: 320px; height: 320px; border-radius: 50%;
          background: radial-gradient(circle, rgba(196,98,45,0.07) 0%, transparent 70%);
          pointer-events: none; z-index: 0;
          animation: glow-drift 16s ease-in-out infinite alternate-reverse;
        }

        /* Grid lines — estructura invisible */
        .fphs-grid {
          position: fixed; inset: 0;
          pointer-events: none; z-index: 0;
          background-image:
            linear-gradient(rgba(92,52,114,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(92,52,114,0.025) 1px, transparent 1px);
          background-size: 80px 80px;
          mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, black 20%, transparent 100%);
          -webkit-mask-image: radial-gradient(ellipse 80% 80% at 50% 50%, black 20%, transparent 100%);
        }

        /* Todo contenido por encima del grain */
        main, [data-above] { position: relative; z-index: 1; }

        /* Tab hover */
        .nav-tab:hover {
          color: rgba(240,237,232,0.7) !important;
          background: rgba(196,98,45,0.08) !important;
          border-color: rgba(196,98,45,0.25) !important;
        }

        /* Keyframes */
        @keyframes glow-drift {
          0%   { transform: translate(0,0) scale(1); opacity:.8; }
          100% { transform: translate(20px,30px) scale(1.08); opacity:1; }
        }
        @keyframes sep-shimmer {
          0%,100% { opacity:.2; } 50% { opacity:.65; }
        }
        @keyframes dot-breathe {
          0%,100% { opacity:1; transform:scale(1); }
          50%      { opacity:.5; transform:scale(0.65); }
        }

        @media (prefers-reduced-motion: reduce) {
          .fphs-glow-am, .fphs-glow-terra { animation: none; }
          body::before { display: none; }
        }
      `}</style>

      {/* Ambient layers */}
      <div className="fphs-glow-am"    aria-hidden="true" />
      <div className="fphs-glow-terra" aria-hidden="true" />
      <div className="fphs-grid"       aria-hidden="true" />

      {/* ══ NAVBAR ══════════════════════════════════════════════ */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 200,
        height: '44px',
        background: 'rgba(10,8,16,0.94)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(92,52,114,0.3)',
        display: 'flex', alignItems: 'center',
        padding: '0 20px', gap: '2px',
      }}>

        {/* Shimmer line — guiño de calidad en el top edge del nav */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '1px',
          background: 'linear-gradient(90deg, transparent 0%, rgba(196,98,45,0.55) 30%, rgba(92,52,114,0.65) 65%, transparent 100%)',
          animation: 'sep-shimmer 4s ease-in-out infinite',
        }} aria-hidden="true" />

        {/* Wordmark */}
        <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 0, lineHeight: 1, marginRight: '14px', flexShrink: 0 }}>
          <span style={{ fontFamily: "'EB Garamond', serif", fontWeight: 400, color: 'rgba(240,237,232,0.55)', fontSize: '14px' }}>Forum</span>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, color: '#C4622D', letterSpacing: '0.06em', fontSize: '13px' }}>PH</span>
          <span style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 700, color: '#C4622D', letterSpacing: '0.04em', fontSize: '13px' }}>s</span>
        </div>

        {/* Separator — shimmer sutil */}
        <div style={{
          width: '1px', height: '18px',
          background: 'linear-gradient(to bottom, transparent, rgba(196,98,45,0.45), transparent)',
          marginRight: '12px', flexShrink: 0,
          animation: 'sep-shimmer 4s ease-in-out infinite',
        }} aria-hidden="true" />

        {/* Tabs */}
        {TABS.map(tab => {
          const active = pathname === tab.href
          return (
            <Link key={tab.href} href={tab.href} style={{ textDecoration: 'none', flexShrink: 0 }}>
              <div className="nav-tab" style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '4px 12px', borderRadius: '7px',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '11px',
                fontWeight: active ? 600 : 400,
                letterSpacing: '0.05em',
                /* Terra en activo — el ojo va directo ahí · 3% del total de color */
                color:      active ? '#C4622D'                   : 'rgba(200,196,190,0.35)',
                background: active ? 'rgba(196,98,45,0.1)'       : 'transparent',
                border:     active ? '1px solid rgba(196,98,45,0.35)' : '1px solid transparent',
                transition: 'all 0.2s ease',
                cursor: 'pointer',
                userSelect: 'none' as const,
              }}>
                {tab.label}
                {active && (
                  /* Dot terra — respira, invita a interactuar */
                  <span style={{
                    width: '4px', height: '4px', borderRadius: '50%',
                    background: '#C4622D', display: 'inline-block', flexShrink: 0,
                    animation: 'dot-breathe 2.5s ease-in-out infinite',
                  }} />
                )}
              </div>
            </Link>
          )
        })}

        {/* Version */}
        <div style={{
          marginLeft: 'auto',
          fontFamily: "'Cinzel', serif",
          fontSize: '8px', letterSpacing: '0.18em',
          textTransform: 'uppercase' as const,
          color: 'rgba(200,196,190,0.18)',
        }}>
          DF v2.0
        </div>
      </div>
    </>
  )
}
