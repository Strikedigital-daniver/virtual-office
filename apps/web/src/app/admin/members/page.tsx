import type { Metadata } from "next";

export const metadata: Metadata = { title: "Administración no disponible" };

export default function MembersAdminPage() {
  return (
    <section className="panel narrow">
      <h1>Administración no disponible</h1>
      <p>
        El provisioning temporal de oficina está deshabilitado durante la
        integración con Recuerda Club.
      </p>
      <a href="/">Volver al inicio</a>
    </section>
  );
}
