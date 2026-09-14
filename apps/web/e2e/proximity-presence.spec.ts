import { test, expect } from "@playwright/test";

import { loadE2eCredentials } from "./helpers/env";
import { moveUntilDistance, settle } from "./helpers/movement";
import {
  NEAR_MAX_DISTANCE,
} from "./helpers/proximity-contract";
import { E2E_TIMING } from "./helpers/timing";
import {
  createInstrumentedContext,
  launchBrowser,
  loginAndEnterOffice,
  readSelfUserId,
  readPeerDistancePx,
  waitForRemotePeer,
} from "./helpers/session";

/**
 * Smoke rápido (~2 min): presencia, peers y contrato de proximidad sin WebRTC/SFU.
 * Útil cuando ICE falla o para CI barato.
 *
 *   npm run test:media-e2e:smoke --workspace @virtual-office/web
 */
test.describe.serial("Proximidad presencia (staging)", () => {
  test("dos sesiones QA se ven y respetan distancias", async () => {
    test.setTimeout(3 * 60_000);

    const creds = loadE2eCredentials();
    if ("blocked" in creds) {
      test.skip(true, creds.blocked);
      return;
    }

    const browserA = await launchBrowser();
    const browserB = await launchBrowser();

    const sessionA = await createInstrumentedContext(browserA, {
      label: creds.userA.label,
      baseUrl: creds.baseUrl,
      email: creds.userA.email,
      password: creds.userA.password,
      syntheticProfile: "alpha",
    });
    const sessionB = await createInstrumentedContext(browserB, {
      label: creds.userB.label,
      baseUrl: creds.baseUrl,
      email: creds.userB.email,
      password: creds.userB.password,
      syntheticProfile: "beta",
    });

    try {
      await loginAndEnterOffice(
        sessionA.page,
        creds.baseUrl,
        creds.userA.email,
        creds.userA.password,
      );
      await loginAndEnterOffice(
        sessionB.page,
        creds.baseUrl,
        creds.userB.email,
        creds.userB.password,
      );

      sessionA.userId = await readSelfUserId(sessionA.page);
      sessionB.userId = await readSelfUserId(sessionB.page);

      await waitForRemotePeer(sessionA.page, sessionB.userId!);
      await waitForRemotePeer(sessionB.page, sessionA.userId!);
      await settle(E2E_TIMING.defaultSettleMs);

      await moveUntilDistance(
        sessionA.page,
        { max: NEAR_MAX_DISTANCE },
        { remoteUserId: sessionB.userId! },
      );
      await moveUntilDistance(
        sessionB.page,
        { max: NEAR_MAX_DISTANCE },
        { remoteUserId: sessionA.userId! },
      );
      await settle(E2E_TIMING.defaultSettleMs + 1_000);

      const nearReading = await readPeerDistancePx(
        sessionB.page,
        sessionA.userId!,
      );
      expect(nearReading, "distancia cerca vía panel/diag").not.toBeNull();
      expect(nearReading!.distance).toBeLessThanOrEqual(NEAR_MAX_DISTANCE + 32);
    } finally {
      await sessionA.context.close().catch(() => undefined);
      await sessionB.context.close().catch(() => undefined);
      await browserA.close().catch(() => undefined);
      await browserB.close().catch(() => undefined);
    }
  });
});
