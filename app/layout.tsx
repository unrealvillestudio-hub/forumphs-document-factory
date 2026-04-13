import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Document Factory · ForumPHs',
  description: 'Generación de Actas de Asamblea PH · ForumPHs Panamá',
  icons: {
    icon: '/favicon.ico',
    apple: '/favicon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}