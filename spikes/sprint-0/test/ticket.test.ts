import { describe, expect, it } from "vitest";
import { issueTicket, verifyTicket } from "../src/worker/ticket";

const secret = "unit-test-signing-secret-at-least-thirty-two-characters";

describe("short-lived spike tickets", () => {
  it("round-trips signed claims without exposing the signing secret", async () => {
    const now = 1_700_000_000_000;
    const issued = await issueTicket({ roomId: "sprint-0", displayName: "Ana" }, secret, now);
    const claims = await verifyTicket(issued.token, secret, now + 1_000);

    expect(claims.clientId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(claims.roomId).toBe("sprint-0");
    expect(claims.displayName).toBe("Ana");
    expect(issued.token).not.toContain(secret);
  });

  it("rejects tampering and expiration", async () => {
    const now = 1_700_000_000_000;
    const issued = await issueTicket({ roomId: "sprint-0", displayName: "Ana" }, secret, now);
    await expect(verifyTicket(`${issued.token}x`, secret, now)).rejects.toThrow();
    await expect(verifyTicket(issued.token, secret, now + 16 * 60 * 1_000)).rejects.toThrow(
      "Ticket expired",
    );
  });
});

