import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "AuraOS Infinity Pro",
  description: "Web-based Operating System",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
        <style dangerouslySetInnerHTML={{ __html: `[data-nextjs-toast], [data-nextjs-build-indicator], #next-js-feedback-button { display: none !important; }` }} />
      </body>
    </html>
  );
}