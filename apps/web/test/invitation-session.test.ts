import { describe, expect, it } from "vitest";

import { parseImplicitSessionHash } from "@/lib/implicit-session";

describe("Supabase default invitation compatibility", () => {
  it("extracts the implicit session returned by the default invite template", () => {
    expect(
      parseImplicitSessionHash(
        "#access_token=access-value&refresh_token=refresh-value&type=invite",
      ),
    ).toEqual({
      access_token: "access-value",
      refresh_token: "refresh-value",
    });
  });

  it("rejects incomplete URL fragments", () => {
    expect(parseImplicitSessionHash("#access_token=access-value")).toBeNull();
    expect(parseImplicitSessionHash("")).toBeNull();
  });
});
