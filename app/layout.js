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
    <html lang="en">
      <head>
        <title>ParrotSoft</title>
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
