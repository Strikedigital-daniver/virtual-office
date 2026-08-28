import { describe, expect, it } from "vitest";

import { usernameToEmail } from "@/lib/usernames";

describe("username to email mapping", () => {
  it("normalizes case and whitespace", () => {
    expect(usernameToEmail("  Daniver ")).toBe("daniver@mhcave.invalid");
    expect(usernameToEmail("PABLO")).toBe("pablo@mhcave.invalid");
  });

  it("rejects symbols, spaces and empty input", () => {
    expect(usernameToEmail("dan iver")).toBeNull();
    expect(usernameToEmail("dani@ver")).toBeNull();
    expect(usernameToEmail("")).toBeNull();
    expect(usernameToEmail("a")).toBeNull();
  });
});
