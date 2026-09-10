import {
  computeProximityFactors,
  decideSpatialSubscription,
  DEFAULT_PROXIMITY_MEDIA_CONFIG,
  OFFICE_MAP,
  type ProximityMediaConfig,
  type ProximityZone,
  type SpatialAccessClass,
} from "@virtual-office/shared";

export interface WorldPosition {
  x: number;
  y: number;
  zoneId: string | null;
}

export interface RemoteProximitySnapshot {
  remoteUserId: string;
  distance: number;
  audioFactor: number;
  videoFactor: number;
  zone: ProximityZone;
  desiredAudioSubscription: boolean;
  desiredVideoSubscription: boolean;
  desiredSubscription: boolean;
  authorizationReason: string;
  audioAuthorizationReason: string;
  videoAuthorizationReason: string;
}

interface RemoteTrackSubscriptionState {
  audioSubscribed: boolean;
  audioSubscribedSinceMs: number | null;
  audioPendingUnsubscribeAtMs: number | null;
  videoSubscribed: boolean;
  videoSubscribedSinceMs: number | null;
  videoPendingUnsubscribeAtMs: number | null;
}

export class ProximityMediaController {
  private readonly states = new Map<string, RemoteTrackSubscriptionState>();

  constructor(
    private readonly config: ProximityMediaConfig = DEFAULT_PROXIMITY_MEDIA_CONFIG,
  ) {}

  evaluate(
    local: WorldPosition | null,
    remotes: Map<string, WorldPosition>,
    nowMs: number = performance.now(),
    subscriberAccessClass?: SpatialAccessClass,
    broadcastSpeakerIds: ReadonlySet<string> = new Set(),
  ): RemoteProximitySnapshot[] {
    if (!local) return [];

    const snapshots: RemoteProximitySnapshot[] = [];
    for (const [remoteUserId, remote] of remotes) {
      const factors = computeProximityFactors(
        Math.hypot(local.x - remote.x, local.y - remote.y),
        this.config,
      );
      const prev =
        this.states.get(remoteUserId) ??
        ({
          audioSubscribed: false,
          audioSubscribedSinceMs: null,
          audioPendingUnsubscribeAtMs: null,
          videoSubscribed: false,
          videoSubscribedSinceMs: null,
          videoPendingUnsubscribeAtMs: null,
        } satisfies RemoteTrackSubscriptionState);

      const mediaOptions = {
        publisherUserId: remoteUserId,
        broadcastSpeakerUserIds: broadcastSpeakerIds,
      };

      const audioDecision = decideSpatialSubscription(
        {
          subscriber: local,
          publisher: remote,
          nowMs,
          wasSubscribed: prev.audioSubscribed,
          subscribedSinceMs: prev.audioSubscribedSinceMs,
          pendingUnsubscribeAtMs: prev.audioPendingUnsubscribeAtMs,
        },
        this.config,
        OFFICE_MAP,
        subscriberAccessClass ? { subscriberAccessClass } : undefined,
        { ...mediaOptions, trackKind: "audio" },
      );

      const videoDecision = decideSpatialSubscription(
        {
          subscriber: local,
          publisher: remote,
          nowMs,
          wasSubscribed: prev.videoSubscribed,
          subscribedSinceMs: prev.videoSubscribedSinceMs,
          pendingUnsubscribeAtMs: prev.videoPendingUnsubscribeAtMs,
        },
        this.config,
        OFFICE_MAP,
        subscriberAccessClass ? { subscriberAccessClass } : undefined,
        { ...mediaOptions, trackKind: "video" },
      );

      const next: RemoteTrackSubscriptionState = {
        audioSubscribed: audioDecision.shouldSubscribe,
        audioSubscribedSinceMs: audioDecision.subscribedSinceMs,
        audioPendingUnsubscribeAtMs: audioDecision.pendingUnsubscribeAtMs,
        videoSubscribed: videoDecision.shouldSubscribe,
        videoSubscribedSinceMs: videoDecision.subscribedSinceMs,
        videoPendingUnsubscribeAtMs: videoDecision.pendingUnsubscribeAtMs,
      };
      this.states.set(remoteUserId, next);

      const audioFactor = audioDecision.shouldSubscribe
        ? audioDecision.ignoreDistance
          ? 1
          : factors.audioFactor
        : 0;
      const videoFactor = videoDecision.shouldSubscribe
        ? videoDecision.ignoreDistance
          ? 1
          : factors.videoFactor
        : 0;

      snapshots.push({
        remoteUserId,
        distance: factors.distance,
        audioFactor,
        videoFactor,
        zone: factors.zone,
        desiredAudioSubscription: audioDecision.shouldSubscribe,
        desiredVideoSubscription: videoDecision.shouldSubscribe,
        desiredSubscription:
          audioDecision.shouldSubscribe || videoDecision.shouldSubscribe,
        authorizationReason: audioDecision.reason,
        audioAuthorizationReason: audioDecision.reason,
        videoAuthorizationReason: videoDecision.reason,
      });
    }

    for (const userId of [...this.states.keys()]) {
      if (!remotes.has(userId)) this.states.delete(userId);
    }

    return snapshots;
  }

  reset(): void {
    this.states.clear();
  }
}
