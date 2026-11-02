import "./globals.css";
import { interTight, jetbrainsMono } from "./fonts";
import { SiteNav } from "../components/SiteNav";

export const metadata = { title: "Eashan Kadam" };

/** Runs before first paint so a stored theme choice never flashes the other theme. */
const THEME_SCRIPT = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${interTight.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
