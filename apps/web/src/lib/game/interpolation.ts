export interface TimedPosition {
  t: number;
  x: number;
  y: number;
}

const MAX_BUFFER_MS = 2_000;

export function pushSample(
  buffer: TimedPosition[],
  sample: TimedPosition,
): void {
  const last = buffer[buffer.length - 1];
  if (last && sample.t < last.t) return;
  buffer.push(sample);
  const cutoff = sample.t - MAX_BUFFER_MS;
  while (buffer.length > 2 && (buffer[0]?.t ?? Infinity) < cutoff) {
    buffer.shift();
  }
}

export function sampleAt(
  buffer: TimedPosition[],
  renderTime: number,
): { x: number; y: number } | null {
  if (buffer.length === 0) return null;
  const first = buffer[0]!;
  if (renderTime <= first.t) return { x: first.x, y: first.y };

  for (let index = 0; index < buffer.length - 1; index += 1) {
    const from = buffer[index]!;
    const to = buffer[index + 1]!;
    if (renderTime >= from.t && renderTime <= to.t) {
      const span = to.t - from.t;
      const ratio = span <= 0 ? 1 : (renderTime - from.t) / span;
      return {
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio,
      };
    }
  }

  const last = buffer[buffer.length - 1]!;
  return { x: last.x, y: last.y };
}
