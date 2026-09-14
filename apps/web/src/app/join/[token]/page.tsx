import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Entrar a la oficina" };

export default function JoinPage() {
  redirect("/login");
}
