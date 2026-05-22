import type { Metadata } from 'next'
import './globals.css'
import NavTabs from '@/components/NavTabs'

export const metadata: Metadata = {
  title:       'Document Factory · ForumPHs',
  description: 'Generación de Actas de Asamblea PH · ForumPHs Panamá',
  icons: {
    icon:  '/favicon.ico',
    apple: '/favicon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Cinzel:wght@400;600&family=DM+Sans:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <NavTabs />
        {children}
      </body>
    </html>
  )
}
