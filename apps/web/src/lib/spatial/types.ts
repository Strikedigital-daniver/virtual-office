import type { SupabaseClient } from "@supabase/supabase-js";
import type { SpatialAccessClass } from "@virtual-office/shared";

export type SupabaseServerClient = SupabaseClient;

export interface SpatialEntitlements {
  authUserId: string;
  profileSourceId: string;
  displayName: string;
  templeWorldId: string;
  accessClass: SpatialAccessClass;
}

export interface SpatialEntitlementProvider {
  getSpatialEntitlements(
    supabase: SupabaseServerClient,
  ): Promise<SpatialEntitlements | null>;
}
