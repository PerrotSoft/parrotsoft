export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <head>
        <title>ParrotSoft</title>
      </head>
      <body style={{ fontFamily: 'sans-serif', margin: '2rem' }}>
        {children}
      </body>
    </html>
  )
}
