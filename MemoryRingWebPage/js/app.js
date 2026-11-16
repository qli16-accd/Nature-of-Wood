(function () {
  'use strict';

  const projectionMode = new URLSearchParams(location.search).get('view') === 'projection';
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('memory-rings-sync-v1') : null;
  const projectionCanvas = document.querySelector('#ringsCanvas');
  const adminCanvas = document.querySelector('#adminCanvas');
  let state = MemoryState.load();
  let composing = false;
  let saveTimer;
  let memoryEditor = null;
  let adminGroupLayouts = [];
  let layoutDrag = null;
  const undoStack = [];

  document.body.classList.toggle('projection-mode', projectionMode);
  if (window.MemoryMotion) {
    MemoryMotion.setBroadcaster((payload) => {
      if (channel) channel.postMessage({ type: 'motion', motion: payload });
    });
  }

  function selectedArchive() { return state.archives.find((group) => group.id === state.selectedGroupId); }
  function selectedStories() { const group = selectedArchive(); return group ? group.stories : state.stories; }
  function selectedSettings() { const group = selectedArchive(); return group ? group.settings : state.settings; }
  function settingTarget(key) {
    return ['compositionScale', 'offsetX', 'offsetY', 'showSelectionProjection',
      'groupInteractionEnabled', 'groupInfluenceDistance', 'groupDeformationStrength', 'pointerInteractionEnabled'].includes(key)
      ? state.settings : selectedSettings();
  }
  function replaceSelectedStories(stories) {
    const group = selectedArchive();
    if (group) group.stories = stories;
    else state.stories = stories;
  }
  function pages() { return MemoryRings.layoutPages(selectedStories(), selectedSettings(), selectedArchive() ? { continuous: true } : undefined); }
  function pageCount() { return pages().length; }
  function clampPage() { state.currentPage = Math.min(Math.max(0, state.currentPage), MemoryRings.layoutPages(state.stories, state.settings).length - 1); }
  function storyIndex(id) { return selectedStories().findIndex((story) => story.id === id); }
  function storyById(id) { return selectedStories().find((story) => story.id === id); }

  function pageForStory(id) {
    return pages().findIndex((page) => page.items.some((item) => item.story.id === id));
  }

  function ensureSelectionPage() {
    const id = state.editor.selectedIds[0];
    if (!id) return;
    const targetPage = pageForStory(id);
    if (targetPage >= 0 && !selectedArchive()) state.currentPage = targetPage;
  }

  function syncGroupDisplayMode() {
    const overlap = state.groupDisplayMode === 'overlap';
    projectionCanvas.classList.toggle('is-overlap-mode', overlap);
    adminCanvas.classList.toggle('is-overlap-mode', overlap);
    if (projectionMode) return;
    [['#overlapDisplay', overlap], ['#layeredDisplay', !overlap]].forEach(([selector, active]) => {
      const button = document.querySelector(selector);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function render(animateId, archiveTransitionId, archiveFromScale, archiveOrigin) {
    clampPage();
    MemoryRings.render(projectionCanvas, state, { animateId, admin: false, archiveTransitionId, archiveFromScale, archiveOrigin });
    syncGroupDisplayMode();
    if (projectionMode) return;

    const adminInfo = MemoryRings.render(adminCanvas, state, { animateId, admin: true, archiveTransitionId, archiveFromScale, archiveOrigin });
    adminGroupLayouts = adminInfo.groupLayouts;
    adminCanvas.classList.toggle('is-layout-mode', state.editor.mode === 'layout');
    const displayRingCount = adminInfo.pages.reduce((total, page) => total + page.items.length, 0);
    document.querySelector('#pageStatus').textContent = `${selectedArchive() ? 'Archive' : 'Current'} · page ${adminInfo.page + 1} / ${adminInfo.totalPages} · ${selectedStories().length} memories · ${displayRingCount} rings / ${selectedArchive() ? '保存済み' : '現在'}・${selectedStories().length}件`;
    document.querySelector('#previousPage').disabled = Boolean(selectedArchive()) || adminInfo.page <= 0;
    document.querySelector('#nextPage').disabled = Boolean(selectedArchive()) || adminInfo.page >= adminInfo.totalPages - 1;
    document.querySelector('#undoStory').disabled = undoStack.length === 0 && selectedStories().length === 0;
    document.querySelector('#removeDemo').disabled = !selectedStories().some((story) => story.isDemo);
    const liveEditor = memoryEditor && document.querySelector(`[data-edit-story-id="${CSS.escape(memoryEditor.id)}"]`);
    if (!liveEditor) renderRingList(adminInfo.pages);
    renderGroupControls();
    syncControls();
  }

  function persist(action, animateId, archiveTransitionId, archiveFromScale, archiveOrigin) {
    clampPage();
    MemoryState.save(state);
    render(animateId, archiveTransitionId, archiveFromScale, archiveOrigin);
    if (channel) {
      channel.postMessage({ type: 'state', state, action, animateId, archiveTransitionId, archiveFromScale, archiveOrigin });
      const motion = window.MemoryMotion && MemoryMotion.snapshot();
      if (motion) channel.postMessage({ type: 'motion', motion });
    }
  }

  function delayedPersist(action) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist(action || 'settings'), 90);
  }

  function formatSetting(key, value) {
    if (key === 'fontSize' || key === 'letterSpacing' || key === 'ringSpacing') return `${value}px`;
    if (key === 'widthScale' || key === 'compositionScale' || key === 'motionAmplitude' || key === 'dragStrength' || key === 'hoverStrength') return `${value}%`;
    if (key === 'offsetX' || key === 'offsetY') return `${value > 0 ? '+' : ''}${value}`;
    if (key === 'revealSpeed' || key === 'motionPeriod' || key === 'returnTime') return `${value}s`;
    if (key === 'dragRange' || key === 'cursorSize' || key === 'groupInfluenceDistance' || key === 'groupDeformationStrength') return `${value}px`;
    if (key === 'speed' || key === 'globalFlowSpeed') return `${value} char/s`;
    return String(value);
  }

  function currentStyleTarget() {
    if (state.editor.mode === 'ring' && state.editor.selectedIds[0]) {
      const story = storyById(state.editor.selectedIds[0]);
      if (story) return story.style;
    }
    return selectedSettings();
  }

  function syncControls() {
    const target = currentStyleTarget();
    document.querySelectorAll('[data-style-setting]').forEach((input) => {
      const key = input.dataset.styleSetting;
      if (String(input.value) !== String(target[key])) input.value = target[key];
      input.disabled = ['spacing', 'interact', 'layout'].includes(state.editor.mode);
    });
    document.querySelectorAll('[data-style-output]').forEach((output) => {
      const key = output.dataset.styleOutput;
      output.value = formatSetting(key, target[key]);
    });
    document.querySelectorAll('[data-global-setting]').forEach((input) => {
      const key = input.dataset.globalSetting;
      const target = settingTarget(key);
      if (input.type === 'checkbox') input.checked = Boolean(target[key]);
      else if (String(input.value) !== String(target[key])) input.value = target[key];
    });
    document.querySelectorAll('[data-global-output]').forEach((output) => {
      const key = output.dataset.globalOutput;
      output.value = formatSetting(key, settingTarget(key)[key]);
    });

    const editing = document.querySelector('#editingLabel');
    const defaults = state.editor.mode === 'defaults';
    const spacing = state.editor.mode === 'spacing';
    const interacting = state.editor.mode === 'interact';
    const layingOut = state.editor.mode === 'layout';
    const selectedStory = storyById(state.editor.selectedIds[0]);
    editing.innerHTML = defaults
      ? 'Editing defaults for new rings<span class="jp">新しい年輪の初期設定</span>'
      : spacing
        ? 'Ring styles are locked while editing spacing.<span class="jp">間隔の編集中は文字設定を変更できません。</span>'
        : layingOut
          ? 'Positioning the selected group.<span class="jp">選択中のグループを配置しています。</span>'
        : interacting
          ? 'Interaction mode is active.<span class="jp">輪郭を触れて動かせます。</span>'
        : `Editing ring ${storyIndex(selectedStory && selectedStory.id) + 1}<span class="jp">年輪 ${storyIndex(selectedStory && selectedStory.id) + 1} を編集中</span>`;
    document.querySelector('#defaultGapField').hidden = !defaults;
    document.querySelector('#applyAllStyles').hidden = spacing || interacting || layingOut;
    document.querySelector('#spacingEditor').hidden = !spacing;

    if (spacing) {
      const pair = selectedPair();
      if (pair) {
        const innerNumber = pair.innerIndex + 1;
        const outerNumber = pair.outerIndex + 1;
        document.querySelector('#spacingLabel').textContent = `Adjusting rings ${innerNumber}–${outerNumber} / 年輪 ${innerNumber}–${outerNumber} の間隔`;
        document.querySelector('#gapControl').value = pair.outer.gapBefore;
        document.querySelector('#gapOutput').value = `${pair.outer.gapBefore}px`;
      }
    }
    document.querySelector('#previewHint').textContent = spacing
      ? 'Select two adjacent rings. / 隣り合う二つを選択。'
      : layingOut
        ? 'Select or drag a whole group, including its open center. / 中心の空白も含め、グループを選択・移動。'
      : interacting
        ? 'Hover or drag near a ring. / 年輪の近くで動かすかドラッグ。'
      : 'Click a ring to edit it. / 年輪をクリックして編集。';

    const interactButton = document.querySelector('#interactMode');
    interactButton.classList.toggle('is-active', interacting);
    document.querySelector('#layoutMode').classList.toggle('is-active', layingOut);
    const autoMotionStatus = document.querySelector('#autoMotionStatus');
    autoMotionStatus.textContent = selectedSettings().autoMotionEnabled ? 'On / オン' : 'Off / オフ';
    autoMotionStatus.classList.toggle('is-on', selectedSettings().autoMotionEnabled);
    const autoFlowStatus = document.querySelector('#autoFlowStatus');
    autoFlowStatus.textContent = selectedSettings().autoTextFlowEnabled ? 'On / オン' : 'Off / オフ';
    autoFlowStatus.classList.toggle('is-on', selectedSettings().autoTextFlowEnabled);
    const paused = state.settings.motionPausedAt !== null;
    const pauseButton = document.querySelector('#pauseMotion');
    pauseButton.classList.toggle('is-active', paused);
    pauseButton.innerHTML = paused
      ? '<span>Resume motion</span><span class="jp">動きを再開</span>'
      : '<span>Pause motion</span><span class="jp">動きを止める</span>';

    const flowStory = state.editor.mode === 'ring' ? selectedStory : null;
    document.querySelector('#flowEditorLabel').textContent = flowStory
      ? `Ring ${storyIndex(flowStory.id) + 1} / 年輪 ${storyIndex(flowStory.id) + 1}`
      : 'Select one ring. / 年輪を一つ選択。';
    document.querySelector('#flowEmpty').hidden = Boolean(flowStory);
    document.querySelector('#flowControls').hidden = !flowStory;
    document.querySelectorAll('[data-flow-setting]').forEach((input) => {
      input.disabled = !flowStory;
      if (!flowStory) return;
      const key = input.dataset.flowSetting;
      if (key === 'mode') input.value = flowStory.flow.enabled ? flowStory.flow.direction : 'still';
      else if (input.type === 'checkbox') input.checked = Boolean(flowStory.flow[key]);
      else if (String(input.value) !== String(flowStory.flow[key])) input.value = flowStory.flow[key];
    });
    document.querySelectorAll('[data-flow-output]').forEach((output) => {
      const key = output.dataset.flowOutput;
      output.value = flowStory ? formatSetting(key, flowStory.flow[key]) : '—';
    });
    const defaultMode = selectedSettings().newRingFlowEnabled
      ? (selectedSettings().newRingFlowDirection === 'counterclockwise' ? 'Counterclockwise' : 'Clockwise')
      : 'Still';
    document.querySelector('#flowDefaultStatus').textContent = `New rings: ${defaultMode}, ${selectedSettings().newRingFlowSpeed} char/s / 新しい年輪の初期値`;
  }

  function selectedPair() {
    if (state.editor.selectedIds.length !== 2) return null;
    const indices = state.editor.selectedIds.map(storyIndex).sort((a, b) => a - b);
    if (indices[0] < 0 || indices[1] !== indices[0] + 1) return null;
    return {
      innerIndex: indices[0], outerIndex: indices[1],
      inner: selectedStories()[indices[0]], outer: selectedStories()[indices[1]]
    };
  }

  function summary(text) {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > 54 ? `${clean.slice(0, 54)}…` : clean;
  }

  function rememberUndo(entry) {
    entry.groupId = state.selectedGroupId;
    undoStack.push(entry);
    if (undoStack.length > 30) undoStack.shift();
  }

  function captureMemoryEditor(list) {
    if (!memoryEditor) return;
    const input = list.querySelector(`[data-edit-story-id="${CSS.escape(memoryEditor.id)}"]`);
    if (!input) return;
    memoryEditor.draft = input.value;
    memoryEditor.focused = document.activeElement === input;
    memoryEditor.selectionStart = input.selectionStart;
    memoryEditor.selectionEnd = input.selectionEnd;
  }

  function memoryActionButton(action, storyId, english, japanese) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `memory-action memory-action-${action}`;
    button.dataset.memoryAction = action;
    button.dataset.storyId = storyId;
    const primary = document.createElement('span');
    primary.textContent = english;
    const secondary = document.createElement('span');
    secondary.className = 'jp';
    secondary.textContent = japanese;
    button.append(primary, secondary);
    return button;
  }

  function renderGroupControls() {
    const chooser = document.querySelector('#groupSelector');
    const oldValue = chooser.value;
    chooser.replaceChildren();
    const current = new Option('Current group / 現在のグループ', state.currentGroupId);
    chooser.append(current);
    state.archives.slice().reverse().forEach((group, index) => {
      const date = new Date(group.archivedAt).toLocaleDateString();
      chooser.append(new Option(`Archived ${state.archives.length - index} · ${date} / 保存済み`, group.id));
    });
    chooser.value = state.selectedGroupId;
    if (!chooser.value) chooser.value = oldValue;
    const list = document.querySelector('#archiveGroupList');
    list.replaceChildren();
    const currentRow = document.createElement('div');
    currentRow.className = `archive-group-row${state.selectedGroupId === state.currentGroupId ? ' is-selected' : ''}`;
    const currentTitle = document.createElement('span');
    currentTitle.textContent = `Current group · ${state.stories.length} memories / 現在のグループ`;
    const currentSelect = document.createElement('button');
    currentSelect.type = 'button';
    currentSelect.className = 'text-button';
    currentSelect.dataset.selectGroup = state.currentGroupId;
    currentSelect.textContent = 'Select / 選択';
    currentRow.append(currentTitle, currentSelect);
    list.append(currentRow);
    state.archives.slice().reverse().forEach((group, index) => {
      const row = document.createElement('div');
      row.className = `archive-group-row${group.id === state.selectedGroupId ? ' is-selected' : ''}`;
      const label = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.dataset.archiveVisible = group.id;
      check.checked = state.archiveDisplayIds.includes(group.id);
      const title = document.createElement('span');
      title.textContent = `Archive ${state.archives.length - index} · ${group.stories.length} memories / 保存済み`;
      label.append(check, title);
      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'text-button';
      select.dataset.selectGroup = group.id;
      select.textContent = 'Edit / 編集';
      row.append(label, select);
      list.append(row);
    });
    document.querySelector('#archiveDisplayLimit').value = state.archiveDisplayLimit;
    document.querySelector('#archiveDisplayCount').value = String(state.archiveDisplayLimit);
    document.querySelector('#archiveCurrent').disabled = !state.stories.length;
    const visibleOrder = state.groupOrder.filter((id) => id === state.currentGroupId || state.archiveDisplayIds.includes(id));
    const layerIndex = visibleOrder.indexOf(state.selectedGroupId);
    document.querySelector('#bringGroupForward').disabled = layerIndex < 0 || layerIndex === visibleOrder.length - 1;
    document.querySelector('#sendGroupBackward').disabled = layerIndex <= 0;
    const group = selectedArchive();
    const layout = group ? group.layout : state.activeLayout;
    const shownScale = !group && !layout.manual
      ? Math.round((adminGroupLayouts.find((entry) => entry.id === state.currentGroupId)?.scale || layout.scale / 100) * 100)
      : layout.scale;
    document.querySelector('#groupLayoutLabel').innerHTML = group
      ? 'Selected archive layout <span class="jp inline">保存済みグループの配置</span>'
      : 'Current group layout <span class="jp inline">現在のグループの配置</span>';
    ['x', 'y', 'scale'].forEach((key) => {
      const value = key === 'scale' ? shownScale : layout[key];
      document.querySelector(`[data-group-layout="${key}"]`).value = value;
      const number = document.querySelector(`[data-group-number="${key}"]`);
      if (document.activeElement !== number) number.value = value;
    });
  }

  function renderRingList(layoutPages) {
    const list = document.querySelector('#ringList');
    captureMemoryEditor(list);
    list.replaceChildren();
    if (!selectedStories().length) {
      const empty = document.createElement('p');
      empty.className = 'editing-label';
      empty.textContent = 'No memory rings yet. / まだ年輪はありません。';
      list.append(empty);
      return;
    }
    const firstPageMap = new Map();
    const lastPageMap = new Map();
    const ringCounts = new Map();
    layoutPages.forEach((page, pageIndex) => page.items.forEach((item) => {
      if (!firstPageMap.has(item.story.id)) firstPageMap.set(item.story.id, pageIndex);
      lastPageMap.set(item.story.id, pageIndex);
      ringCounts.set(item.story.id, (ringCounts.get(item.story.id) || 0) + 1);
    }));
    const selected = new Set(state.editor.selectedIds);
    selectedStories().forEach((story, index) => {
      if (index > 0) {
        const inner = selectedStories()[index - 1];
        const gap = document.createElement('button');
        gap.type = 'button';
        gap.className = `gap-row${selected.has(inner.id) && selected.has(story.id) ? ' is-selected' : ''}`;
        gap.dataset.innerId = inner.id;
        gap.dataset.outerId = story.id;
        const samePage = lastPageMap.get(inner.id) === firstPageMap.get(story.id);
        gap.disabled = !samePage;
        gap.textContent = samePage ? `${story.gapBefore}px clear gap / 年輪間隔` : 'group break / グループ境界';
        list.append(gap);
      }

      const entry = document.createElement('div');
      entry.className = 'ring-entry';
      const row = document.createElement('div');
      row.className = 'ring-entry-row';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ring-row${selected.has(story.id) ? ' is-selected' : ''}`;
      button.dataset.storyId = story.id;
      button.dataset.ringSelect = 'true';
      const count = ringCounts.get(story.id) || 1;
      button.innerHTML = `<span class="ring-index">${String(index + 1).padStart(2, '0')}</span><span class="ring-summary"></span><span class="ring-meta">${story.style.fontSize}px · ${story.style.widthScale}% · ${count} ring${count === 1 ? '' : 's'}</span>`;
      button.querySelector('.ring-summary').textContent = summary(story.text);
      const actions = document.createElement('div');
      actions.className = 'memory-row-actions';
      actions.append(
        memoryActionButton('edit', story.id, 'Edit', '編集'),
        memoryActionButton('delete', story.id, 'Delete', '削除')
      );
      row.append(button, actions);
      entry.append(row);

      if (memoryEditor && memoryEditor.id === story.id) {
        const editor = document.createElement('form');
        editor.className = 'memory-inline-editor';
        editor.dataset.editForm = story.id;
        const label = document.createElement('label');
        label.className = 'memory-edit-label';
        label.textContent = 'Edit original memory / 元の思い出を編集';
        const textarea = document.createElement('textarea');
        textarea.rows = 7;
        textarea.maxLength = MemoryState.MAX_MEMORY_LENGTH;
        textarea.dataset.editStoryId = story.id;
        textarea.value = memoryEditor.draft;
        const meta = document.createElement('div');
        meta.className = 'memory-edit-meta';
        const message = document.createElement('span');
        message.dataset.editMessage = story.id;
        message.textContent = 'Full original text / 元の文章';
        const counter = document.createElement('span');
        counter.dataset.editCount = story.id;
        counter.textContent = `${textarea.value.length} / 2,000`;
        meta.append(message, counter);
        const editorActions = document.createElement('div');
        editorActions.className = 'memory-edit-actions';
        const save = memoryActionButton('save', story.id, 'Save', '保存');
        save.type = 'submit';
        const cancel = memoryActionButton('cancel', story.id, 'Cancel', 'キャンセル');
        editorActions.append(save, cancel);
        label.append(textarea);
        editor.append(label, meta, editorActions);
        entry.append(editor);

        if (memoryEditor.focused) {
          setTimeout(() => {
            if (!textarea.isConnected) return;
            textarea.focus();
            textarea.setSelectionRange(memoryEditor.selectionStart, memoryEditor.selectionEnd);
          }, 0);
        }
      }
      list.append(entry);
    });
  }

  function adminNotice(message) {
    const node = document.querySelector('#adminMessage');
    if (node) node.textContent = message;
  }

  function selectRing(id) {
    const index = storyIndex(id);
    if (index < 0) return;
    if (state.editor.mode !== 'spacing') {
      state.editor.mode = 'ring';
      state.editor.selectedIds = [id];
    } else if (state.editor.selectedIds.length !== 1) {
      state.editor.selectedIds = [id];
      adminNotice('Choose one adjacent ring. / 隣の年輪を一つ選んでください。');
    } else {
      const firstIndex = storyIndex(state.editor.selectedIds[0]);
      if (Math.abs(firstIndex - index) !== 1) {
        adminNotice('Those rings are not adjacent. Choose neighboring rings. / 隣り合う年輪を選んでください。');
        return;
      }
      state.editor.selectedIds = [selectedStories()[Math.min(firstIndex, index)].id, selectedStories()[Math.max(firstIndex, index)].id];
    }
    ensureSelectionPage();
    persist('selection');
  }

  function setupControls() {
    const form = document.querySelector('#memoryForm');
    const input = document.querySelector('#memoryInput');
    const count = document.querySelector('#charCount');
    const formMessage = document.querySelector('#formMessage');

    document.querySelector('.admin-disclosure').addEventListener('toggle', (event) => {
      if (event.currentTarget.open) render();
    });

    function chooseGroup(id) {
      if (memoryEditor) {
        adminNotice('Save or cancel the open memory edit first. / 編集中の思い出を保存またはキャンセルしてください。');
        document.querySelector('#groupSelector').value = state.selectedGroupId;
        return;
      }
      if (id !== state.currentGroupId && !state.archives.some((group) => group.id === id)) return;
      state.selectedGroupId = id;
      state.editor = { mode: state.editor.mode === 'layout' ? 'layout' : 'defaults', selectedIds: [] };
      persist('group-selection');
    }

    const layoutSurface = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    layoutSurface.setAttribute('class', 'group-layout-surface');
    ['x', 'y'].forEach((key) => layoutSurface.setAttribute(key, '0'));
    layoutSurface.setAttribute('width', '1200');
    layoutSurface.setAttribute('height', '800');
    layoutSurface.setAttribute('aria-hidden', 'true');
    adminCanvas.append(layoutSurface);

    function layoutPoint(event) {
      const matrix = adminCanvas.querySelector('.composition').getScreenCTM();
      if (!matrix) return null;
      const point = adminCanvas.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      return point.matrixTransform(matrix.inverse());
    }

    function layoutForGroup(id) {
      const archive = state.archives.find((group) => group.id === id);
      return archive ? archive.layout : id === state.currentGroupId ? state.activeLayout : null;
    }

    function applyLayoutChange(id, key, value) {
      const layout = layoutForGroup(id);
      if (!layout || !Number.isFinite(value)) return;
      const displayed = adminGroupLayouts.find((group) => group.id === id);
      if (!layout.manual) {
        layout.scale = Math.round((displayed ? displayed.scale : layout.scale / 100) * 100);
        layout.manual = true;
      }
      const bounds = key === 'x' ? [-600, 600] : key === 'y' ? [-400, 400] : [10, 180];
      layout[key] = Math.min(bounds[1], Math.max(bounds[0], value));
      const placement = { x: layout.x, y: layout.y, scale: layout.scale / 100 };
      MemoryRings.applyGroupLayout(adminCanvas, id, placement);
      MemoryRings.applyGroupLayout(projectionCanvas, id, placement);
      if (channel) channel.postMessage({ type: 'layout-preview', id, placement, layout: Object.assign({}, layout) });
      ['x', 'y', 'scale'].forEach((field) => {
        document.querySelector(`[data-group-layout="${field}"]`).value = layout[field];
        const number = document.querySelector(`[data-group-number="${field}"]`);
        if (document.activeElement !== number) number.value = layout[field];
      });
    }

    layoutSurface.addEventListener('pointerdown', (event) => {
      if (state.editor.mode !== 'layout' || memoryEditor) return;
      const point = layoutPoint(event);
      if (!point) return;
      const hit = adminGroupLayouts.slice().reverse().find((group) => {
        const radius = Math.max(45, group.layout.maxRadius * group.scale + 18);
        return Math.hypot(point.x - 600 - group.x, point.y - 400 - group.y) <= radius;
      });
      if (!hit) return;
      event.preventDefault();
      try { layoutSurface.setPointerCapture(event.pointerId); } catch (_) { /* Synthetic pointer events may not capture. */ }
      layoutSurface.classList.add('is-dragging');
      if (state.selectedGroupId !== hit.id) {
        state.selectedGroupId = hit.id;
        state.editor = { mode: 'layout', selectedIds: [] };
        render();
      }
      const layout = layoutForGroup(hit.id);
      if (!layout.manual) {
        layout.scale = Math.round(hit.scale * 100);
        layout.manual = true;
      }
      layoutDrag = { pointerId: event.pointerId, id: hit.id, startX: point.x, startY: point.y,
        x: layout.x, y: layout.y, moved: false };
    });
    layoutSurface.addEventListener('pointermove', (event) => {
      if (!layoutDrag || layoutDrag.pointerId !== event.pointerId) return;
      const point = layoutPoint(event);
      if (!point) return;
      event.preventDefault();
      const x = layoutDrag.x + point.x - layoutDrag.startX;
      const y = layoutDrag.y + point.y - layoutDrag.startY;
      applyLayoutChange(layoutDrag.id, 'x', x);
      applyLayoutChange(layoutDrag.id, 'y', y);
      layoutDrag.moved = true;
    });
    function endLayoutDrag(event) {
      if (!layoutDrag || (event && event.pointerId !== undefined && event.pointerId !== layoutDrag.pointerId)) return;
      const moved = layoutDrag.moved;
      const pointerId = layoutDrag.pointerId;
      layoutDrag = null;
      layoutSurface.classList.remove('is-dragging');
      try { layoutSurface.releasePointerCapture(pointerId); } catch (_) { /* Already released. */ }
      if (moved) persist('group-layout');
      else persist('group-selection');
    }
    layoutSurface.addEventListener('pointerup', endLayoutDrag);
    layoutSurface.addEventListener('pointercancel', endLayoutDrag);
    window.addEventListener('blur', () => endLayoutDrag());

    document.querySelector('#layoutMode').addEventListener('click', () => {
      state.editor = { mode: 'layout', selectedIds: [] };
      persist('selection');
    });
    function moveGroupLayer(direction) {
      const id = state.selectedGroupId;
      const visible = state.groupOrder.filter((groupId) => groupId === state.currentGroupId || state.archiveDisplayIds.includes(groupId));
      const current = visible.indexOf(id);
      const neighbor = visible[current + direction];
      if (!neighbor) return;
      const first = state.groupOrder.indexOf(id);
      const second = state.groupOrder.indexOf(neighbor);
      [state.groupOrder[first], state.groupOrder[second]] = [state.groupOrder[second], state.groupOrder[first]];
      persist('group-order');
    }
    document.querySelector('#bringGroupForward').addEventListener('click', () => moveGroupLayer(1));
    document.querySelector('#sendGroupBackward').addEventListener('click', () => moveGroupLayer(-1));
    function setGroupDisplayMode(mode) {
      if (state.groupDisplayMode === mode) return;
      state.groupDisplayMode = mode;
      MemoryState.save(state);
      syncGroupDisplayMode();
      if (channel) channel.postMessage({ type: 'group-display', mode });
    }
    document.querySelector('#overlapDisplay').addEventListener('click', () => setGroupDisplayMode('overlap'));
    document.querySelector('#layeredDisplay').addEventListener('click', () => setGroupDisplayMode('layered'));
    document.querySelectorAll('[data-group-layout]').forEach((control) => {
      control.addEventListener('input', () => applyLayoutChange(state.selectedGroupId, control.dataset.groupLayout, Number(control.value)));
      control.addEventListener('change', () => persist('group-layout'));
    });
    document.querySelectorAll('[data-group-number]').forEach((control) => {
      control.addEventListener('change', () => {
        if (control.value === '') return;
        applyLayoutChange(state.selectedGroupId, control.dataset.groupNumber, Number(control.value));
        persist('group-layout');
      });
    });

    document.querySelector('#groupSelector').addEventListener('change', (event) => chooseGroup(event.target.value));
    document.querySelector('#archiveCurrent').addEventListener('click', () => {
      if (memoryEditor) {
        adminNotice('Save or cancel the open memory edit before archiving. / 保存前の編集を先に保存またはキャンセルしてください。');
        return;
      }
      if (!state.stories.length) return adminNotice('The current group is empty. / 現在のグループは空です。');
      if (!window.confirm('Archive the complete current group and start a new empty group in the center?\n現在の年輪グループ全体を保存し、中心に新しいグループを始めますか？')) return;
      const currentVisual = adminGroupLayouts.find((group) => group.id === state.currentGroupId);
      const fromScale = currentVisual ? currentVisual.scale : state.activeLayout.scale / 100;
      const fallback = MemoryState.DEFAULT_ARCHIVE_LAYOUTS[state.archives.length % MemoryState.DEFAULT_ARCHIVE_LAYOUTS.length];
      const archivedLayout = MemoryRings.layoutPages(state.stories, state.settings, { continuous: true })[0];
      const initialScale = Math.max(10, Math.min(fallback.scale, 15000 / Math.max(1, archivedLayout.maxRadius)));
      const archived = {
        id: state.currentGroupId,
        archivedAt: new Date().toISOString(),
        stories: JSON.parse(JSON.stringify(state.stories)),
        settings: JSON.parse(JSON.stringify(state.settings)),
        layout: Object.assign({}, fallback, { scale: initialScale, manual: true })
      };
      state.archives.push(archived);
      state.groupOrder = state.groupOrder.filter((id) => id !== archived.id).concat(archived.id);
      state.archiveDisplayIds = [archived.id].concat(state.archiveDisplayIds).slice(0, state.archiveDisplayLimit);
      state.stories = [];
      state.currentGroupId = MemoryState.uid();
      state.groupOrder.push(state.currentGroupId);
      state.activeLayout = { x: 0, y: -45, scale: 70, manual: true };
      state.selectedGroupId = state.currentGroupId;
      state.currentPage = 0;
      state.editor = { mode: 'defaults', selectedIds: [] };
      undoStack.length = 0;
      adminNotice('Group archived. The center is ready for a new memory. / グループを保存しました。中心に新しい思い出を追加できます。');
      persist('archive', undefined, archived.id, fromScale,
        currentVisual ? { x: currentVisual.x, y: currentVisual.y } : { x: state.activeLayout.x, y: state.activeLayout.y });
    });
    document.querySelector('#archiveDisplayLimit').addEventListener('input', (event) => {
      const previous = state.archiveDisplayLimit;
      state.archiveDisplayLimit = Number(event.target.value);
      if (state.archiveDisplayLimit > previous) {
        state.archives.slice().reverse().forEach((group) => {
          if (state.archiveDisplayIds.length < state.archiveDisplayLimit && !state.archiveDisplayIds.includes(group.id)) state.archiveDisplayIds.push(group.id);
        });
      }
      state.archiveDisplayIds = state.archiveDisplayIds.slice(0, state.archiveDisplayLimit);
      render();
      delayedPersist('archive-display');
    });
    document.querySelector('#archiveGroupList').addEventListener('click', (event) => {
      const button = event.target.closest('[data-select-group]');
      if (button) chooseGroup(button.dataset.selectGroup);
    });
    document.querySelector('#archiveGroupList').addEventListener('change', (event) => {
      const checkbox = event.target.closest('[data-archive-visible]');
      if (!checkbox) return;
      const id = checkbox.dataset.archiveVisible;
      state.archiveDisplayIds = state.archiveDisplayIds.filter((candidate) => candidate !== id);
      if (checkbox.checked) state.archiveDisplayIds.unshift(id);
      state.archiveDisplayIds = state.archiveDisplayIds.slice(0, state.archiveDisplayLimit);
      persist('archive-display');
    });

    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; count.textContent = input.value.length; });
    input.addEventListener('input', () => {
      count.textContent = input.value.length;
      formMessage.textContent = 'Your words will grow into one or more rings. / 言葉が一つ以上の年輪になります。';
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing && !composing) form.requestSubmit();
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (event.isComposing || composing) return;
      if (memoryEditor) {
        formMessage.textContent = 'Save or cancel the open edit first. / 編集中の思い出を先に保存またはキャンセルしてください。';
        return;
      }
      if (!input.value.trim()) {
        formMessage.textContent = 'Please write a memory first. / まず思い出を書いてください。';
        input.focus();
        return;
      }
      if (input.value.length > MemoryState.MAX_MEMORY_LENGTH) {
        formMessage.textContent = 'Please keep the memory within 2,000 characters. / 2,000文字以内で入力してください。';
        input.focus();
        return;
      }
      const story = {
        id: MemoryState.uid(), text: input.value, submittedAt: new Date().toISOString(), isDemo: false,
        style: MemoryState.cleanStyle(state.settings), gapBefore: state.settings.ringSpacing,
        flow: MemoryState.flowForNew(state.settings)
      };
      state.selectedGroupId = state.currentGroupId;
      state.editor = { mode: 'ring', selectedIds: [story.id] };
      rememberUndo({ kind: 'add', ids: [story.id] });
      state.stories.push(story);
      state.currentPage = MemoryRings.layoutPages(state.stories, state.settings).length - 1;
      input.value = '';
      count.textContent = '0';
      formMessage.textContent = 'Memory added. Its ring is growing. / 思い出の年輪が育っています。';
      persist('add', story.id);
    });

    document.querySelectorAll('[data-style-setting]').forEach((control) => {
      const update = () => {
        if (state.editor.mode === 'spacing') return;
        const key = control.dataset.styleSetting;
        const target = currentStyleTarget();
        target[key] = control.tagName === 'SELECT' ? control.value : Number(control.value);
        if (state.editor.mode === 'ring') ensureSelectionPage();
        render();
        delayedPersist('ring-style');
      };
      control.addEventListener('input', update);
      control.addEventListener('change', update);
    });

    document.querySelectorAll('[data-global-setting]').forEach((control) => {
      const update = () => {
        const key = control.dataset.globalSetting;
        const target = settingTarget(key);
        const value = control.type === 'checkbox'
          ? control.checked
          : control.tagName === 'SELECT' ? control.value : Number(control.value);
        if (key === 'autoTextFlowEnabled' && value !== target.autoTextFlowEnabled) {
          const flowNow = window.MemoryMotion ? MemoryMotion.clock(state.settings) : Date.now();
          if (value) {
            if (target.textFlowPausedAt !== null) {
              target.textFlowPauseAccumulated += Math.max(0, flowNow - target.textFlowPausedAt);
            }
            target.textFlowPausedAt = null;
          } else {
            target.textFlowPausedAt = flowNow;
          }
        }
        target[key] = value;
        clampPage();
        render();
        delayedPersist('global-settings');
      };
      control.addEventListener('input', update);
      control.addEventListener('change', update);
    });

    document.querySelectorAll('[data-flow-setting]').forEach((control) => {
      const update = () => {
        if (state.editor.mode !== 'ring') return;
        const story = storyById(state.editor.selectedIds[0]);
        if (!story) return;
        const key = control.dataset.flowSetting;
        if (key === 'mode') {
          story.flow.enabled = control.value !== 'still';
          if (story.flow.enabled) story.flow.direction = control.value;
        } else {
          story.flow[key] = control.type === 'checkbox'
            ? control.checked
            : control.tagName === 'SELECT' ? control.value : Number(control.value);
        }
        render();
        delayedPersist('text-flow');
      };
      control.addEventListener('input', update);
      control.addEventListener('change', update);
    });

    document.querySelector('#applyAllStyles').addEventListener('click', () => {
      const defaults = MemoryState.cleanStyle(selectedSettings());
      selectedStories().forEach((story) => { story.style = Object.assign({}, defaults); });
      ensureSelectionPage();
      adminNotice('Default style applied to every ring. / 初期スタイルをすべての年輪に適用しました。');
      persist('apply-all');
    });

    document.querySelector('#editDefaults').addEventListener('click', () => {
      state.editor = { mode: 'defaults', selectedIds: [] };
      persist('selection');
    });

    document.querySelector('#interactMode').addEventListener('click', () => {
      state.editor = { mode: 'interact', selectedIds: [] };
      adminNotice('Interaction enabled. Hover or drag near a ring. / 年輪の近くで動かすかドラッグしてください。');
      persist('selection');
    });

    document.querySelector('#applyFlowAll').addEventListener('click', () => {
      selectedStories().forEach((story) => {
        story.flow = MemoryState.cleanFlow({
          enabled: selectedSettings().autoTextFlowEnabled,
          direction: selectedSettings().globalFlowDirection,
          speed: selectedSettings().globalFlowSpeed
        });
      });
      adminNotice('Global text-flow settings applied to all rings. / 全年輪に文字流動設定を適用しました。');
      persist('apply-flow-all');
    });

    document.querySelector('#saveFlowDefault').addEventListener('click', () => {
      selectedSettings().newRingFlowEnabled = selectedSettings().autoTextFlowEnabled;
      selectedSettings().newRingFlowDirection = selectedSettings().globalFlowDirection;
      selectedSettings().newRingFlowSpeed = selectedSettings().globalFlowSpeed;
      adminNotice('Text flow saved as the default for new rings. / 新しい年輪の初期値として保存しました。');
      persist('flow-default');
    });

    document.querySelector('#chooseFlowRing').addEventListener('click', () => {
      if (!selectedStories().length) {
        adminNotice('Add a memory before selecting a ring. / 先に思い出を追加してください。');
        return;
      }
      const story = selectedStories()[selectedStories().length - 1];
      state.editor = { mode: 'ring', selectedIds: [story.id] };
      ensureSelectionPage();
      persist('selection');
    });

    document.querySelector('#pauseMotion').addEventListener('click', () => {
      const now = window.MemoryMotion ? MemoryMotion.now() : Date.now();
      if (state.settings.motionPausedAt === null) {
        state.settings.motionPausedAt = now;
        adminNotice('Motion paused. / 動きを停止しました。');
      } else {
        state.settings.motionPauseAccumulated += Math.max(0, now - state.settings.motionPausedAt);
        state.settings.motionPausedAt = null;
        adminNotice('Motion resumed. / 動きを再開しました。');
      }
      persist('motion-pause');
    });

    document.querySelector('#resetDeformation').addEventListener('click', () => {
      if (window.MemoryMotion) MemoryMotion.reset(true);
      adminNotice('Temporary deformation reset. Memories and settings are unchanged. / 一時的な変形をリセットしました。');
    });

    const ringList = document.querySelector('#ringList');
    ringList.addEventListener('input', (event) => {
      const editor = event.target.closest('[data-edit-story-id]');
      if (!editor || !memoryEditor || editor.dataset.editStoryId !== memoryEditor.id) return;
      memoryEditor.draft = editor.value;
      memoryEditor.selectionStart = editor.selectionStart;
      memoryEditor.selectionEnd = editor.selectionEnd;
      const counter = ringList.querySelector(`[data-edit-count="${CSS.escape(memoryEditor.id)}"]`);
      if (counter) counter.textContent = `${editor.value.length} / 2,000`;
      const message = ringList.querySelector(`[data-edit-message="${CSS.escape(memoryEditor.id)}"]`);
      if (message) message.textContent = 'Unsaved changes / 未保存の変更';
    });
    ringList.addEventListener('compositionstart', (event) => {
      if (event.target.closest('[data-edit-story-id]') && memoryEditor) memoryEditor.composing = true;
    });
    ringList.addEventListener('compositionend', (event) => {
      if (!event.target.closest('[data-edit-story-id]') || !memoryEditor) return;
      memoryEditor.composing = false;
      memoryEditor.draft = event.target.value;
    });
    ringList.addEventListener('submit', (event) => {
      const form = event.target.closest('[data-edit-form]');
      if (!form) return;
      event.preventDefault();
      event.stopPropagation();
      if (!memoryEditor || memoryEditor.id !== form.dataset.editForm || memoryEditor.composing || event.isComposing) return;
      const story = storyById(memoryEditor.id);
      const inputNode = form.querySelector('[data-edit-story-id]');
      const value = inputNode.value;
      const message = form.querySelector('[data-edit-message]');
      if (!value.trim()) {
        message.textContent = 'A memory cannot be blank. / 思い出を入力してください。';
        inputNode.focus();
        return;
      }
      if (value.length > MemoryState.MAX_MEMORY_LENGTH) {
        message.textContent = 'Maximum 2,000 characters. / 2,000文字以内です。';
        inputNode.focus();
        return;
      }
      if (story && story.text !== value) {
        rememberUndo({ kind: 'edit', id: story.id, text: story.text });
        story.text = value;
      }
      memoryEditor = null;
      adminNotice('Memory updated. Ring layout recalculated. / 思い出を保存し、年輪を再配置しました。');
      persist('edit');
    });
    ringList.addEventListener('click', (event) => {
      const action = event.target.closest('[data-memory-action]');
      if (action) {
        event.stopPropagation();
        const story = storyById(action.dataset.storyId);
        if (!story) return;
        if (action.dataset.memoryAction === 'edit') {
          memoryEditor = {
            id: story.id, draft: story.text, focused: true,
            selectionStart: story.text.length, selectionEnd: story.text.length, composing: false
          };
          renderRingList(pages());
          return;
        }
        if (action.dataset.memoryAction === 'cancel') {
          memoryEditor = null;
          renderRingList(pages());
          adminNotice('Editing cancelled. / 編集をキャンセルしました。');
          return;
        }
        if (action.dataset.memoryAction === 'delete') {
          const excerpt = summary(story.text);
          if (!window.confirm(`Delete “${excerpt}” and all of its rings?\n「${excerpt}」と関連する年輪を削除しますか？`)) return;
          const index = storyIndex(story.id);
          rememberUndo({ kind: 'delete', index, story: JSON.parse(JSON.stringify(story)) });
          selectedStories().splice(index, 1);
          if (state.editor.selectedIds.includes(story.id)) state.editor = { mode: 'defaults', selectedIds: [] };
          memoryEditor = null;
          adminNotice(`Memory deleted: “${excerpt}” / 思い出を削除しました。`);
          persist('delete');
          return;
        }
        if (action.dataset.memoryAction === 'save') return;
      }
      const gap = event.target.closest('[data-inner-id][data-outer-id]');
      if (gap && !gap.disabled) {
        state.editor = { mode: 'spacing', selectedIds: [gap.dataset.innerId, gap.dataset.outerId] };
        ensureSelectionPage();
        persist('selection');
        return;
      }
      const ring = event.target.closest('[data-ring-select]');
      if (ring) {
        state.editor = { mode: 'ring', selectedIds: [ring.dataset.storyId] };
        ensureSelectionPage();
        persist('selection');
      }
    });

    adminCanvas.addEventListener('click', (event) => {
      if (state.editor.mode === 'interact') return;
      const target = event.target.closest('[data-story-id]');
      if (target) {
        const group = target.closest('[data-group-id]');
        if (group && group.dataset.groupId !== state.selectedGroupId) {
          if (memoryEditor) return adminNotice('Save or cancel the open edit first. / 編集を先に保存またはキャンセルしてください。');
          state.selectedGroupId = group.dataset.groupId;
        }
        selectRing(target.dataset.storyId);
      }
    });

    document.querySelector('#gapControl').addEventListener('input', (event) => {
      const pair = selectedPair();
      if (!pair) return;
      pair.outer.gapBefore = Math.max(18, Number(event.target.value));
      document.querySelector('#gapOutput').value = `${pair.outer.gapBefore}px`;
      ensureSelectionPage();
      render();
      delayedPersist('ring-gap');
    });

    document.querySelector('#openProjection').addEventListener('click', () => {
      const url = new URL(location.href);
      url.searchParams.set('view', 'projection');
      window.open(url.href, 'memory-rings-projection');
    });
    document.querySelector('#previousPage').addEventListener('click', () => { state.currentPage -= 1; persist('page'); });
    document.querySelector('#nextPage').addEventListener('click', () => { state.currentPage += 1; persist('page'); });
    document.querySelector('#undoStory').addEventListener('click', () => {
      const operation = undoStack.pop();
      if (operation && operation.groupId !== state.selectedGroupId) {
        state.selectedGroupId = operation.groupId;
        state.editor = { mode: 'defaults', selectedIds: [] };
      }
      if (!operation) {
        const removed = selectedStories().pop();
        if (!removed) return;
      } else if (operation.kind === 'edit') {
        const story = storyById(operation.id);
        if (story) story.text = operation.text;
      } else if (operation.kind === 'delete') {
        selectedStories().splice(Math.min(operation.index, selectedStories().length), 0, operation.story);
      } else if (operation.kind === 'add') {
        const ids = new Set(operation.ids);
        replaceSelectedStories(selectedStories().filter((story) => !ids.has(story.id)));
      } else if (operation.kind === 'remove') {
        operation.items.forEach((item) => selectedStories().splice(Math.min(item.index, selectedStories().length), 0, item.story));
      }
      memoryEditor = null;
      state.editor = { mode: 'defaults', selectedIds: [] };
      adminNotice('Last memory change undone. / 直前の変更を取り消しました。');
      persist('undo');
    });
    document.querySelector('#loadDemo').addEventListener('click', () => {
      if (memoryEditor) return adminNotice('Save or cancel the open edit first. / 編集を先に保存またはキャンセルしてください。');
      state.selectedGroupId = state.currentGroupId;
      const existing = new Set(state.stories.filter((story) => story.isDemo).map((story) => story.text));
      const added = [];
      MemoryState.DEMO_TEXTS.forEach((text) => {
        if (!existing.has(text)) {
          const story = {
            id: MemoryState.uid(), text, submittedAt: new Date().toISOString(), isDemo: true,
            style: MemoryState.cleanStyle(state.settings), gapBefore: state.settings.ringSpacing,
            flow: MemoryState.flowForNew(state.settings)
          };
          state.stories.push(story);
          added.push(story);
        }
      });
      if (added.length) {
        rememberUndo({ kind: 'add', ids: added.map((story) => story.id) });
        state.editor = { mode: 'ring', selectedIds: [added[added.length - 1].id] };
        state.currentPage = pageCount() - 1;
      }
      adminNotice(added.length ? `${added.length} labeled examples loaded. / ${added.length}件の例を追加しました。` : 'Examples already loaded. / 例はすでにあります。');
      persist('demo', added.length ? added[added.length - 1].id : undefined);
    });
    document.querySelector('#removeDemo').addEventListener('click', () => {
      const before = selectedStories().length;
      const removed = selectedStories().map((story, index) => ({ story, index })).filter((item) => item.story.isDemo);
      if (removed.length) rememberUndo({ kind: 'remove', items: JSON.parse(JSON.stringify(removed)) });
      replaceSelectedStories(selectedStories().filter((story) => !story.isDemo));
      state.editor = { mode: 'defaults', selectedIds: [] };
      adminNotice(`${before - selectedStories().length} examples removed. / 例を削除しました。`);
      persist('remove-demo');
    });
    document.querySelector('#clearAll').addEventListener('click', () => {
      const total = state.stories.length + state.archives.reduce((sum, group) => sum + group.stories.length, 0);
      if (!total) return adminNotice('There are no memories to clear. / 削除する思い出はありません。');
      if (window.confirm(`Clear all ${total} memories in every group and all archives? This cannot be undone.\nすべてのグループと保存済みの思い出、計${total}件を削除しますか？元に戻せません。`)) {
        state.stories = [];
        state.archives = [];
        state.archiveDisplayIds = [];
        state.groupOrder = [state.currentGroupId];
        state.selectedGroupId = state.currentGroupId;
        undoStack.length = 0;
        memoryEditor = null;
        state.editor = { mode: 'defaults', selectedIds: [] };
        state.currentPage = 0;
        persist('clear');
        adminNotice('All memories cleared. / すべての思い出を削除しました。');
      }
    });
    document.querySelector('#exportData').addEventListener('click', () => {
      const payload = {
        format: 'memory-rings', version: 6, exportedAt: new Date().toISOString(),
        stories: state.stories, settings: state.settings, editor: state.editor, currentPage: state.currentPage,
        archives: state.archives, currentGroupId: state.currentGroupId,
        selectedGroupId: state.selectedGroupId, activeLayout: state.activeLayout,
        archiveDisplayLimit: state.archiveDisplayLimit,
        archiveDisplayIds: state.archiveDisplayIds, groupOrder: state.groupOrder,
        groupDisplayMode: state.groupDisplayMode
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `memory-rings-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      adminNotice('JSON exported. / JSONを書き出しました。');
    });
    const fileInput = document.querySelector('#importFile');
    document.querySelector('#importData').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        if (!parsed || !Array.isArray(parsed.stories)) throw new Error('missing stories array');
        const importedArchives = Array.isArray(parsed.archives) ? parsed.archives : [];
        const allImportedStories = parsed.stories.concat(importedArchives.flatMap((group) => group && Array.isArray(group.stories) ? group.stories : []));
        const overlong = allImportedStories.find((story) => story && typeof story.text === 'string' && story.text.length > MemoryState.MAX_MEMORY_LENGTH);
        if (overlong) throw new Error('a memory exceeds the 2,000-character limit / 2,000文字を超える思い出があります');
        state = MemoryState.normalise(parsed);
        undoStack.length = 0;
        memoryEditor = null;
        persist('import');
        adminNotice(`${state.stories.length + state.archives.reduce((sum, group) => sum + group.stories.length, 0)} memories and groups imported. / 思い出とグループを読み込みました。`);
      } catch (error) {
        adminNotice(`Import failed: ${error.message} / 読み込みに失敗しました。`);
      }
      fileInput.value = '';
    });
  }

  if (!projectionMode) setupControls();
  render();

  if (channel) {
    channel.addEventListener('message', (event) => {
      if (!event.data) return;
      if (event.data.type === 'group-display') {
        state.groupDisplayMode = event.data.mode === 'overlap' ? 'overlap' : 'layered';
        syncGroupDisplayMode();
        return;
      }
      if (event.data.type === 'layout-preview') {
        const { id, placement, layout } = event.data;
        const target = id === state.currentGroupId ? state.activeLayout : state.archives.find((group) => group.id === id)?.layout;
        if (target && placement && layout) {
          Object.assign(target, layout);
          MemoryRings.applyGroupLayout(projectionCanvas, id, placement);
          if (!projectionMode) MemoryRings.applyGroupLayout(adminCanvas, id, placement);
        }
        return;
      }
      if (event.data.type === 'motion') {
        const motion = event.data.motion;
        if (motion && motion.kind === 'request') {
          const snapshot = window.MemoryMotion && MemoryMotion.snapshot();
          if (snapshot) channel.postMessage({ type: 'motion', motion: snapshot });
        } else if (window.MemoryMotion) {
          MemoryMotion.receive(motion);
        }
        return;
      }
      if (event.data.type !== 'state') return;
      state = MemoryState.normalise(event.data.state);
      const animate = event.data.action === 'add' || event.data.action === 'demo' ? event.data.animateId : undefined;
      render(animate, event.data.archiveTransitionId, event.data.archiveFromScale, event.data.archiveOrigin);
    });
    channel.postMessage({ type: 'motion', motion: { kind: 'request' } });
  }
  window.addEventListener('storage', (event) => {
    if (event.key !== MemoryState.STORAGE_KEY) return;
    try {
      const before = JSON.parse(event.oldValue);
      const after = JSON.parse(event.newValue);
      if (before && after && before.groupDisplayMode !== after.groupDisplayMode) {
        delete before.groupDisplayMode;
        delete after.groupDisplayMode;
        if (JSON.stringify(before) === JSON.stringify(after)) {
          state.groupDisplayMode = MemoryState.load().groupDisplayMode;
          syncGroupDisplayMode();
          return;
        }
      }
    } catch (_) { /* Other storage changes use the normal render path. */ }
    state = MemoryState.load();
    render();
  });
}());
