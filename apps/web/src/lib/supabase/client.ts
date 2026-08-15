"use client";

import { createBrowserClient } from "@supabase/ssr";

import { requirePublicEnvironment } from "@/lib/env";

export function createClient() {
  const environment = requirePublicEnvironment();
  return createBrowserClient(
    environment.supabaseUrl,
    environment.supabasePublishableKey,
  );
}
