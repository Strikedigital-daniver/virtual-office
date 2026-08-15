import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "mhcave · Oficina virtual privada",
    short_name: "mhcave",
    description: "Oficina privada para un equipo pequeño.",
    start_url: "/",
    display: "standalone",
    background_color: "#0d0c12",
    theme_color: "#151320",
    orientation: "landscape",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
