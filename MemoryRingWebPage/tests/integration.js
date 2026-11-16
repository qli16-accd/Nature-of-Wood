(async function () {
  'use strict';

  const results = [];
  const backup = localStorage.getItem(MemoryState.STORAGE_KEY);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitFor(predicate, timeout) {
    const started = performance.now();
    while (performance.now() - started < timeout) {
      if (predicate()) return true;
      await sleep(50);
    }
    return false;
  }

  function check(name, condition, detail) {
    results.push({ name, pass: Boolean(condition), detail: detail || '' });
  }

  function change(node, value) {
    if (node.type === 'checkbox') node.checked = Boolean(value);
    else node.value = value;
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function addFrame(src) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.onload = () => resolve(frame);
      frame.onerror = reject;
      frame.src = src;
      document.body.append(frame);
    });
  }

  function submit(control, text) {
    const input = control.querySelector('#memoryInput');
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    control.querySelector('#memoryForm').requestSubmit();
  }

  try {
    localStorage.removeItem(MemoryState.STORAGE_KEY);
    const [controlFrame, projectionFrame] = await Promise.all([
      addFrame('../index.html?test=control-v4'), addFrame('../index.html?view=projection&test=projection-v4')
    ]);
    let control = controlFrame.contentDocument;
    const projection = projectionFrame.contentDocument;
    await sleep(180);

    check('Default interface and ring style are serif', MemoryState.load().settings.fontStyle === 'serif' && getComputedStyle(control.body).fontFamily.toLowerCase().includes('serif'));
    check('English-first Japanese-assisted copy is present', control.querySelector('h1').textContent.includes('tree') && control.querySelector('.prompt-jp').textContent.includes('木'));
    check('Projection hides the complete control interface', projection.body.classList.contains('projection-mode') && getComputedStyle(projection.querySelector('#controlView')).display === 'none');
    check('Projection has no center marker or empty-state ring', projection.querySelectorAll('.center-mark,circle:not(.interaction-cursor)').length === 0 && projection.querySelectorAll('.ring-text').length === 0 && getComputedStyle(projection.querySelector('.interaction-cursor')).opacity === '0');

    const input = control.querySelector('#memoryInput');
    input.value = '入力中';
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '中' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', ctrlKey: true, isComposing: true }));
    await sleep(60);
    check('IME composition does not submit accidentally', MemoryState.load().stories.length === 0);
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中' }));

    submit(control, 'Tree');
    await sleep(180);
    let saved = MemoryState.load();
    let projectedText = projection.querySelector('.ring-text');
    const pathLength = Number(projectedText.dataset.pathLength);
    const renderedLength = Number(projectedText.dataset.renderedLength);
    check('Short memory repeats around the full measured path', Number(projectedText.dataset.repetitions) > 2 && projectedText.textContent.includes('Tree · Tree'));
    check('Closed seam keeps a small natural gap', renderedLength < pathLength && renderedLength > pathLength * .82, `${renderedLength}/${pathLength}`);
    check('Repeated display never changes stored original text', saved.stories[0].text === 'Tree');
    check('Subtle automatic motion uses conservative defaults', saved.settings.autoMotionEnabled && saved.settings.motionAmplitude === 0.5 && saved.settings.motionPeriod === 16);
    check('Expanded interaction defaults are available', saved.settings.dragStrength === 5 && saved.settings.returnTime === 8 && saved.settings.hoverStrength === 1 && saved.settings.cursorSize === 24);
    check('Expensive group and pointer interactions default off', !saved.settings.groupInteractionEnabled && !saved.settings.pointerInteractionEnabled);
    const movingPath = projection.querySelector('.ring-guide');
    const stableTextNode = projectedText.querySelector('textPath');
    const initialMotionPath = movingPath.getAttribute('d');
    projection.defaultView.MemoryMotion.step(projection.defaultView.MemoryMotion.now() + 1000);
    const currentMovingPath = projection.querySelector('.ring-guide');
    const currentProjectedText = projection.querySelector('.ring-text');
    check('Automatic motion updates the contour without rebuilding text', currentMovingPath.getAttribute('d') !== initialMotionPath && currentProjectedText.querySelector('textPath') === stableTextNode,
      `${currentMovingPath === movingPath}/${currentProjectedText.querySelector('textPath') === stableTextNode}/${currentMovingPath.getAttribute('d') === initialMotionPath}`);
    change(control.querySelector('[data-global-setting="autoMotionEnabled"]'), false);
    await sleep(170);
    const quietPath = projection.querySelector('.ring-guide');
    const quietObserver = new MutationObserver(() => {});
    quietObserver.observe(quietPath, { attributes: true, attributeFilter: ['d'] });
    projection.defaultView.MemoryMotion.step(projection.defaultView.MemoryMotion.now() + 1500);
    check('One static group skips per-frame contour writes', quietObserver.takeRecords().length === 0);
    quietObserver.disconnect();
    change(control.querySelector('[data-global-setting="autoMotionEnabled"]'), true);

    ['木', '木漏れ日の午後。', '⟦EN⟧ Tree · ⟦中文⟧ 树 · ⟦日本語⟧ 木'].forEach((text) => submit(control, text));
    await sleep(250);
    saved = MemoryState.load();
    check('Chinese, Japanese, English and mixed text persist unchanged', saved.stories.map((story) => story.text).join('|') === 'Tree|木|木漏れ日の午後。|⟦EN⟧ Tree · ⟦中文⟧ 树 · ⟦日本語⟧ 木');
    check('Dual-window synchronization updates projection without refresh', projection.querySelectorAll('.ring-text').length === 4);
    check('Projection has no editing marks by default', projection.querySelectorAll('.ring-text.is-selected,.ring-guide.is-visible,.ring-number').length === 0);

    change(control.querySelector('[data-global-setting="autoMotionEnabled"]'), false);
    change(control.querySelector('[data-global-setting="pointerInteractionEnabled"]'), true);
    control.querySelector('#interactMode').click();
    await sleep(500);
    projection.defaultView.MemoryMotion.step(projection.defaultView.MemoryMotion.now());
    const interactionSurface = projection.querySelector('.interaction-surface');
    const interactionCursor = projection.querySelector('.interaction-cursor');
    const selectEvent = new Event('selectstart', { bubbles: true, cancelable: true });
    projection.querySelector('.ring-text').dispatchEvent(selectEvent);
    const dragEvent = new Event('dragstart', { bubbles: true, cancelable: true });
    projection.querySelector('.ring-text').dispatchEvent(dragEvent);
    check('Native selection and drag are blocked only inside an active ring surface', selectEvent.defaultPrevented && dragEvent.defaultPrevented && getComputedStyle(projection.querySelector('#ringsCanvas')).userSelect === 'none' && getComputedStyle(control.querySelector('#memoryInput')).userSelect !== 'none');
    check('A dedicated pointer surface sits above non-interactive ring text', getComputedStyle(interactionSurface).pointerEvents === 'all' && getComputedStyle(projection.querySelector('.ring-text')).pointerEvents === 'none');
    check('Unselected per-ring flow editor shows guidance instead of disabled controls', !control.querySelector('#flowEmpty').hidden && control.querySelector('#flowControls').hidden);

    const hoverClock = projection.defaultView.MemoryMotion.now();
    projection.defaultView.MemoryMotion.step(hoverClock + 600);
    let baseDragPaths = Array.from(projection.querySelectorAll('.ring-guide')).map((path) => path.getAttribute('d'));
    const firstRingPath = projection.querySelector('.ring-guide');
    const hoverPoint = firstRingPath.getPointAtLength(0).matrixTransform(firstRingPath.getScreenCTM());
    interactionSurface.dispatchEvent(new projection.defaultView.PointerEvent('pointermove', {
      bubbles: true, cancelable: true, pointerId: 41, clientX: hoverPoint.x, clientY: hoverPoint.y, buttons: 0
    }));
    for (let frame = 0; frame < 10; frame += 1) projection.defaultView.MemoryMotion.step(hoverClock + 600);
    const hoverPaths = Array.from(projection.querySelectorAll('.ring-guide')).map((path) => path.getAttribute('d'));
    const hoverPath = hoverPaths[0];
    const hoverShift = Math.abs(Number(hoverPath.split(/\s+/)[1]) - Number(baseDragPaths[0].split(/\s+/)[1]));
    const hoverNeighborShift = Math.abs(Number(hoverPaths[1].split(/\s+/)[1]) - Number(baseDragPaths[1].split(/\s+/)[1]));
    const cursorMatrix = projection.querySelector('#ringsCanvas').getScreenCTM();
    const cursorScale = Math.sqrt(Math.abs(cursorMatrix.a * cursorMatrix.d - cursorMatrix.b * cursorMatrix.c));
    check('Unpressed hover creates a bounded local ripple', hoverShift > 0.05 && hoverShift < saved.settings.ringSpacing * .12 + .05, `${hoverShift}`);
    check('Hover ripple softly reaches neighboring rings without independent jitter', hoverNeighborShift > 0 && hoverNeighborShift < hoverShift, `${hoverShift}/${hoverNeighborShift}`);
    check('Interact mode shows one non-blocking 24px circle and hides the system cursor locally', interactionCursor.classList.contains('is-visible') && getComputedStyle(interactionCursor).pointerEvents === 'none' && Math.abs(Number(interactionCursor.getAttribute('r')) * cursorScale * 2 - 24) < 1 && getComputedStyle(interactionSurface).cursor === 'none');
    check('Remote preview does not duplicate the active interaction cursor', control.querySelectorAll('.interaction-cursor.is-visible').length === 0);
    interactionSurface.dispatchEvent(new projection.defaultView.PointerEvent('pointerleave', { bubbles: true, pointerId: 41 }));
    projection.defaultView.MemoryMotion.step(hoverClock + saved.settings.returnTime * 1000 * .55 + 1);
    check('Hover fades after leaving and the cursor hides', !interactionCursor.classList.contains('is-visible') && projection.querySelector('.ring-guide').getAttribute('d') === baseDragPaths[0]);
    interactionSurface.dispatchEvent(new projection.defaultView.PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, pointerId: 52, clientX: hoverPoint.x, clientY: hoverPoint.y, buttons: 1
    }));
    const capturedDragStarted = projection.defaultView.MemoryMotion.snapshot().drag.active;
    projection.defaultView.dispatchEvent(new projection.defaultView.PointerEvent('pointercancel', { pointerId: 52 }));
    check('Pointer cancellation releases the active drag without getting stuck', capturedDragStarted && !projection.defaultView.MemoryMotion.snapshot().drag.active && !interactionCursor.classList.contains('is-pressed'));
    projection.defaultView.MemoryMotion.reset(true);
    projection.defaultView.MemoryMotion.step(projection.defaultView.MemoryMotion.now());
    await sleep(180);
    projection.defaultView.MemoryMotion.step(projection.defaultView.MemoryMotion.now());
    baseDragPaths = Array.from(projection.querySelectorAll('.ring-guide')).map((path) => path.getAttribute('d'));

    const dragClock = projection.defaultView.MemoryMotion.now();
    projection.defaultView.MemoryMotion.receive({
      kind: 'drag-start',
      drag: { active: true, pageIndex: 0, ringIndex: 0, angle: 0, target: 8, current: 8, releaseValue: 8, releaseClock: dragClock }
    });
    projection.defaultView.MemoryMotion.step(dragClock + 100);
    const draggedPaths = Array.from(projection.querySelectorAll('.ring-guide')).map((path) => path.getAttribute('d'));
    const radialShift = (before, after) => Math.abs(Number(after.split(/\s+/)[1]) - Number(before.split(/\s+/)[1]));
    const innerShift = radialShift(baseDragPaths[0], draggedPaths[0]);
    const neighborShift = radialShift(baseDragPaths[1], draggedPaths[1]);
    check('Interact mode reaches projection without displaying controls', projection.querySelector('#ringsCanvas').classList.contains('is-interact-mode') && getComputedStyle(projection.querySelector('#controlView')).display === 'none');
    check('Local drag deforms the target and softly transmits to a neighboring ring', innerShift > neighborShift && neighborShift > 0.2, `${innerShift}/${neighborShift}`);
    check('Drag deformation remains below the clear-gap safety limit', innerShift <= MemoryState.load().settings.ringSpacing * .32 + .7, `${innerShift}`);
    check('Hover remains weaker than pressed dragging', hoverShift < innerShift, `${hoverShift}/${innerShift}`);
    projection.defaultView.MemoryMotion.receive({
      kind: 'drag-end',
      drag: { active: false, pageIndex: 0, ringIndex: 0, angle: 0, target: 0, current: 8, releaseValue: 8, releaseClock: dragClock }
    });
    projection.defaultView.MemoryMotion.step(dragClock + MemoryState.load().settings.returnTime * 1000 + 1);
    check('Released deformation returns to the unchanged base contour', projection.querySelector('.ring-guide').getAttribute('d') === baseDragPaths[0]);
    check('Temporary drag frames are not written to persistent data', !JSON.stringify(MemoryState.load()).includes('releaseValue'));
    change(control.querySelector('[data-global-setting="autoMotionEnabled"]'), true);
    await sleep(140);

    const originalSizes = saved.stories.map((story) => story.style.fontSize);
    control.querySelectorAll('.ring-row')[0].click();
    await sleep(80);
    change(control.querySelector('[data-style-setting="fontSize"]'), 31);
    change(control.querySelector('[data-style-setting="fontWeight"]'), 600);
    change(control.querySelector('[data-style-setting="letterSpacing"]'), 2.5);
    change(control.querySelector('[data-style-setting="widthScale"]'), 112);
    await sleep(180);
    saved = MemoryState.load();
    check('Editing one ring changes only that ring', saved.stories[0].style.fontSize === 31 && saved.stories[0].style.fontWeight === 600 && saved.stories.slice(1).every((story, index) => story.style.fontSize === originalSizes[index + 1]));
    check('Selected ring is highlighted only in admin preview', control.querySelectorAll('#adminCanvas .ring-text.is-selected').length === 1 && projection.querySelectorAll('.ring-text.is-selected').length === 0);
    check('Selecting a ring reveals its text-flow controls', control.querySelector('#flowEmpty').hidden && !control.querySelector('#flowControls').hidden);

    change(control.querySelector('[data-global-setting="autoTextFlowEnabled"]'), true);
    change(control.querySelector('[data-flow-setting="mode"]'), 'clockwise');
    change(control.querySelector('[data-flow-setting="speed"]'), 1);
    await sleep(180);
    const flowingText = projection.querySelector('.ring-text[data-story-id="' + saved.stories[0].id + '"]');
    const stableFlowGlyphs = Array.from(flowingText.querySelectorAll('.flow-glyph'));
    const flowOffsetBefore = flowingText.dataset.flowPhase;
    projection.defaultView.MemoryMotion.step(projection.defaultView.MemoryMotion.now() + 1000);
    const currentFlowingText = projection.querySelector('.ring-text[data-story-id="' + saved.stories[0].id + '"]');
    const flowOffsetAfter = currentFlowingText.dataset.flowPhase;
    saved = MemoryState.load();
    check('Per-ring text flow persists and advances smoothly', saved.stories[0].flow.enabled && saved.stories[0].flow.speed === 1 && flowOffsetBefore !== flowOffsetAfter,
      `${saved.stories[0].flow.enabled}/${saved.stories[0].flow.speed}/${flowOffsetBefore}/${flowOffsetAfter}`);
    check('Flowing glyphs cross the closed seam without textPath endpoint clipping', !flowingText.querySelector('textPath') && stableFlowGlyphs.length > 3 && stableFlowGlyphs.every((node, index) => currentFlowingText.querySelectorAll('.flow-glyph')[index] === node && node.hasAttribute('transform')));
    check('The seamless loop uses one fixed, measured glyph layout', Number(flowingText.dataset.renderedLength) === Number(flowingText.dataset.pathLength) && Number(flowingText.dataset.advanceScale) > .75 && Number(flowingText.dataset.advanceScale) < 1.25);
    const phaseBeforeStyleChange = Number(currentFlowingText.dataset.flowPhase);
    change(control.querySelector('[data-style-setting="widthScale"]'), 114);
    await sleep(160);
    const phaseAfterStyleChange = Number(projection.querySelector('.flow-ring-text[data-story-id="' + saved.stories[0].id + '"]').dataset.flowPhase);
    const stylePhaseDistance = Math.abs(((phaseAfterStyleChange - phaseBeforeStyleChange + .5) % 1 + 1) % 1 - .5);
    check('Font layout changes preserve the current loop phase', stylePhaseDistance < .08 && phaseAfterStyleChange !== 0, `${phaseBeforeStyleChange}/${phaseAfterStyleChange}/${stylePhaseDistance}`);
    change(control.querySelector('[data-style-setting="widthScale"]'), 112);
    await sleep(140);

    check('Single-ring flow editing does not change other rings', saved.stories.slice(1).every((story) => !story.flow.enabled));

    const contourBeforeFlowOff = projection.querySelector('.ring-guide').getAttribute('d');
    change(control.querySelector('[data-global-setting="autoTextFlowEnabled"]'), false);
    await sleep(120);
    const stoppedFlow = projection.querySelector('.ring-text[data-story-id="' + saved.stories[0].id + '"]').dataset.flowPhase;
    projection.defaultView.MemoryMotion.step(projection.defaultView.MemoryMotion.now() + 1000);
    const stoppedFlowAfterStep = projection.querySelector('.ring-text[data-story-id="' + saved.stories[0].id + '"]').dataset.flowPhase;
    const contourAfterFlowOffStep = projection.querySelector('.ring-guide').getAttribute('d');
    check('Automatic text flow can stop while undulation continues', stoppedFlowAfterStep === stoppedFlow && contourAfterFlowOffStep !== contourBeforeFlowOff,
      `${stoppedFlow}/${stoppedFlowAfterStep}/${contourAfterFlowOffStep === contourBeforeFlowOff}`);
    change(control.querySelector('[data-global-setting="autoTextFlowEnabled"]'), true);
    change(control.querySelector('[data-global-setting="autoMotionEnabled"]'), false);
    await sleep(120);
    const stillContour = projection.querySelector('.ring-guide').getAttribute('d');
    const movingFlowBefore = projection.querySelector('.ring-text[data-story-id="' + saved.stories[0].id + '"]').dataset.flowPhase;
    projection.defaultView.MemoryMotion.step(projection.defaultView.MemoryMotion.now() + 1000);
    check('Undulation can stop while automatic text flow continues', projection.querySelector('.ring-guide').getAttribute('d') === stillContour && projection.querySelector('.ring-text[data-story-id="' + saved.stories[0].id + '"]').dataset.flowPhase !== movingFlowBefore);
    change(control.querySelector('[data-global-setting="autoMotionEnabled"]'), true);

    const deformingFlow = projection.querySelector('.flow-ring-text[data-story-id="' + saved.stories[0].id + '"]');
    const deformingGlyphs = Array.from(deformingFlow.querySelectorAll('.flow-glyph'));
    const contourBeforeFlowDrag = projection.querySelector('.ring-guide').getAttribute('d');
    const flowDragClock = projection.defaultView.MemoryMotion.now();
    projection.defaultView.MemoryMotion.receive({ kind: 'drag-move', drag: { active: true, pageIndex: 0, ringIndex: 0, angle: 0, target: 4, current: 4, releaseValue: 4, releaseClock: flowDragClock } });
    projection.defaultView.MemoryMotion.step(flowDragClock + 300);
    check('Drag deformation moves the path without rebuilding or resetting flowing glyphs', projection.querySelector('.ring-guide').getAttribute('d') !== contourBeforeFlowDrag && deformingGlyphs.every((node, index) => projection.querySelectorAll('.flow-ring-text[data-story-id="' + saved.stories[0].id + '"] .flow-glyph')[index] === node));
    projection.defaultView.MemoryMotion.receive({ kind: 'drag-end', drag: { active: false, pageIndex: 0, ringIndex: 0, angle: 0, target: 0, current: 4, releaseValue: 4, releaseClock: flowDragClock + 300 } });
    projection.defaultView.MemoryMotion.step(flowDragClock + 300 + MemoryState.load().settings.returnTime * 1000 + 1);

    change(control.querySelector('[data-global-setting="globalFlowDirection"]'), 'counterclockwise');
    change(control.querySelector('[data-global-setting="globalFlowSpeed"]'), 0.7);
    control.querySelector('#applyFlowAll').click();
    control.querySelector('#saveFlowDefault').click();
    await sleep(150);
    saved = MemoryState.load();
    check('Global text-flow controls apply direction and speed to every ring', saved.stories.every((story) => story.flow.enabled && story.flow.direction === 'counterclockwise' && story.flow.speed === 0.7));
    check('Global flow can be saved as the new-ring default', saved.settings.newRingFlowEnabled && saved.settings.newRingFlowDirection === 'counterclockwise' && saved.settings.newRingFlowSpeed === 0.7);
    const markerId = saved.stories[3].id;
    const markerProjection = projection.querySelector('.flow-ring-text[data-story-id="' + markerId + '"]');
    const markerAdmin = control.querySelector('#adminCanvas .flow-ring-text[data-story-id="' + markerId + '"]');
    const markerGlyphs = Array.from(markerProjection.querySelectorAll('.flow-glyph'));
    const markerLoopMs = Number(markerProjection.dataset.pathLength) / (0.7 * Number(markerProjection.dataset.averageCharacterWidth)) * 1000;
    const markerStart = projection.defaultView.MemoryMotion.now();
    for (let index = 1; index <= 48; index += 1) {
      const frameTime = markerStart + markerLoopMs * 4 * index / 48;
      projection.defaultView.MemoryMotion.step(frameTime);
      control.defaultView.MemoryMotion.step(frameTime);
    }
    const markerCurrent = projection.querySelector('.flow-ring-text[data-story-id="' + markerId + '"]');
    const markerProjectionPhase = Number(markerCurrent.dataset.flowPhase);
    const markerAdminPhase = Number(markerAdmin.dataset.flowPhase);
    const markerPhaseDistance = Math.abs(((markerProjectionPhase - markerAdminPhase + .5) % 1 + 1) % 1 - .5);
    check('Marked Chinese, Japanese and English glyphs remain mounted through four seam crossings', markerGlyphs.length > 10 && markerGlyphs.every((node, index) => markerCurrent.querySelectorAll('.flow-glyph')[index] === node && !node.getAttribute('transform').includes('NaN')));
    check('Counterclockwise flow stays synchronized in projection and admin preview during deformation', markerPhaseDistance < .02 && projection.querySelector('.ring-guide').getAttribute('d') !== stillContour, `${markerProjectionPhase}/${markerAdminPhase}/${markerPhaseDistance}`);

    control.querySelector('#pauseMotion').click();
    await sleep(120);
    const pausedPath = projection.querySelector('.ring-guide').getAttribute('d');
    const pausedFlowingText = projection.querySelector('.ring-text[data-story-id="' + saved.stories[0].id + '"]');
    const pausedOffset = pausedFlowingText.dataset.flowPhase;
    await sleep(260);
    check('Pause freezes contours and text flow at the current frame', projection.querySelector('.ring-guide').getAttribute('d') === pausedPath && projection.querySelector('.ring-text[data-story-id="' + saved.stories[0].id + '"]').dataset.flowPhase === pausedOffset);
    control.querySelector('#pauseMotion').click();
    await sleep(140);
    check('Resume continues motion without clearing content', projection.querySelector('.ring-guide').getAttribute('d') !== pausedPath && MemoryState.load().stories.length === 4);

    control.querySelector('#editDefaults').click();
    change(control.querySelector('[data-style-setting="fontSize"]'), 24);
    change(control.querySelector('[data-style-setting="widthScale"]'), 108);
    await sleep(150);
    saved = MemoryState.load();
    check('Changing defaults does not overwrite existing rings', saved.settings.fontSize === 24 && saved.settings.widthScale === 108 && saved.stories[0].style.fontSize === 31 && saved.stories[1].style.fontSize === 22);
    submit(control, 'New default style');
    await sleep(150);
    saved = MemoryState.load();
    check('New rings inherit current style and text-flow defaults', saved.stories.at(-1).style.fontSize === 24 && saved.stories.at(-1).style.widthScale === 108 && saved.stories.at(-1).flow.enabled && saved.stories.at(-1).flow.direction === 'counterclockwise' && saved.stories.at(-1).flow.speed === 0.7);

    control.querySelector('#editDefaults').click();
    control.querySelector('#applyAllStyles').click();
    await sleep(150);
    saved = MemoryState.load();
    check('Apply-to-all explicitly copies defaults to every ring', saved.stories.every((story) => story.style.fontSize === 24 && story.style.widthScale === 108));

    const firstGapButton = Array.from(control.querySelectorAll('.gap-row')).find((button) => !button.disabled);
    const innerId = firstGapButton.dataset.innerId;
    const outerId = firstGapButton.dataset.outerId;
    let beforePages = MemoryRings.layoutPages(saved.stories, saved.settings);
    let beforePage = beforePages.find((page) => page.items.some((item) => item.story.id === innerId));
    const beforeInner = beforePage.items.find((item) => item.story.id === innerId).radius;
    const beforeOuter = beforePage.items.find((item) => item.story.id === outerId).radius;
    firstGapButton.click();
    await sleep(80);
    change(control.querySelector('#gapControl'), 54);
    await sleep(180);
    saved = MemoryState.load();
    const afterPages = MemoryRings.layoutPages(saved.stories, saved.settings);
    const afterPage = afterPages.find((page) => page.items.some((item) => item.story.id === innerId));
    const afterInnerItem = afterPage.items.find((item) => item.story.id === innerId);
    const afterOuterItem = afterPage.items.find((item) => item.story.id === outerId);
    const actualClearGap = afterOuterItem.radius - afterInnerItem.radius - afterInnerItem.style.fontSize / 2 - afterOuterItem.style.fontSize / 2;
    check('Pair spacing is stored as text-band clear space', storyBy(saved, outerId).gapBefore === 54 && Math.abs(actualClearGap - 54) < .01);
    check('Spacing keeps inner ring fixed and moves the outer ring outward', Math.abs(afterInnerItem.radius - beforeInner) < .01 && afterOuterItem.radius > beforeOuter);
    check('Minimum gap and irregularity avoid text-band collision', actualClearGap >= 18);
    check('Both rings in the edited pair are highlighted in admin', control.querySelectorAll('#adminCanvas .ring-text.is-selected').length === 2);

    control.querySelectorAll('#adminCanvas .ring-text')[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    control.querySelectorAll('#adminCanvas .ring-text')[2].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await sleep(80);
    check('Non-adjacent pair selection shows guidance', control.querySelector('#adminMessage').textContent.includes('not adjacent'));

    Array.from(control.querySelectorAll('.gap-row')).find((button) => !button.disabled).click();
    change(control.querySelector('[data-global-setting="showSelectionProjection"]'), true);
    await sleep(160);
    check('Projection selection overlay is opt-in', projection.querySelectorAll('.ring-text.is-selected').length === 2 && projection.querySelectorAll('.ring-guide.is-visible').length >= 2);
    change(control.querySelector('[data-global-setting="showSelectionProjection"]'), false);
    await sleep(120);

    controlFrame.contentWindow.location.reload();
    await new Promise((resolve) => { controlFrame.onload = resolve; });
    await sleep(180);
    control = controlFrame.contentDocument;
    const restored = MemoryState.load();
    check('Refresh restores independent styles and pair spacing', restored.stories[0].style.widthScale === 108 && storyBy(restored, outerId).gapBefore === 54);

    let exportedBlob;
    control.defaultView.URL.createObjectURL = (blob) => { exportedBlob = blob; return '#test-download'; };
    control.defaultView.URL.revokeObjectURL = () => {};
    control.defaultView.HTMLAnchorElement.prototype.click = function () {};
    control.querySelector('#exportData').click();
    await sleep(80);
    const exported = JSON.parse(await exportedBlob.text());
    check('JSON export includes interaction, global flow, ring flow, styles and gaps', exported.version === 6 && exported.settings.hoverStrength === 1 && exported.settings.cursorSize === 24 && exported.settings.autoTextFlowEnabled && exported.stories[0].flow.enabled && exported.stories[0].style.widthScale === 108 && typeof exported.stories[1].gapBefore === 'number');

    const legacyPayload = {
      version: 1,
      stories: [{ id: 'legacy-1', text: '旧データ old tree', submittedAt: '2025-01-02T03:04:05.000Z' }],
      settings: { fontStyle: 'sans', fontSize: 25, fontWeight: 500, letterSpacing: 2, widthScale: 105, ringSpacing: 57, revealSpeed: 9, compositionScale: 100, offsetX: 0, offsetY: 0, ringsPerPage: 8 }
    };
    const file = new File([JSON.stringify(legacyPayload)], 'legacy.json', { type: 'application/json' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const fileInput = control.querySelector('#importFile');
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => control.querySelector('#adminMessage').textContent.startsWith('1 memories'), 2500);
    const imported = MemoryState.load();
    check('Legacy JSON receives compatible style, gap, interaction and flow defaults', imported.version === 6 && imported.stories[0].style.fontSize === 25 && imported.stories[0].style.fontStyle === 'sans' && imported.stories[0].gapBefore === 32 && imported.stories[0].flow.enabled === false && imported.settings.autoMotionEnabled === true && imported.settings.autoTextFlowEnabled === false && !imported.settings.groupInteractionEnabled && !imported.settings.pointerInteractionEnabled && imported.archives.length === 0 && imported.selectedGroupId === imported.currentGroupId);
    const migratedV3 = MemoryState.normalise({ version: 3, settings: { autoMotionEnabled: false }, stories: [{ id: 'v3-flow', text: 'old flowing ring', flow: { enabled: true, direction: 'clockwise', speed: .5 } }] });
    check('Existing disabled undulation is preserved and old flowing rings keep playing', migratedV3.settings.autoMotionEnabled === false && migratedV3.settings.autoTextFlowEnabled === true);

    control.querySelector('#undoStory').click();
    await sleep(120);
    check('Undo remains functional', MemoryState.load().stories.length === 0);
    control.querySelector('#loadDemo').click();
    await sleep(150);
    check('Labeled example data still loads', MemoryState.load().stories.filter((story) => story.isDemo).length === 3);
    control.querySelector('#removeDemo').click();
    await sleep(120);
    check('Example data can still be removed', MemoryState.load().stories.length === 0);

    const managedInput = control.querySelector('#memoryInput');
    check('Audience and inline editors use the unified 2,000-character limit', managedInput.maxLength === 2000 && MemoryState.MAX_MEMORY_LENGTH === 2000);
    const longEnglish = Array.from({ length: 24 }, (_, index) => `Marker-${index}: I remember the branches moving above the quiet path.`).join(' ');
    check('Long English test fixture exceeds the former limit and stays within the new limit', longEnglish.length > 140 && longEnglish.length < 2000, String(longEnglish.length));
    submit(control, longEnglish);
    await sleep(320);
    let managedState = MemoryState.load();
    const longId = managedState.stories[0].id;
    let longItems = MemoryRings.layoutPages(managedState.stories, managedState.settings).flatMap((page) => page.items).filter((item) => item.story.id === longId);
    check('Long English memory is submitted and stored without truncation', managedState.stories[0].text === longEnglish);
    check('Long memory continues across stable adjacent display rings', longItems.length > 1 && longItems.every((item, index) => item.ringId === `${longId}--${index}`), String(longItems.length));
    check('Long-ring segments reconstruct the complete display text', longItems.map((item) => item.displayText).join('').replace(/\s+/g, ' ') === longEnglish.replace(/\s+/g, ' '));
    check('Projection receives all visible segments for its current group', projection.querySelectorAll(`.ring-text[data-story-id="${longId}"]`).length > 0);

    control.querySelector(`.memory-action-edit[data-story-id="${longId}"]`).click();
    await sleep(80);
    let inlineEditor = control.querySelector(`[data-edit-story-id="${longId}"]`);
    check('Edit expands beneath the existing row with the complete original memory', inlineEditor && inlineEditor.value === longEnglish && inlineEditor.maxLength === 2000);
    inlineEditor.value = 'Temporary unsaved edit';
    inlineEditor.dispatchEvent(new Event('input', { bubbles: true }));
    inlineEditor.focus();
    inlineEditor.setSelectionRange(9, 9);
    const inlineEditorBeforeRender = inlineEditor;
    change(control.querySelector('[data-global-setting="compositionScale"]'), Number(control.querySelector('[data-global-setting="compositionScale"]').value));
    await sleep(90);
    inlineEditor = control.querySelector(`[data-edit-story-id="${longId}"]`);
    check('An unsaved inline edit keeps its live field, text and caret through a settings render', inlineEditor === inlineEditorBeforeRender && inlineEditor.value === 'Temporary unsaved edit' && inlineEditor.selectionStart === 9,
      `${inlineEditor === inlineEditorBeforeRender}/${inlineEditor.value}/${inlineEditor.selectionStart}`);
    control.querySelector(`.memory-action-cancel[data-story-id="${longId}"]`).click();
    await sleep(80);
    check('Cancel closes the editor without changing the memory', !control.querySelector(`[data-edit-story-id="${longId}"]`) && MemoryState.load().stories[0].text === longEnglish);

    const boundaryText = ('Tree memory with punctuation.\n中文树木的记忆。\n日本語の木の思い出。\n').repeat(90).slice(0, 2000);
    control.querySelector(`.memory-action-edit[data-story-id="${longId}"]`).click();
    inlineEditor = control.querySelector(`[data-edit-story-id="${longId}"]`);
    inlineEditor.value = boundaryText;
    inlineEditor.dispatchEvent(new Event('input', { bubbles: true }));
    check('Mixed-language edit counter accepts the exact 2,000-character boundary', control.querySelector(`[data-edit-count="${longId}"]`).textContent.startsWith('2000'));
    control.querySelector(`[data-edit-form="${longId}"]`).requestSubmit();
    await sleep(320);
    managedState = MemoryState.load();
    check('Saving an edit preserves all 2,000 original characters and closes the form', managedState.stories[0].text === boundaryText && !control.querySelector(`[data-edit-story-id="${longId}"]`));
    longItems = MemoryRings.layoutPages(managedState.stories, managedState.settings).flatMap((page) => page.items).filter((item) => item.story.id === longId);
    const reconstructedBoundary = longItems.map((item) => item.displayText).join('').replace(/\s+/g, ' ');
    const normalizedBoundary = boundaryText.replace(/\s+/g, ' ');
    check('Edited long text is repartitioned without shrinking it into one ring', longItems.length > 1 && reconstructedBoundary === normalizedBoundary,
      `${longItems.length}/${reconstructedBoundary.length}/${normalizedBoundary.length}/${Array.from(reconstructedBoundary).findIndex((character, index) => character !== Array.from(normalizedBoundary)[index])}`);
    control.querySelector('#undoStory').click();
    await sleep(180);
    check('Undo restores the text before an edit', MemoryState.load().stories[0].text === longEnglish);

    control.querySelector(`.memory-action-edit[data-story-id="${longId}"]`).click();
    inlineEditor = control.querySelector(`[data-edit-story-id="${longId}"]`);
    inlineEditor.value = boundaryText;
    inlineEditor.dispatchEvent(new Event('input', { bubbles: true }));
    control.querySelector(`[data-edit-form="${longId}"]`).requestSubmit();
    await sleep(250);
    submit(control, 'Inner neighbor before deletion');
    await sleep(180);
    submit(control, 'Middle memory for deletion');
    await sleep(220);
    const middleId = MemoryState.load().stories[2].id;
    submit(control, 'Outer memory after deletion');
    await sleep(220);
    const outerIdAfterDelete = MemoryState.load().stories[3].id;
    control.defaultView.confirm = () => true;
    control.querySelector(`.memory-action-delete[data-story-id="${middleId}"]`).click();
    await sleep(240);
    managedState = MemoryState.load();
    check('Deleting a middle memory removes only that stable ID and its display rings', managedState.stories.length === 3 && !storyBy(managedState, middleId) && storyBy(managedState, longId) && storyBy(managedState, outerIdAfterDelete) && !projection.querySelector(`[data-story-id="${middleId}"]`));
    const remainingGap = Array.from(control.querySelectorAll('.gap-row')).find((button) => !button.disabled && button.dataset.outerId === outerIdAfterDelete);
    if (remainingGap) {
      remainingGap.click();
      change(control.querySelector('#gapControl'), 47);
      await sleep(180);
    }
    check('Gap editing still targets the new adjacent pair after a middle deletion', remainingGap && storyBy(MemoryState.load(), outerIdAfterDelete).gapBefore === 47);
    control.querySelector('#undoStory').click();
    await sleep(220);
    check('Undo restores a deleted memory at its original position', MemoryState.load().stories[2].id === middleId);
    control.querySelector(`.memory-action-delete[data-story-id="${middleId}"]`).click();
    await sleep(220);

    exportedBlob = undefined;
    control.defaultView.URL.createObjectURL = (blob) => { exportedBlob = blob; return '#test-download-long'; };
    control.defaultView.URL.revokeObjectURL = () => {};
    control.defaultView.HTMLAnchorElement.prototype.click = function () {};
    control.querySelector('#exportData').click();
    await sleep(80);
    const managedExport = JSON.parse(await exportedBlob.text());
    check('JSON export keeps the complete edited original and omits the deleted memory', storyBy(managedExport, longId).text === boundaryText && !storyBy(managedExport, middleId));

    controlFrame.contentWindow.location.reload();
    await new Promise((resolve) => { controlFrame.onload = resolve; });
    await sleep(260);
    control = controlFrame.contentDocument;
    managedState = MemoryState.load();
    check('Refresh preserves edit, deletion and updated gap results', storyBy(managedState, longId).text === boundaryText && !storyBy(managedState, middleId) && storyBy(managedState, outerIdAfterDelete).gapBefore === 47);
    check('Edit and delete controls remain administrator-only', control.querySelectorAll('.memory-action-edit,.memory-action-delete').length === managedState.stories.length * 2 && projection.querySelectorAll('.memory-action-edit,.memory-action-delete,[data-edit-form]').length === 0);

    const managedImportFile = new File([JSON.stringify(managedExport)], 'managed-memory-rings.json', { type: 'application/json' });
    const managedTransfer = new DataTransfer();
    managedTransfer.items.add(managedImportFile);
    const managedFileInput = control.querySelector('#importFile');
    managedFileInput.files = managedTransfer.files;
    managedFileInput.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => control.querySelector('#adminMessage').textContent.includes('imported'), 2500);
    check('JSON import restores the complete 2,000-character edited memory', storyBy(MemoryState.load(), longId).text === boundaryText);

    const beforeRejected = managedState.stories.length;
    const refreshedInput = control.querySelector('#memoryInput');
    refreshedInput.value = 'x'.repeat(2001);
    refreshedInput.dispatchEvent(new Event('input', { bubbles: true }));
    control.querySelector('#memoryForm').requestSubmit();
    await sleep(100);
    check('Programmatic over-limit input is rejected instead of silently truncated', MemoryState.load().stories.length === beforeRejected && control.querySelector('#formMessage').textContent.includes('2,000'));

    // A whole group is archived as an independent snapshot; later input remains central.
    submit(control, 'Archive middle sentinel');
    await sleep(120);
    const firstOriginal = MemoryState.load();
    const firstStoryId = firstOriginal.stories[0].id;
    const middleArchiveId = firstOriginal.stories[1].id;
    const outerArchiveId = firstOriginal.stories[2].id;
    control.defaultView.confirm = () => true;
    control.querySelector('#archiveCurrent').click();
    await sleep(180);
    let grouped = MemoryState.load();
    const firstGroupId = grouped.archives[0].id;
    check('Archiving snapshots all original memories, styles and spacing and empties the center', grouped.archives.length === 1 && grouped.stories.length === 0 && grouped.archives[0].stories[0].text === firstOriginal.stories[0].text && grouped.archives[0].stories[0].style.fontSize === firstOriginal.stories[0].style.fontSize && grouped.archives[0].stories[1].gapBefore === firstOriginal.stories[1].gapBefore && grouped.currentGroupId !== firstGroupId);
    check('Archived rings stay visible without replaying their reveal animation', projection.querySelector(`[data-group-id="${firstGroupId}"] .ring-text`) && !projection.querySelector(`[data-group-id="${firstGroupId}"] .is-revealing`));
    control.querySelector('#archiveCurrent').click();
    check('An empty current group cannot create another archive', MemoryState.load().archives.length === 1);

    submit(control, 'Group two tree / 二本目の木');
    await sleep(100);
    control.querySelector('#archiveCurrent').click();
    await sleep(120);
    submit(control, 'Group three tree / 三本目の木');
    await sleep(100);
    control.querySelector('#archiveCurrent').click();
    await sleep(180);
    grouped = MemoryState.load();
    check('Three consecutive archives retain three unique group IDs and every memory', grouped.archives.length === 3 && new Set(grouped.archives.map((group) => group.id)).size === 3 && grouped.archives[0].stories.length === firstOriginal.stories.length && grouped.archives[1].stories[0].text.includes('Group two') && grouped.archives[2].stories[0].text.includes('Group three'));
    check('Projection defaults to the latest two archives and a new center', grouped.archiveDisplayIds.length === 2 && !grouped.archiveDisplayIds.includes(firstGroupId) && projection.querySelectorAll('.memory-group.is-archived').length === 2 && projection.querySelector('.memory-group.is-current'));

    const oldVisible = control.querySelector(`[data-archive-visible="${firstGroupId}"]`);
    oldVisible.checked = true;
    oldVisible.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(140);
    check('An older archive can replace a displayed archive without deleting data', MemoryState.load().archiveDisplayIds[0] === firstGroupId && projection.querySelector(`[data-group-id="${firstGroupId}"]`));
    const chooser = control.querySelector('#groupSelector');
    chooser.value = firstGroupId;
    chooser.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(120);
    control.querySelector(`.memory-action-edit[data-story-id="${firstStoryId}"]`).click();
    const archiveEditor = control.querySelector(`[data-edit-story-id="${firstStoryId}"]`);
    check('Archived group editing opens the original memory in the existing list', archiveEditor && archiveEditor.value === firstOriginal.stories[0].text);
    archiveEditor.value = 'Edited archive tree / 保存済みの木';
    archiveEditor.dispatchEvent(new Event('input', { bubbles: true }));
    control.querySelector(`[data-edit-form="${firstStoryId}"]`).requestSubmit();
    await sleep(150);
    grouped = MemoryState.load();
    check('Editing an archive updates only its snapshot and synchronizes projection', grouped.archives[0].stories[0].text.startsWith('Edited archive') && grouped.stories.length === 0 && projection.querySelector(`[data-group-id="${firstGroupId}"] .ring-text[data-story-id="${firstStoryId}"]`).getAttribute('aria-label').startsWith('Edited archive'));
    control.querySelector(`.memory-action-delete[data-story-id="${middleArchiveId}"]`).click();
    await sleep(120);
    const archivedGap = control.querySelector(`[data-inner-id="${firstStoryId}"][data-outer-id="${outerArchiveId}"]`);
    check('Deleting a middle archived memory leaves the correct adjacent gap', grouped.archives[0].stories.length === firstOriginal.stories.length && MemoryState.load().archives[0].stories.length === firstOriginal.stories.length - 1 && archivedGap && !archivedGap.disabled, `${grouped.archives[0].stories.length}/${MemoryState.load().archives[0].stories.length}/${Boolean(archivedGap)}/${archivedGap && archivedGap.disabled}`);
    archivedGap.click();
    change(control.querySelector('#gapControl'), 43);
    await sleep(160);
    check('Gap edits affect the selected archive only', MemoryState.load().archives[0].stories[1].gapBefore === 43 && MemoryState.load().archives[1].stories[0].gapBefore !== 43);

    submit(control, 'Only the new center receives this memory.');
    await sleep(160);
    grouped = MemoryState.load();
    check('Audience input goes to the current group even when an archive was selected', grouped.selectedGroupId === grouped.currentGroupId && grouped.stories.length === 1 && grouped.archives[0].stories.length === firstOriginal.stories.length - 1 && grouped.stories[0].text.startsWith('Only the new center'), `${grouped.selectedGroupId === grouped.currentGroupId}/${grouped.stories.length}/${grouped.archives[0].stories.length}`);
    chooser.value = firstGroupId;
    chooser.dispatchEvent(new Event('change', { bubbles: true }));
    change(control.querySelector('[data-group-layout="x"]'), 125);
    control.querySelector('[data-group-layout="x"]').dispatchEvent(new Event('change', { bubbles: true }));
    change(control.querySelector('[data-group-layout="y"]'), 0);
    control.querySelector('[data-group-layout="y"]').dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(160);
    const currentPath = projection.querySelector(`[data-group-id="${grouped.currentGroupId}"] .ring-guide`);
    const coupledPath = currentPath.getAttribute('d');
    const hideOld = control.querySelector(`[data-archive-visible="${firstGroupId}"]`);
    hideOld.checked = false;
    hideOld.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(130);
    check('Nearby groups create a bounded local outer-contour response', projection.querySelector(`[data-group-id="${grouped.currentGroupId}"] .ring-guide`).getAttribute('d') !== coupledPath);

    const archiveRoundTrip = MemoryState.normalise(MemoryState.load());
    check('Grouped data survives JSON normalization with layout and display choices', archiveRoundTrip.archives.length === 3 && archiveRoundTrip.archives[0].layout.x === 125 && !archiveRoundTrip.archiveDisplayIds.includes(firstGroupId) && archiveRoundTrip.stories[0].text.startsWith('Only the new center'));
    let groupExportBlob;
    control.defaultView.URL.createObjectURL = (blob) => { groupExportBlob = blob; return '#group-export'; };
    control.defaultView.URL.revokeObjectURL = () => {};
    control.defaultView.HTMLAnchorElement.prototype.click = function () {};
    control.querySelector('#exportData').click();
    const groupExport = JSON.parse(await groupExportBlob.text());
    check('JSON export includes all archived snapshots, IDs, time, layout and display state', groupExport.version === 6 && groupExport.archives.length === 3 && groupExport.archives[0].id === firstGroupId && groupExport.archives[0].archivedAt && groupExport.archives[0].layout.x === 125 && groupExport.archiveDisplayIds.length === 1);
    const groupFile = new File([JSON.stringify(groupExport)], 'groups.json', { type: 'application/json' });
    const groupTransfer = new DataTransfer();
    groupTransfer.items.add(groupFile);
    const groupInput = control.querySelector('#importFile');
    groupInput.files = groupTransfer.files;
    groupInput.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => control.querySelector('#adminMessage').textContent.includes('groups imported'), 2500);
    check('JSON import restores archives and synchronizes their projection visibility', MemoryState.load().archives.length === 3 && MemoryState.load().archives[0].layout.x === 125 && !projection.querySelector(`[data-group-id="${firstGroupId}"]`));
    controlFrame.contentWindow.location.reload();
    await new Promise((resolve) => { controlFrame.onload = resolve; });
    await sleep(160);
    check('Refresh restores all archive groups and active memory', MemoryState.load().archives.length === 3 && MemoryState.load().stories.length === 1);

    control = controlFrame.contentDocument;
    const currentGroupId = MemoryState.load().currentGroupId;
    const secondGroupId = MemoryState.load().archives[1].id;
    const selectGroup = (id) => {
      const selector = control.querySelector('#groupSelector');
      selector.value = id;
      selector.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const setGroupNumber = (key, value) => {
      const field = control.querySelector(`[data-group-number="${key}"]`);
      field.value = value;
      field.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const groupPath = (id) => {
      const paths = projection.querySelectorAll(`[data-group-id="${id}"] .ring-guide`);
      return paths[paths.length - 1];
    };
    const pairContact = (a, b) => projection.defaultView.MemoryMotion.groupContactSnapshot(projection.querySelector('#ringsCanvas'))
      .find((pair) => [pair.firstId, pair.secondId].includes(a) && [pair.firstId, pair.secondId].includes(b));
    [firstGroupId, secondGroupId].forEach((id) => {
      const box = control.querySelector(`[data-archive-visible="${id}"]`);
      if (!box.checked) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await sleep(130);
    [currentGroupId, firstGroupId, secondGroupId].forEach((id) => {
      selectGroup(id);
      change(control.querySelector('[data-global-setting="autoMotionEnabled"]'), false);
    });
    await sleep(180);
    control.querySelector('#layoutMode').click();
    change(control.querySelector('[data-global-setting="groupInteractionEnabled"]'), false);
    selectGroup(currentGroupId);
    setGroupNumber('x', 0); setGroupNumber('y', 0); setGroupNumber('scale', 100);
    selectGroup(firstGroupId);
    setGroupNumber('x', 200); setGroupNumber('y', 0); setGroupNumber('scale', 70);
    selectGroup(secondGroupId);
    setGroupNumber('x', 500); setGroupNumber('y', 300); setGroupNumber('scale', 50);
    await sleep(260);
    const centerBase = groupPath(currentGroupId).getAttribute('d');
    const archiveBase = groupPath(firstGroupId).getAttribute('d');
    change(control.querySelector('[data-global-setting="groupInteractionEnabled"]'), true);
    await sleep(850);
    const centerContact = pairContact(currentGroupId, firstGroupId);
    check('Current and archived contours both react at the adjusted contact position', centerContact && centerContact.strength > .1 && groupPath(currentGroupId).getAttribute('d') !== centerBase && groupPath(firstGroupId).getAttribute('d') !== archiveBase, centerContact && `${centerContact.gap}/${centerContact.strength}`);
    check('Group layout controls retain independent center and archive values', MemoryState.load().activeLayout.x === 0 && MemoryState.load().activeLayout.scale === 100 && MemoryState.load().archives[0].layout.x === 200 && MemoryState.load().archives[0].layout.scale === 70);
    check('Selection boundary stays in admin preview only', control.querySelector('#adminCanvas .group-layout-boundary') && !projection.querySelector('.group-layout-boundary'));

    selectGroup(firstGroupId);
    setGroupNumber('x', -450); setGroupNumber('y', 300);
    await sleep(250);
    const recoveryEarly = pairContact(currentGroupId, firstGroupId).strength;
    await sleep(3200);
    const recoveryLate = pairContact(currentGroupId, firstGroupId).strength;
    check('Group deformation decays smoothly after separation', recoveryEarly > recoveryLate && recoveryLate < .2, `${recoveryEarly}/${recoveryLate}`);

    selectGroup(currentGroupId);
    setGroupNumber('x', -500); setGroupNumber('y', 300);
    const firstArchiveBase = groupPath(firstGroupId).getAttribute('d');
    const secondArchiveBase = groupPath(secondGroupId).getAttribute('d');
    selectGroup(firstGroupId);
    setGroupNumber('x', 100); setGroupNumber('y', -230); setGroupNumber('scale', 70);
    selectGroup(secondGroupId);
    setGroupNumber('x', 250); setGroupNumber('y', -230); setGroupNumber('scale', 70);
    await sleep(800);
    const archiveContact = pairContact(firstGroupId, secondGroupId);
    check('Two archived groups both deform when they meet above the canvas center', archiveContact && archiveContact.strength > .1 && archiveContact.gap < 90 && groupPath(firstGroupId).getAttribute('d') !== firstArchiveBase && groupPath(secondGroupId).getAttribute('d') !== secondArchiveBase && MemoryState.load().archives[0].layout.y === -230 && MemoryState.load().archives[1].layout.y === -230, archiveContact && `${archiveContact.gap}/${archiveContact.strength}`);
    setGroupNumber('scale', 20);
    await sleep(170);
    const smallGap = pairContact(firstGroupId, secondGroupId).gap;
    setGroupNumber('scale', 140);
    await sleep(170);
    const largeGap = pairContact(firstGroupId, secondGroupId).gap;
    check('Contact distance uses the edited archive scale', largeGap < smallGap - 20, `${smallGap}/${largeGap}`);

    selectGroup(firstGroupId);
    const surface = control.querySelector('#adminCanvas .group-layout-surface');
    const composition = control.querySelector('#adminCanvas .composition');
    const centerPoint = control.querySelector('#adminCanvas').createSVGPoint();
    centerPoint.x = 700; centerPoint.y = 170;
    const client = centerPoint.matrixTransform(composition.getScreenCTM());
    surface.dispatchEvent(new control.defaultView.PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 91, buttons: 1, clientX: client.x, clientY: client.y }));
    surface.dispatchEvent(new control.defaultView.PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 91, buttons: 1, clientX: client.x + 22, clientY: client.y - 8 }));
    surface.dispatchEvent(new control.defaultView.PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 91, clientX: client.x + 22, clientY: client.y - 8 }));
    await sleep(150);
    const movedArchiveX = MemoryState.load().archives[0].layout.x;
    check('Dragging inside a group’s hollow center moves the whole group without local drag', movedArchiveX > 100 && !control.defaultView.MemoryMotion.snapshot().drag.active && control.querySelector('#adminCanvas').classList.contains('is-layout-mode'), String(movedArchiveX));
    control.querySelector('#interactMode').click();
    change(control.querySelector('[data-global-setting="pointerInteractionEnabled"]'), true);
    check('Interaction mode restores the ripple layer without moving group layout', control.querySelector('#adminCanvas').classList.contains('is-interact-mode') && !control.querySelector('#adminCanvas').classList.contains('is-layout-mode') && MemoryState.load().archives[0].layout.x === movedArchiveX);
    check('Projection receives the dragged placement without edit controls', projection.querySelector(`[data-group-id="${firstGroupId}"]`).getAttribute('transform').includes(`translate(${movedArchiveX} `) && !projection.querySelector('.group-layout-surface,.group-layout-boundary'));

    let layoutExportBlob;
    control.defaultView.URL.createObjectURL = (blob) => { layoutExportBlob = blob; return '#layout-export'; };
    control.defaultView.URL.revokeObjectURL = () => {};
    control.defaultView.HTMLAnchorElement.prototype.click = function () {};
    control.querySelector('#exportData').click();
    const layoutExport = JSON.parse(await layoutExportBlob.text());
    check('JSON export includes current layout and separate group-contact settings', layoutExport.activeLayout.x === -500 && layoutExport.archives[0].layout.x === movedArchiveX && layoutExport.archives[1].layout.scale === 140 && layoutExport.settings.groupInteractionEnabled && layoutExport.settings.groupInfluenceDistance === 90);
    const layoutFile = new File([JSON.stringify(layoutExport)], 'group-layout.json', { type: 'application/json' });
    const layoutTransfer = new DataTransfer(); layoutTransfer.items.add(layoutFile);
    const layoutImport = control.querySelector('#importFile');
    layoutImport.files = layoutTransfer.files;
    layoutImport.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => control.querySelector('#adminMessage').textContent.includes('groups imported'), 2500);
    check('JSON import restores adjusted group layout and projection placement', MemoryState.load().activeLayout.x === -500 && MemoryState.load().archives[0].layout.x === movedArchiveX && projection.querySelector(`[data-group-id="${firstGroupId}"]`).getAttribute('transform').includes(`translate(${movedArchiveX} `));

    controlFrame.contentWindow.location.reload();
    await new Promise((resolve) => { controlFrame.onload = resolve; });
    await sleep(170);
    check('Refresh keeps positions, scale, contact settings and interaction mode', MemoryState.load().activeLayout.x === -500 && MemoryState.load().archives[0].layout.x === movedArchiveX && MemoryState.load().archives[1].layout.scale === 140 && MemoryState.load().settings.groupInteractionEnabled && MemoryState.load().editor.mode === 'interact');
    control = controlFrame.contentDocument;
    const visibleIds = [firstGroupId, secondGroupId, currentGroupId];
    const beforeOrder = Array.from(projection.querySelectorAll('.memory-group')).map((node) => node.dataset.groupId);
    selectGroup(firstGroupId);
    control.querySelector('#bringGroupForward').click();
    await sleep(130);
    const afterOrder = Array.from(projection.querySelectorAll('.memory-group')).map((node) => node.dataset.groupId);
    check('Bring forward changes visible SVG group order without altering memories', beforeOrder.indexOf(firstGroupId) < beforeOrder.indexOf(secondGroupId) && afterOrder.indexOf(firstGroupId) > afterOrder.indexOf(secondGroupId) && MemoryState.load().archives[0].stories.length > 0);
    check('Each visible group has an invisible outer-contour occluder', visibleIds.every((id) => {
      const node = projection.querySelector(`[data-group-id="${id}"]`);
      return node && node.firstElementChild.classList.contains('group-occlusion') && node.firstElementChild.getAttribute('fill') === '#000' && node.firstElementChild.getAttribute('d').endsWith(' Z');
    }) && !projection.querySelector('.group-layout-boundary'));
    const overlapTextNode = projection.querySelector(`[data-group-id="${firstGroupId}"] .ring-text`);
    const overlapTransform = projection.querySelector(`[data-group-id="${firstGroupId}"]`).getAttribute('transform');
    control.querySelector('#overlapDisplay').click();
    await sleep(120);
    check('Overlap reveals both current and archived groups without rebuilding text', MemoryState.load().groupDisplayMode === 'overlap' && control.querySelector('#overlapDisplay').getAttribute('aria-pressed') === 'true' && projection.querySelector(`[data-group-id="${firstGroupId}"] .ring-text`) === overlapTextNode && projection.querySelector(`[data-group-id="${firstGroupId}"]`).getAttribute('transform') === overlapTransform && [firstGroupId, currentGroupId].every((id) => getComputedStyle(projection.querySelector(`[data-group-id="${id}"] .group-occlusion`)).display === 'none'));
    controlFrame.contentWindow.location.reload();
    await new Promise((resolve) => { controlFrame.onload = resolve; });
    control = controlFrame.contentDocument;
    await sleep(130);
    check('Layer order and Overlap mode survive refresh and sync to projection', MemoryState.load().groupOrder.indexOf(firstGroupId) > MemoryState.load().groupOrder.indexOf(secondGroupId) && MemoryState.load().groupDisplayMode === 'overlap' && control.querySelector('#overlapDisplay').getAttribute('aria-pressed') === 'true' && projection.querySelector('#ringsCanvas').classList.contains('is-overlap-mode'));
    let stackBlob;
    control.defaultView.URL.createObjectURL = (blob) => { stackBlob = blob; return '#stack-export'; };
    control.defaultView.HTMLAnchorElement.prototype.click = function () {};
    control.querySelector('#exportData').click();
    const stackJson = JSON.parse(await stackBlob.text());
    check('JSON export keeps group order, display mode and interaction switches', stackJson.groupOrder.indexOf(firstGroupId) > stackJson.groupOrder.indexOf(secondGroupId) && stackJson.groupDisplayMode === 'overlap' && typeof stackJson.settings.pointerInteractionEnabled === 'boolean');
    const stackFile = new File([JSON.stringify(stackJson)], 'stacked-groups.json', { type: 'application/json' });
    const stackTransfer = new DataTransfer(); stackTransfer.items.add(stackFile);
    const stackInput = control.querySelector('#importFile');
    stackInput.files = stackTransfer.files;
    stackInput.dispatchEvent(new Event('change', { bubbles: true }));
    await waitFor(() => control.querySelector('#adminMessage').textContent.includes('groups imported'), 2500);
    check('JSON import restores order and Overlap mode in projection', MemoryState.load().groupOrder.indexOf(firstGroupId) > MemoryState.load().groupOrder.indexOf(secondGroupId) && MemoryState.load().groupDisplayMode === 'overlap' && projection.querySelector('#ringsCanvas').classList.contains('is-overlap-mode'));
    control.querySelector('#layeredDisplay').click();
    await sleep(100);
    check('Layered restores both group masks without changing placement', MemoryState.load().groupDisplayMode === 'layered' && control.querySelector('#layeredDisplay').getAttribute('aria-pressed') === 'true' && getComputedStyle(projection.querySelector(`[data-group-id="${firstGroupId}"] .group-occlusion`)).display !== 'none' && projection.querySelector(`[data-group-id="${firstGroupId}"]`).getAttribute('transform') === overlapTransform);
    change(control.querySelector('[data-global-setting="groupInteractionEnabled"]'), false);
    change(control.querySelector('[data-global-setting="pointerInteractionEnabled"]'), false);
    [currentGroupId, firstGroupId, secondGroupId].forEach((id) => {
      selectGroup(id);
      change(control.querySelector('[data-global-setting="autoMotionEnabled"]'), false);
    });
    await sleep(170);
    const quietMulti = projection.querySelectorAll('.ring-guide');
    const multiObserver = new MutationObserver(() => {});
    quietMulti.forEach((path) => multiObserver.observe(path, { attributes: true, attributeFilter: ['d'] }));
    projection.defaultView.MemoryMotion.step(projection.defaultView.MemoryMotion.now() + 2500);
    check('Three static groups skip contact checks and contour writes', projection.defaultView.MemoryMotion.groupContactSnapshot(projection.querySelector('#ringsCanvas')).length === 0 && multiObserver.takeRecords().length === 0 && !control.querySelector('#adminCanvas').classList.contains('is-interact-mode'));
    multiObserver.disconnect();
    const stackedExport = MemoryState.normalise(MemoryState.load());
    check('Layer order and disabled interactions survive state normalization', stackedExport.groupOrder.indexOf(firstGroupId) > stackedExport.groupOrder.indexOf(secondGroupId) && !stackedExport.settings.groupInteractionEnabled && !stackedExport.settings.pointerInteractionEnabled);
    change(control.querySelector('#archiveDisplayLimit'), 0);
    await sleep(170);
    const singleVisible = projection.querySelectorAll('.memory-group').length === 1;
    change(control.querySelector('#archiveDisplayLimit'), 2);
    await sleep(170);
    check('One-group and three-group display excludes hidden archives from rendering', singleVisible && projection.querySelectorAll('.memory-group').length === 3);
    change(control.querySelector('[data-global-setting="groupInteractionEnabled"]'), true);
    change(control.querySelector('[data-global-setting="pointerInteractionEnabled"]'), true);
    await sleep(170);
    check('Three-group interaction mode can be re-enabled without rebuilding stories', projection.defaultView.MemoryMotion.groupContactSnapshot(projection.querySelector('#ringsCanvas')).length > 0 && projection.querySelectorAll('.memory-group').length === 3 && MemoryState.load().settings.pointerInteractionEnabled);
  } catch (error) {
    check('Integration test script completes without exception', false, error.stack || error.message);
  } finally {
    if (backup === null) localStorage.removeItem(MemoryState.STORAGE_KEY);
    else localStorage.setItem(MemoryState.STORAGE_KEY, backup);

    const passed = results.filter((result) => result.pass).length;
    const list = document.querySelector('#results');
    results.forEach((result) => {
      const item = document.createElement('li');
      item.className = result.pass ? 'pass' : 'fail';
      item.textContent = `${result.pass ? 'PASS' : 'FAIL'}: ${result.name}${result.detail ? ` — ${result.detail}` : ''}`;
      list.append(item);
    });
    const allPassed = passed === results.length;
    document.body.className = allPassed ? 'pass' : 'fail';
    document.querySelector('#summary').textContent = `${allPassed ? 'PASS' : 'FAIL'} · ${passed} / ${results.length} checks`;
    document.title = `${allPassed ? 'PASS' : 'FAIL'} ${passed}/${results.length} · Memory Rings`;
  }

  function storyBy(snapshot, id) {
    return snapshot.stories.find((story) => story.id === id);
  }
}());
