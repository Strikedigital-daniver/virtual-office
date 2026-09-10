export const CAMERA_ZOOM_MIN = 0.25;
export const CAMERA_ZOOM_MAX = 2.4;
export const CAMERA_ZOOM_STEP = 0.12;
export const WALK_ARRIVE_DISTANCE_PX = 8;

export function minZoomToFitMap(
  viewWidth: number,
  viewHeight: number,
  mapWidth: number,
  mapHeight: number,
): number {
  if (viewWidth <= 0 || viewHeight <= 0 || mapWidth <= 0 || mapHeight <= 0) {
    return CAMERA_ZOOM_MIN;
  }
  return Math.min(viewWidth / mapWidth, viewHeight / mapHeight);
}

export function nextCameraZoom(
  current: number,
  deltaY: number,
  minZoom = CAMERA_ZOOM_MIN,
): number {
  const direction = deltaY > 0 ? -1 : deltaY < 0 ? 1 : 0;
  const floor = Math.max(CAMERA_ZOOM_MIN, Math.min(minZoom, CAMERA_ZOOM_MAX));
  const next = current + direction * CAMERA_ZOOM_STEP;
  return Math.min(CAMERA_ZOOM_MAX, Math.max(floor, Number(next.toFixed(2))));
}

export function cameraFitsWholeMap(
  viewWidth: number,
  viewHeight: number,
  zoom: number,
  mapWidth: number,
  mapHeight: number,
): boolean {
  if (zoom <= 0) return false;
  return viewWidth / zoom >= mapWidth && viewHeight / zoom >= mapHeight;
}

export function clampWalkTarget(
  x: number,
  y: number,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } {
  return {
    x: Math.min(mapWidth - 1, Math.max(1, x)),
    y: Math.min(mapHeight - 1, Math.max(1, y)),
  };
}

export function walkVelocityToward(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  speed: number,
  arriveDistance: number,
): { vx: number; vy: number; arrived: boolean } {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy);
  if (distance <= arriveDistance) {
    return { vx: 0, vy: 0, arrived: true };
  }
  return {
    vx: (dx / distance) * speed,
    vy: (dy / distance) * speed,
    arrived: false,
  };
}
