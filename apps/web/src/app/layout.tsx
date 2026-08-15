import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { PwaRegistration } from "@/components/pwa-registration";

import "./styles.css";

export const metadata: Metadata = {
  title: {
    default: "Oficina virtual",
    template: "%s · Oficina virtual",
  },
  description: "Oficina privada para un equipo pequeño.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#151320",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <div className="site-shell">
          <header className="site-header">
            <a className="brand" href="/">
              mhcave
            </a>
            <span className="stage-badge">Fundación</span>
          </header>
          <main>{children}</main>
        </div>
        <PwaRegistration />
      </body>
    </html>
  );
}
