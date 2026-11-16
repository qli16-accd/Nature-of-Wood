(function () {
  'use strict';

  function hash(value) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function point(seed, radius, index, count, amplitude, deformation) {
    const t = (index / count) * Math.PI * 2;
    const phaseA = (seed % 628) / 100;
    const phaseB = ((seed >>> 7) % 628) / 100;
    const wobble = Math.sin(t * 3 + phaseA) * .56 + Math.sin(t * 5 + phaseB) * .29 + Math.sin(t * 7 - phaseA) * .15;
    const r = radius + amplitude * wobble + (deformation ? deformation(t, index, count) : 0);
    return { x: 600 + Math.cos(t) * r, y: 400 + Math.sin(t) * r };
  }

  function closedRingGeometry(key, radius, spacing, deformation) {
    const count = 96;
    const amplitude = Math.min(5.5, spacing * .1);
    const seed = hash(String(key));
    const points = Array.from({ length: count }, (_, i) => point(seed, radius, i, count, amplitude, deformation));
    const first = points[0];
    let d = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
    const segments = [];
    let length = 0;
    for (let i = 0; i < count; i += 1) {
      const current = points[i];
      const next = points[(i + 1) % count];
      const after = points[(i + 2) % count];
      const c1x = current.x + (next.x - points[(i - 1 + count) % count].x) / 6;
      const c1y = current.y + (next.y - points[(i - 1 + count) % count].y) / 6;
      const c2x = next.x - (after.x - current.x) / 6;
      const c2y = next.y - (after.y - current.y) / 6;
      d += ` C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
      const segmentLength = Math.hypot(next.x - current.x, next.y - current.y);
      length += segmentLength;
      segments.push({
        p0: current, p1: { x: c1x, y: c1y }, p2: { x: c2x, y: c2y }, p3: next,
        start: length - segmentLength, length: segmentLength
      });
    }
    return { d: d + ' Z', segments, length, points };
  }

  function closedRingPath(key, radius, spacing, deformation) {
    return closedRingGeometry(key, radius, spacing, deformation).d;
  }

  function sampleClosedRing(geometry, normalizedOffset) {
    const normalized = ((normalizedOffset % 1) + 1) % 1;
    const target = normalized * geometry.length;
    let low = 0;
    let high = geometry.segments.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const segment = geometry.segments[middle];
      if (target >= segment.start + segment.length) low = middle + 1;
      else high = middle;
    }
    const segment = geometry.segments[low];
    const t = segment.length > 0 ? (target - segment.start) / segment.length : 0;
    const inverse = 1 - t;
    const x = inverse * inverse * inverse * segment.p0.x
      + 3 * inverse * inverse * t * segment.p1.x
      + 3 * inverse * t * t * segment.p2.x
      + t * t * t * segment.p3.x;
    const y = inverse * inverse * inverse * segment.p0.y
      + 3 * inverse * inverse * t * segment.p1.y
      + 3 * inverse * t * t * segment.p2.y
      + t * t * t * segment.p3.y;
    const dx = 3 * inverse * inverse * (segment.p1.x - segment.p0.x)
      + 6 * inverse * t * (segment.p2.x - segment.p1.x)
      + 3 * t * t * (segment.p3.x - segment.p2.x);
    const dy = 3 * inverse * inverse * (segment.p1.y - segment.p0.y)
      + 6 * inverse * t * (segment.p2.y - segment.p1.y)
      + 3 * t * t * (segment.p3.y - segment.p2.y);
    return { x, y, angle: Math.atan2(dy, dx) * 180 / Math.PI };
  }

  function ringRadius(index, spacing) { return 48 + (index + 1) * spacing; }
  function circumference(radius) { return Math.PI * 2 * radius; }

  window.MemoryGeometry = { hash, closedRingGeometry, closedRingPath, sampleClosedRing, ringRadius, circumference };
}());
