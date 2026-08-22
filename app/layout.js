import './globals.css';
import ClientInterface from './ClientInterface';
import {
  syncDrive,
  getUserFiles,
  syncProjects,
  getProjects,
  getBalance,
  setBalance,
  createPaySession,
  finalizeAndAddBalance,
  getAllUsersRaw,
} from './actions';

export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }) {
  const users = await getAllUsersRaw();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>ParrotSoft</title>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var t = localStorage.getItem('p_theme_mode');
                if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body>
        <ClientInterface
          serverDB={users}
          dbActions={{
            syncDrive,
            getUserFiles,
            syncProjects,
            getProjects,
            getBalance,
            setBalance,
            createPaySession,
            finalizeAndAddBalance
          }}
        >
          {children}
        </ClientInterface>
      </body>
    </html>
  );
}
