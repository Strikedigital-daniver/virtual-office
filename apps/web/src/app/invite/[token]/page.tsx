import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Aceptar invitación" };

export default function InvitationPage() {
  redirect("/login");
}
