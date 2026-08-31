/**
 * Serializes WebRTC negotiations.
 *
 * The Sprint 0 spike recorded intermittent failures with three or more
 * participants: publish and subscribe operations renegotiated concurrently on
 * the same RTCPeerConnection. Every operation now runs to completion before the
 * next one starts, and a failed operation never blocks the queue.
 */
export class OperationQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async drain(): Promise<void> {
    await this.tail;
  }
}
