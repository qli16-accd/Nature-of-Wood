(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const scenes = new Map();
  const flowStates = new Map();
  const cursorTimers = new WeakMap();
  const pointerPresence = new WeakMap();
  const groupContacts = new WeakMap();
  let broadcaster = null;
  let frameHandle = 0;
  let drag = emptyDrag();
  let hover = emptyHover();

  function emptyDrag() {
    return { active: false, pageIndex: -1, ringIndex: -1, angle: 0, target: 0, current: 0, releaseValue: 0, releaseClock: 0 };
  }

  function emptyHover() {
    return { active: false, pageIndex: -1, ringIndex: -1, angle: 0, target: 0, current: 0, releaseValue: 0, releaseClock: 0 };
  }

  function now() { return performance.timeOrigin + performance.now(); }

  function clock(settings, wallTime) {
    const wall = wallTime === undefined ? now() : wallTime;
    const anchor = settings.motionPausedAt === null ? wall : settings.motionPausedAt;
    return anchor - settings.motionPauseAccumulated;
  }

  function textFlowClock(settings, wallTime) {
    const motionTime = clock(settings, wallTime);
    const anchor = settings.textFlowPausedAt === null ? motionTime : settings.textFlowPausedAt;
    return anchor - settings.textFlowPauseAccumulated;
  }

  function angleDistance(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }
  function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }
  function positiveModulo(value, modulus) { return ((value % modulus) + modulus) % modulus; }

  function minimumGap(scene, item) {
    const items = item ? item.groupItems : scene.items;
    const gaps = items.slice(1).map((entry) => entry.gapBefore).filter(Number.isFinite);
    return gaps.length ? Math.min.apply(null, gaps) : (item ? item.groupSettings : scene.state.settings).ringSpacing;
  }

  function dragLimit(scene, item) {
    const settings = item.groupSettings;
    const outerRadius = Math.max(1, item.groupMaxRadius || 1);
    return Math.min(outerRadius * settings.dragStrength / 100, minimumGap(scene, item) * .32);
  }

  function hoverLimit(scene, item) {
    const settings = item.groupSettings;
    const outerRadius = Math.max(1, item.groupMaxRadius || 1);
    return Math.min(outerRadius * settings.hoverStrength / 100, minimumGap(scene, item) * .12);
  }

  function updateTransient(field, settings, motionClock, releaseScale) {
    if (settings.motionPausedAt !== null) return;
    if (field.active) {
      field.current += (field.target - field.current) * .18;
      field.releaseValue = field.current;
      return;
    }
    if (Math.abs(field.current) <= .005) return;
    const duration = Math.max(600, settings.returnTime * 1000 * releaseScale);
    const elapsed = Math.max(0, motionClock - field.releaseClock);
    field.current = field.releaseValue * Math.exp(-6 * elapsed / duration);
    if (elapsed >= duration || Math.abs(field.current) < .005) field.current = 0;
  }

  function autoOffset(scene, item, angle, motionClock) {
    const settings = item.groupSettings;
    if (!settings.autoMotionEnabled || settings.motionAmplitude <= 0) return 0;
    const outerRadius = Math.max(1, item.groupMaxRadius || 1);
    const amplitude = Math.min(outerRadius * settings.motionAmplitude / 100, minimumGap(scene, item) * .18);
    const phase = motionClock / (settings.motionPeriod * 1000) * Math.PI * 2;
    const shared = Math.sin(angle * 2 + phase) * .58 + Math.sin(angle * 3 - phase * .63 + .8) * .29 + Math.sin(angle + phase * .31) * .13;
    const ringVariation = .96 + (item.globalIndex % 3) * .02;
    const attenuation = drag.active || Math.abs(drag.current) > .05 || hover.active ? .35 : 1;
    return amplitude * shared * ringVariation * attenuation;
  }

  function localizedOffset(scene, item, angle, field, limit, ringSpread) {
    if ((field.groupId ? item.groupId !== field.groupId : scene.pageIndex !== field.pageIndex)
      || Math.abs(field.current) <= .005) return 0;
    const displacement = clamp(field.current, -limit, limit);
    const ringDistance = item.globalIndex - field.ringIndex;
    const ringWeight = Math.exp(-(ringDistance * ringDistance) / (2 * ringSpread * ringSpread));
    const sigma = clamp(item.groupSettings.dragRange / Math.max(48, item.radius), .14, 1.25);
    const angularDistance = angleDistance(angle, field.angle);
    const angularWeight = Math.exp(-(angularDistance * angularDistance) / (2 * sigma * sigma));
    return displacement * ringWeight * angularWeight;
  }

  function contourRadius(group, bearing) {
    const outer = group.outerItem;
    if (!outer) return 0;
    const geometry = outer.flowGeometry;
    if (!geometry || !geometry.points || !geometry.points.length) return outer.radius;
    const index = Math.round(positiveModulo(bearing, Math.PI * 2) / (Math.PI * 2) * geometry.points.length) % geometry.points.length;
    const point = geometry.points[index];
    return Math.hypot(point.x - 600, point.y - 400);
  }

  function updateGroupContacts(scene, motionClock) {
    if (!scene.state.settings.groupInteractionEnabled) {
      scene.groupInteractions = null;
      groupContacts.delete(scene.canvas);
      return;
    }
    const prior = groupContacts.get(scene.canvas) || new Map();
    groupContacts.set(scene.canvas, prior);
    const interactions = [];
    const seen = new Set();
    const groups = scene.groupLayouts || [];
    for (let a = 0; a < groups.length; a += 1) {
      for (let b = a + 1; b < groups.length; b += 1) {
        const first = groups[a];
        const second = groups[b];
        if (!first.outerItem || !second.outerItem) continue;
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const centerDistance = Math.hypot(dx, dy);
        const bearing = Math.atan2(dy, dx);
        const firstRadius = (contourRadius(first, bearing) + first.outerItem.style.fontSize / 2) * first.scale;
        const secondRadius = (contourRadius(second, bearing + Math.PI) + second.outerItem.style.fontSize / 2) * second.scale;
        const gap = centerDistance - firstRadius - secondRadius;
        const reach = scene.state.settings.groupInfluenceDistance;
        const approach = clamp((reach - gap) / Math.max(1, reach), 0, 1);
        const target = scene.state.settings.groupInteractionEnabled ? approach * approach * (3 - 2 * approach) : 0;
        const key = [first.id, second.id].sort().join('|');
        seen.add(key);
        const contact = prior.get(key) || { current: 0, clock: motionClock };
        const elapsed = Math.max(0, motionClock - contact.clock);
        const duration = target > contact.current ? 430 : 1800;
        if (!scene.state.settings.groupInteractionEnabled) contact.current = 0;
        else contact.current += (target - contact.current) * (1 - Math.exp(-elapsed / duration));
        contact.clock = motionClock;
        prior.set(key, contact);
        interactions.push({ first, second, bearing, strength: contact.current, gap });
      }
    }
    prior.forEach((_, key) => { if (!seen.has(key)) prior.delete(key); });
    scene.groupInteractions = interactions;
  }

  function neighboringGroupOffset(scene, item, angle, motionClock) {
    if (!item.groupMaxRadius || !scene.groupInteractions) return 0;
    const edgeWeight = Math.pow(item.radius / item.groupMaxRadius, 3);
    let compression = 0;
    scene.groupInteractions.forEach((pair) => {
      if (pair.first.id !== item.groupId && pair.second.id !== item.groupId) return;
      const bearing = pair.first.id === item.groupId ? pair.bearing : pair.bearing + Math.PI;
      const angular = angleDistance(angle, bearing);
      const local = Math.exp(-angular * angular / (.55 * .55));
      const tide = .95 + .05 * Math.sin(motionClock / 3400 + pair.bearing);
      const requested = scene.state.settings.groupDeformationStrength / Math.max(.1, item.groupScale);
      compression -= Math.min(requested, minimumGap(scene, item) * .34)
        * edgeWeight * pair.strength * local * tide;
    });
    return compression;
  }

  function flowStateFor(item, flowClock) {
    const key = item.ringId || item.story.id;
    let state = flowStates.get(key);
    if (!state) {
      const direction = item.story.flow.direction === 'counterclockwise' ? -1 : 1;
      const distance = direction * flowClock / 1000 * item.story.flow.speed * item.averageCharacterWidth;
      state = {
        phase: positiveModulo(distance / Math.max(1, item.flowLoopLength), 1),
        clock: flowClock
      };
      flowStates.set(key, state);
    }
    return state;
  }

  function positionFlowGlyphs(item, phase) {
    if (!item.flowGlyphs || !item.flowGlyphs.length || !item.flowGeometry) return;
    const horizontalScale = item.style.widthScale / 100;

    item.flowGlyphs.forEach((glyph) => {
      const point = MemoryGeometry.sampleClosedRing(item.flowGeometry, glyph.offset + phase);
      glyph.node.setAttribute('transform', `translate(${point.x.toFixed(3)} ${point.y.toFixed(3)}) rotate(${point.angle.toFixed(3)}) scale(${horizontalScale.toFixed(4)} 1)`);
    });
    item.text.setAttribute('data-flow-phase', phase.toFixed(8));
  }

  function updateFlow(item, settings, wallTime, flowClock) {
    if (!item.flowGlyphs || !item.flowLoopLength) return;
    const state = flowStateFor(item, flowClock);
    const playing = settings.autoTextFlowEnabled
      && item.story.flow && item.story.flow.enabled
      && wallTime >= item.flowReadyAt;

    if (playing) {
      const elapsed = Math.max(0, flowClock - state.clock);
      const direction = item.story.flow.direction === 'counterclockwise' ? -1 : 1;
      const distance = direction * elapsed / 1000 * item.story.flow.speed * item.averageCharacterWidth;
      state.phase = positiveModulo(state.phase + distance / Math.max(1, item.flowLoopLength), 1);
    }
    state.clock = flowClock;
    if (item.lastFlowPhase !== state.phase || item.lastFlowGeometry !== item.flowGeometry) {
      positionFlowGlyphs(item, state.phase);
      item.lastFlowPhase = state.phase;
      item.lastFlowGeometry = item.flowGeometry;
    }
  }

  function updateScene(scene, wallTime, backgroundTick) {
    const settings = scene.state.settings;
    const motionClock = clock(settings, wallTime);
    const pointerMoving = settings.pointerInteractionEnabled && (drag.active || hover.active || Math.abs(drag.current) > .005 || Math.abs(hover.current) > .005);
    const shapeDue = !backgroundTick || pointerMoving || wallTime >= (scene.nextShapeAt || 0);
    if (shapeDue) scene.nextShapeAt = wallTime + 83;
    if (shapeDue && settings.groupInteractionEnabled) updateGroupContacts(scene, motionClock);
    else if (!settings.groupInteractionEnabled) scene.groupInteractions = null;

    scene.items.forEach((item) => {
      const groupSettings = item.groupSettings;
      const flowAnchor = groupSettings.textFlowPausedAt === null ? motionClock : groupSettings.textFlowPausedAt;
      const flowClock = flowAnchor - groupSettings.textFlowPauseAccumulated;
      const pointerEnabled = settings.pointerInteractionEnabled;
      const deforming = (groupSettings.autoMotionEnabled && groupSettings.motionAmplitude > 0)
        || (settings.groupInteractionEnabled && scene.groupInteractions && scene.groupInteractions.some((pair) => pair.strength > .001 && (pair.first.id === item.groupId || pair.second.id === item.groupId)))
        || (pointerEnabled && (((drag.groupId ? drag.groupId === item.groupId : drag.pageIndex === scene.pageIndex) && Math.abs(drag.current) > .005)
          || ((hover.groupId ? hover.groupId === item.groupId : hover.pageIndex === scene.pageIndex) && Math.abs(hover.current) > .005)));
      if (shapeDue && !deforming && item.flowGeometry !== item.baseGeometry) {
        item.flowGeometry = item.baseGeometry;
        item.path.setAttribute('d', item.baseGeometry.d);
        if (item.revealPath) item.revealPath.setAttribute('d', item.baseGeometry.d);
      }
      if (deforming && shapeDue) {
      const combinedLimit = minimumGap(scene, item) * .42;
      const geometry = MemoryGeometry.closedRingGeometry(
        `${item.globalIndex}-${item.ringId || item.story.id}`,
        item.radius,
        Math.max(32, item.story.gapBefore + item.style.fontSize),
        (angle) => clamp(
          autoOffset(scene, item, angle, motionClock)
          + (pointerEnabled ? localizedOffset(scene, item, angle, hover, hoverLimit(scene, item), 1.4) : 0)
          + (pointerEnabled ? localizedOffset(scene, item, angle, drag, dragLimit(scene, item), 1.25) : 0)
          + neighboringGroupOffset(scene, item, angle, motionClock),
          -combinedLimit,
          combinedLimit
        )
      );
      item.flowGeometry = geometry;
      item.path.setAttribute('d', geometry.d);
      if (item.revealPath) item.revealPath.setAttribute('d', geometry.d);
      }

      if (item.flowGlyphs) updateFlow(item, groupSettings, wallTime, flowClock);
    });
  }

  function step(wallTime, visibleOnly) {
    const activeScenes = [];
    scenes.forEach((scene, canvas) => {
      if (!canvas.isConnected) scenes.delete(canvas);
      else if (!visibleOnly || canvas.getClientRects().length) activeScenes.push(scene);
    });
    if (!activeScenes.length) return;
    const reference = activeScenes[0];
    const motionClock = clock(reference.state.settings, wallTime);
    if (reference.state.settings.pointerInteractionEnabled) {
      updateTransient(drag, reference.state.settings, motionClock, 1);
      updateTransient(hover, reference.state.settings, motionClock, .55);
    }
    activeScenes.forEach((scene) => updateScene(scene, wallTime, visibleOnly));
  }

  function tick() {
    frameHandle = window.setTimeout(tick, 33);
    step(now(), true);
  }

  function sceneForTarget(target) {
    const canvas = target && (target.ownerSVGElement || (target.closest && target.closest('svg')) || target);
    return scenes.get(canvas);
  }

  function pointIn(scene, event, node) {
    const matrix = node.getScreenCTM();
    if (!matrix) return null;
    const point = scene.canvas.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(matrix.inverse());
  }

  function compositionPoint(scene, event) { return pointIn(scene, event, scene.composition); }
  function canvasPoint(scene, event) { return pointIn(scene, event, scene.canvas); }

  function nearestRing(scene, point) {
    return scene.items.reduce((best, item) => {
      const local = groupPoint(point, item);
      const dx = local.x - 600;
      const dy = local.y - 400;
      const distance = Math.abs(Math.hypot(dx, dy) - item.radius) * item.groupScale;
      return !best || distance < best.distance ? { item, distance, angle: Math.atan2(dy, dx), point: local } : best;
    }, null);
  }

  function groupPoint(point, item) {
    return {
      x: 600 + (point.x - 600 - item.groupX) / item.groupScale,
      y: 400 + (point.y - 400 - item.groupY) / item.groupScale
    };
  }

  function broadcast(payload) { if (broadcaster) broadcaster(payload); }

  function cursorScale(scene) {
    const matrix = scene.canvas.getScreenCTM();
    if (!matrix) return 1;
    return Math.max(.001, Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)));
  }

  function hideCursor(scene) {
    if (!scene || !scene.cursor) return;
    scene.cursor.classList.remove('is-visible', 'is-pressed');
    const timer = cursorTimers.get(scene.canvas);
    if (timer) clearTimeout(timer);
  }

  function showCursor(scene, event, pressed) {
    if (!scene || scene.state.editor.mode !== 'interact') return;
    if (pointerPresence.get(scene.canvas) === false) return;
    const point = canvasPoint(scene, event);
    if (!point) return;
    scene.cursor.setAttribute('cx', point.x.toFixed(2));
    scene.cursor.setAttribute('cy', point.y.toFixed(2));
    scene.cursor.setAttribute('r', (scene.state.settings.cursorSize / 2 / cursorScale(scene)).toFixed(2));
    scene.cursor.classList.add('is-visible');
    scene.cursor.classList.toggle('is-pressed', Boolean(pressed));
    const previous = cursorTimers.get(scene.canvas);
    if (previous) clearTimeout(previous);
    cursorTimers.set(scene.canvas, setTimeout(() => scene.cursor.classList.remove('is-visible'), 1200));
  }

  function releaseHover(scene, shouldBroadcast) {
    if (!hover.active && Math.abs(hover.current) <= .005) return;
    hover.active = false;
    hover.releaseValue = hover.current;
    hover.releaseClock = clock(scene.state.settings);
    hover.target = 0;
    if (shouldBroadcast !== false) broadcast({ kind: 'hover-end', hover: serializableHover() });
  }

  function updateHover(scene, event) {
    if (!scene.state.settings.pointerInteractionEnabled || scene.state.settings.motionPausedAt !== null || drag.active || event.buttons) return;
    const point = compositionPoint(scene, event);
    const nearest = point && nearestRing(scene, point);
    const range = nearest ? nearest.item.groupSettings.dragRange * nearest.item.groupScale : scene.state.settings.dragRange;
    if (!nearest || nearest.distance >= range) {
      releaseHover(scene, true);
      return;
    }
    hover.active = true;
    hover.pageIndex = scene.pageIndex;
    hover.groupId = nearest.item.groupId;
    hover.ringIndex = nearest.item.globalIndex;
    hover.angle = nearest.angle;
    hover.target = hoverLimit(scene, nearest.item) * (1 - nearest.distance / range);
    hover.releaseValue = hover.current;
    broadcast({ kind: 'hover-move', hover: serializableHover() });
  }

  function pointerDown(event) {
    const scene = sceneForTarget(event.currentTarget);
    if (!scene || !scene.state.settings.pointerInteractionEnabled || scene.state.editor.mode !== 'interact' || scene.state.settings.motionPausedAt !== null) return;
    const point = compositionPoint(scene, event);
    const nearest = point && nearestRing(scene, point);
    if (!nearest || nearest.distance > Math.max(12, nearest.item.style.fontSize * nearest.item.groupScale * 1.5)) return;

    event.preventDefault();
    event.stopPropagation();
    pointerPresence.set(scene.canvas, true);
    releaseHover(scene, true);
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) { /* Synthetic pointer events cannot always capture. */ }
    drag = {
      active: true, pageIndex: scene.pageIndex, groupId: nearest.item.groupId, ringIndex: nearest.item.globalIndex,
      angle: nearest.angle, target: 0, current: 0,
      releaseValue: 0, releaseClock: clock(scene.state.settings),
      startX: nearest.point.x, startY: nearest.point.y, pointerId: event.pointerId,
      sourceCanvas: scene.canvas, surface: event.currentTarget
    };
    showCursor(scene, event, true);
    broadcast({ kind: 'drag-start', drag: serializableDrag() });
  }

  function pointerMove(event) {
    const scene = sceneForTarget(event.currentTarget);
    if (!scene || !scene.state.settings.pointerInteractionEnabled || scene.state.editor.mode !== 'interact') return;
    event.preventDefault();
    showCursor(scene, event, drag.active && drag.pointerId === event.pointerId);
    if (!drag.active || drag.pointerId !== event.pointerId) {
      updateHover(scene, event);
      return;
    }
    const composition = compositionPoint(scene, event);
    const draggedItem = scene.items.find((item) => item.groupId === drag.groupId && item.globalIndex === drag.ringIndex);
    const point = composition && draggedItem ? groupPoint(composition, draggedItem) : null;
    if (!point) return;
    const radialX = Math.cos(drag.angle);
    const radialY = Math.sin(drag.angle);
    const raw = (point.x - drag.startX) * radialX + (point.y - drag.startY) * radialY;
    drag.target = clamp(raw, -dragLimit(scene, draggedItem), dragLimit(scene, draggedItem));
    broadcast({ kind: 'drag-move', drag: serializableDrag() });
  }

  function finishDrag(scene, pointerId, shouldBroadcast) {
    if (!drag.active || (pointerId !== undefined && drag.pointerId !== undefined && drag.pointerId !== pointerId)) return;
    drag.active = false;
    drag.releaseValue = drag.current;
    drag.releaseClock = clock(scene.state.settings);
    drag.target = 0;
    if (drag.surface && drag.pointerId !== undefined) {
      try { drag.surface.releasePointerCapture(drag.pointerId); } catch (_) { /* Capture may already be released. */ }
    }
    if (scene.cursor) scene.cursor.classList.remove('is-pressed');
    if (shouldBroadcast !== false) broadcast({ kind: 'drag-end', drag: serializableDrag() });
  }

  function pointerUp(event) {
    const scene = sceneForTarget(event.currentTarget) || scenes.get(drag.sourceCanvas);
    if (!scene) return;
    event.preventDefault();
    finishDrag(scene, event.pointerId, true);
  }

  function pointerLeave(event) {
    const scene = sceneForTarget(event.currentTarget);
    if (!scene) return;
    pointerPresence.set(scene.canvas, false);
    hideCursor(scene);
    if (!drag.active) releaseHover(scene, true);
  }

  function pointerEnter(event) {
    const scene = sceneForTarget(event.currentTarget);
    if (scene) {
      pointerPresence.set(scene.canvas, true);
      showCursor(scene, event, false);
    }
  }

  function serializableDrag() {
    return {
      active: drag.active, pageIndex: drag.pageIndex, ringIndex: drag.ringIndex,
      groupId: drag.groupId,
      angle: drag.angle, target: drag.target, current: drag.current,
      releaseValue: drag.releaseValue, releaseClock: drag.releaseClock
    };
  }

  function serializableHover() {
    return {
      active: hover.active, pageIndex: hover.pageIndex, ringIndex: hover.ringIndex,
      groupId: hover.groupId,
      angle: hover.angle, target: hover.target, current: hover.current,
      releaseValue: hover.releaseValue, releaseClock: hover.releaseClock
    };
  }

  function createSvgElement(name, attributes) {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  function ensureInteractionLayer(canvas) {
    let surface = canvas.querySelector(':scope > .interaction-surface');
    let cursor = canvas.querySelector(':scope > .interaction-cursor');
    if (!surface) {
      surface = createSvgElement('rect', { class: 'interaction-surface', x: 0, y: 0, width: 1200, height: 800, fill: 'transparent', 'aria-hidden': 'true' });
      canvas.append(surface);
    }
    if (!cursor) {
      cursor = createSvgElement('circle', { class: 'interaction-cursor', cx: -100, cy: -100, r: 12, 'aria-hidden': 'true' });
      canvas.append(cursor);
    }
    if (!surface.dataset.motionBound) {
      surface.dataset.motionBound = 'true';
      surface.addEventListener('pointerenter', pointerEnter);
      surface.addEventListener('pointerdown', pointerDown);
      surface.addEventListener('pointermove', pointerMove);
      surface.addEventListener('pointerup', pointerUp);
      surface.addEventListener('pointercancel', pointerUp);
      surface.addEventListener('pointerleave', pointerLeave);
    }
    if (!canvas.dataset.nativeInteractionBlocked) {
      canvas.dataset.nativeInteractionBlocked = 'true';
      ['selectstart', 'dragstart'].forEach((type) => canvas.addEventListener(type, (event) => {
        if (canvas.classList.contains('is-interact-mode')) event.preventDefault();
      }, true));
    }
    return { surface, cursor };
  }

  function register(canvas, scene) {
    const layer = ensureInteractionLayer(canvas);
    scene.canvas = canvas;
    scene.surface = layer.surface;
    scene.cursor = layer.cursor;
    scenes.set(canvas, scene);
    scene.groupLayouts.forEach((group) => {
      group.outerItem = scene.items.filter((item) => item.groupId === group.id).slice(-1)[0] || null;
    });
    const interacting = scene.state.editor.mode === 'interact' && scene.state.settings.pointerInteractionEnabled;
    canvas.classList.toggle('is-interact-mode', interacting);
    if (!interacting) {
      hideCursor(scene);
      if (drag.active && drag.sourceCanvas === canvas) finishDrag(scene, undefined, true);
      if (hover.active) releaseHover(scene, true);
    }
    updateScene(scene, now());
    if (!frameHandle) frameHandle = window.setTimeout(tick, 0);
  }

  function groupPlacement(canvas, id) {
    const scene = scenes.get(canvas);
    return scene && scene.groupLayouts.find((group) => group.id === id);
  }

  function groupContactSnapshot(canvas) {
    const scene = scenes.get(canvas);
    return scene && scene.groupInteractions
      ? scene.groupInteractions.map((pair) => ({ firstId: pair.first.id, secondId: pair.second.id,
        gap: pair.gap, strength: pair.strength })) : [];
  }

  function updateGroupPlacement(canvas, id, placement) {
    const scene = scenes.get(canvas);
    if (!scene) return;
    const group = groupPlacement(canvas, id);
    if (!group) return;
    group.x = placement.x;
    group.y = placement.y;
    group.scale = placement.scale;
    scene.items.filter((item) => item.groupId === id).forEach((item) => {
      item.groupX = placement.x;
      item.groupY = placement.y;
      item.groupScale = placement.scale;
    });
    if (scene.state.settings.groupInteractionEnabled) updateScene(scene, now());
  }

  function receive(payload) {
    if (!payload || !payload.kind) return;
    if (payload.kind === 'reset') {
      drag = emptyDrag();
      hover = emptyHover();
      scenes.forEach((_, canvas) => groupContacts.delete(canvas));
      return;
    }
    if (payload.kind === 'snapshot') {
      if (payload.drag) drag = Object.assign(emptyDrag(), payload.drag);
      if (payload.hover) hover = Object.assign(emptyHover(), payload.hover);
      let flowChanged = false;
      if (payload.flowStates) {
        Object.entries(payload.flowStates).forEach(([id, state]) => {
          if (state && Number.isFinite(state.phase) && Number.isFinite(state.clock)) {
            flowStates.set(id, { phase: positiveModulo(state.phase, 1), clock: state.clock });
            flowChanged = true;
          }
        });
      }
      if (flowChanged) step(now(), true);
      return;
    }
    if (payload.kind.indexOf('drag-') === 0 && payload.drag) {
      const localCurrent = drag.current;
      drag = Object.assign(emptyDrag(), payload.drag);
      if (payload.kind === 'drag-move') drag.current = localCurrent;
      return;
    }
    if (payload.kind.indexOf('hover-') === 0 && payload.hover) {
      const localCurrent = hover.current;
      hover = Object.assign(emptyHover(), payload.hover);
      if (payload.kind === 'hover-move') hover.current = localCurrent;
    }
  }

  function reset(shouldBroadcast) {
    drag = emptyDrag();
    hover = emptyHover();
    scenes.forEach((_, canvas) => groupContacts.delete(canvas));
    if (shouldBroadcast !== false) broadcast({ kind: 'reset' });
  }

  function serializableFlowStates() {
    const result = {};
    flowStates.forEach((state, id) => { result[id] = { phase: state.phase, clock: state.clock }; });
    return result;
  }

  function snapshot() {
    return { kind: 'snapshot', drag: serializableDrag(), hover: serializableHover(), flowStates: serializableFlowStates() };
  }

  function handleWindowRelease(event) {
    const scene = scenes.get(drag.sourceCanvas);
    if (scene) finishDrag(scene, event && event.pointerId, true);
  }

  function handleWindowBlur() {
    handleWindowRelease();
    scenes.forEach((scene) => {
      pointerPresence.set(scene.canvas, false);
      hideCursor(scene);
      if (hover.active) releaseHover(scene, true);
    });
  }

  window.addEventListener('pointerup', handleWindowRelease, true);
  window.addEventListener('pointercancel', handleWindowRelease, true);
  window.addEventListener('blur', handleWindowBlur);

  function setBroadcaster(callback) { broadcaster = callback; }

  window.MemoryMotion = { register, receive, reset, snapshot, setBroadcaster, clock, textFlowClock, now, step,
    groupPlacement, updateGroupPlacement, groupContactSnapshot };
}());
