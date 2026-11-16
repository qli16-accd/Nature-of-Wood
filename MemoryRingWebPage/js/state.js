(function () {
  'use strict';

  const STORAGE_KEY = 'memory-rings-state-v1';
  const MAX_MEMORY_LENGTH = 2000;
  const DEFAULT_ARCHIVE_DISPLAY_LIMIT = 2;
  const DEFAULT_ARCHIVE_LAYOUTS = Object.freeze([
    { x: -425, y: 150, scale: 52 },
    { x: 425, y: 150, scale: 52 },
    { x: -425, y: -150, scale: 45 },
    { x: 425, y: -150, scale: 45 }
  ]);
  const DEFAULT_STYLE = Object.freeze({
    fontStyle: 'serif', fontSize: 22, fontWeight: 400, letterSpacing: 1.5, widthScale: 100
  });
  const SETTINGS = Object.freeze(Object.assign({}, DEFAULT_STYLE, {
    ringSpacing: 26, revealSpeed: 12, compositionScale: 100,
    offsetX: 0, offsetY: 0, ringsPerPage: 8, showSelectionProjection: false,
    autoMotionEnabled: true, motionAmplitude: 0.5, motionPeriod: 16,
    dragStrength: 5, dragRange: 110, returnTime: 8,
    hoverStrength: 1, cursorSize: 24,
    autoTextFlowEnabled: true, globalFlowDirection: 'clockwise', globalFlowSpeed: 0.5,
    newRingFlowEnabled: true, newRingFlowDirection: 'clockwise', newRingFlowSpeed: 0.5,
    motionPausedAt: null, motionPauseAccumulated: 0,
    textFlowPausedAt: null, textFlowPauseAccumulated: 0,
    groupInteractionEnabled: false, groupInfluenceDistance: 90, groupDeformationStrength: 8,
    pointerInteractionEnabled: false
  }));
  const DEMO_TEXTS = Object.freeze([
    '小学时，校园里有一棵很大的老树。后来学校搬走了，但我一直记得它。',
    '子どものころ、祖母の庭にある二本の木の間で、ハンモックに揺られていました。',
    'I remember sitting beneath a tree at sunset, listening to the leaves.'
  ]);

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
  }

  function clamp(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }

  function cleanStyle(value, fallback) {
    const source = value && typeof value === 'object' ? value : {};
    const base = fallback || DEFAULT_STYLE;
    return {
      fontStyle: source.fontStyle === 'sans' ? 'sans' : (source.fontStyle === 'serif' ? 'serif' : base.fontStyle),
      fontSize: clamp(source.fontSize, 14, 40, base.fontSize),
      fontWeight: clamp(source.fontWeight, 300, 700, base.fontWeight),
      letterSpacing: clamp(source.letterSpacing, -1, 8, base.letterSpacing),
      widthScale: clamp(source.widthScale, 75, 130, base.widthScale)
    };
  }

  function cleanSettings(value, legacyVersion) {
    const incoming = value && typeof value === 'object' ? value : {};
    const style = cleanStyle(incoming, DEFAULT_STYLE);
    const legacyGap = legacyVersion < 2 && Number.isFinite(Number(incoming.ringSpacing))
      ? Number(incoming.ringSpacing) - style.fontSize
      : incoming.ringSpacing;
    return Object.assign({}, style, {
      ringSpacing: clamp(legacyGap, 18, 100, SETTINGS.ringSpacing),
      revealSpeed: clamp(incoming.revealSpeed, 4, 30, SETTINGS.revealSpeed),
      compositionScale: clamp(incoming.compositionScale, 55, 145, SETTINGS.compositionScale),
      offsetX: clamp(incoming.offsetX, -35, 35, SETTINGS.offsetX),
      offsetY: clamp(incoming.offsetY, -35, 35, SETTINGS.offsetY),
      ringsPerPage: [6, 8, 10, 12].includes(Number(incoming.ringsPerPage)) ? Number(incoming.ringsPerPage) : SETTINGS.ringsPerPage,
      showSelectionProjection: Boolean(incoming.showSelectionProjection),
      autoMotionEnabled: incoming.autoMotionEnabled === undefined ? SETTINGS.autoMotionEnabled : Boolean(incoming.autoMotionEnabled),
      motionAmplitude: clamp(incoming.motionAmplitude, 0, 1.2, SETTINGS.motionAmplitude),
      motionPeriod: clamp(incoming.motionPeriod, 12, 30, SETTINGS.motionPeriod),
      dragStrength: clamp(incoming.dragStrength, 0.5, 10, SETTINGS.dragStrength),
      dragRange: clamp(incoming.dragRange, 40, 220, SETTINGS.dragRange),
      returnTime: clamp(incoming.returnTime, 2, 15, SETTINGS.returnTime),
      hoverStrength: clamp(incoming.hoverStrength, 0, 3, SETTINGS.hoverStrength),
      cursorSize: clamp(incoming.cursorSize, 14, 42, SETTINGS.cursorSize),
      autoTextFlowEnabled: incoming.autoTextFlowEnabled === undefined ? SETTINGS.autoTextFlowEnabled : Boolean(incoming.autoTextFlowEnabled),
      globalFlowDirection: incoming.globalFlowDirection === 'counterclockwise' ? 'counterclockwise' : 'clockwise',
      globalFlowSpeed: Number(incoming.globalFlowSpeed) === 0 ? SETTINGS.globalFlowSpeed : clamp(incoming.globalFlowSpeed, 0.1, 2, SETTINGS.globalFlowSpeed),
      newRingFlowEnabled: incoming.newRingFlowEnabled === undefined ? SETTINGS.newRingFlowEnabled : Boolean(incoming.newRingFlowEnabled),
      newRingFlowDirection: incoming.newRingFlowDirection === 'counterclockwise' ? 'counterclockwise' : 'clockwise',
      newRingFlowSpeed: clamp(incoming.newRingFlowSpeed, 0.1, 2, SETTINGS.newRingFlowSpeed),
      motionPausedAt: incoming.motionPausedAt === null || incoming.motionPausedAt === undefined
        ? null
        : (Number.isFinite(Number(incoming.motionPausedAt)) ? Number(incoming.motionPausedAt) : null),
      motionPauseAccumulated: Math.max(0, Number(incoming.motionPauseAccumulated) || 0),
      textFlowPausedAt: incoming.textFlowPausedAt === null || incoming.textFlowPausedAt === undefined
        ? null
        : (Number.isFinite(Number(incoming.textFlowPausedAt)) ? Number(incoming.textFlowPausedAt) : null),
      textFlowPauseAccumulated: Math.max(0, Number(incoming.textFlowPauseAccumulated) || 0),
      groupInteractionEnabled: legacyVersion < 6 ? false : (incoming.groupInteractionEnabled === undefined ? false : Boolean(incoming.groupInteractionEnabled)),
      pointerInteractionEnabled: incoming.pointerInteractionEnabled === undefined ? false : Boolean(incoming.pointerInteractionEnabled),
      groupInfluenceDistance: clamp(incoming.groupInfluenceDistance, 20, 240, SETTINGS.groupInfluenceDistance),
      groupDeformationStrength: clamp(incoming.groupDeformationStrength, 0, 30, SETTINGS.groupDeformationStrength)
    });
  }

  function cleanFlow(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      enabled: Boolean(source.enabled),
      direction: source.direction === 'counterclockwise' ? 'counterclockwise' : 'clockwise',
      speed: clamp(source.speed, 0.1, 2, 0.5)
    };
  }

  function flowForNew(settings) {
    const source = settings || SETTINGS;
    return cleanFlow({
      enabled: true,
      direction: 'clockwise',
      speed: Number(source.globalFlowSpeed) > 0 ? source.globalFlowSpeed : SETTINGS.globalFlowSpeed
    });
  }

  function cleanStory(raw, defaultStyle, defaultGap) {
    if (!raw || typeof raw.text !== 'string' || !raw.text.trim()) return null;
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
      text: raw.text,
      submittedAt: Number.isFinite(Date.parse(raw.submittedAt)) ? new Date(raw.submittedAt).toISOString() : new Date().toISOString(),
      isDemo: Boolean(raw.isDemo),
      style: cleanStyle(raw.style, defaultStyle),
      gapBefore: clamp(raw.gapBefore, 18, 100, defaultGap),
      flow: cleanFlow(raw.flow)
    };
  }

  function cleanEditor(value, stories) {
    const source = value && typeof value === 'object' ? value : {};
    const validIds = new Set(stories.map((story) => story.id));
    const selectedIds = Array.isArray(source.selectedIds)
      ? source.selectedIds.filter((id, index, all) => validIds.has(id) && all.indexOf(id) === index).slice(0, 2)
      : [];
    return {
      mode: ['defaults', 'ring', 'spacing', 'interact', 'layout'].includes(source.mode) ? source.mode : 'defaults',
      selectedIds
    };
  }

  function cleanGroupLayout(raw, fallback) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      x: clamp(source.x, -600, 600, fallback.x),
      y: clamp(source.y, -400, 400, fallback.y),
      scale: clamp(source.scale, 10, 180, fallback.scale),
      manual: source.manual === undefined ? fallback.manual : Boolean(source.manual)
    };
  }

  function cleanArchive(raw, index, fallbackSettings) {
    if (!raw || typeof raw !== 'object') return null;
    const settings = cleanSettings(raw.settings || fallbackSettings, 6);
    const stories = Array.isArray(raw.stories)
      ? raw.stories.map((story) => cleanStory(story, settings, settings.ringSpacing)).filter(Boolean)
      : [];
    const fallback = DEFAULT_ARCHIVE_LAYOUTS[index % DEFAULT_ARCHIVE_LAYOUTS.length];
    const layout = raw.layout && typeof raw.layout === 'object' ? raw.layout : {};
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
      archivedAt: Number.isFinite(Date.parse(raw.archivedAt)) ? new Date(raw.archivedAt).toISOString() : new Date().toISOString(),
      stories, settings,
      layout: cleanGroupLayout(layout, Object.assign({ manual: true }, fallback))
    };
  }

  function normalise(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const legacyVersion = Number(source.version) || 1;
    const settings = cleanSettings(source.settings, legacyVersion);
    const defaultStyle = cleanStyle(settings, DEFAULT_STYLE);
    const stories = Array.isArray(source.stories)
      ? source.stories.map((story) => cleanStory(story, defaultStyle, settings.ringSpacing)).filter(Boolean)
      : [];
    if (source.settings && source.settings.autoTextFlowEnabled === undefined) {
      settings.autoTextFlowEnabled = stories.some((story) => story.flow.enabled);
    }
    const archives = Array.isArray(source.archives)
      ? source.archives.map((archive, index) => cleanArchive(archive, index, settings)).filter(Boolean)
      : [];
    const currentGroupId = typeof source.currentGroupId === 'string' && source.currentGroupId
      ? source.currentGroupId : uid();
    const selectedGroupId = source.selectedGroupId === currentGroupId || archives.some((group) => group.id === source.selectedGroupId)
      ? source.selectedGroupId : currentGroupId;
    const archiveDisplayLimit = clamp(source.archiveDisplayLimit, 0, 4, DEFAULT_ARCHIVE_DISPLAY_LIMIT);
    const validArchiveIds = new Set(archives.map((group) => group.id));
    const archiveDisplayIds = Array.isArray(source.archiveDisplayIds)
      ? source.archiveDisplayIds.filter((id, index, all) => validArchiveIds.has(id) && all.indexOf(id) === index).slice(0, archiveDisplayLimit)
      : (archiveDisplayLimit ? archives.slice(-archiveDisplayLimit).reverse().map((group) => group.id) : []);
    const selectedStories = selectedGroupId === currentGroupId
      ? stories : archives.find((group) => group.id === selectedGroupId).stories;
    const activeLayout = cleanGroupLayout(source.activeLayout, archives.length
      ? { x: 0, y: -45, scale: 70, manual: false }
      : { x: 0, y: 0, scale: 100, manual: false });
    const groupIds = archives.map((group) => group.id).concat(currentGroupId);
    const ordered = Array.isArray(source.groupOrder) ? source.groupOrder.filter((id, index, all) => groupIds.includes(id) && all.indexOf(id) === index) : [];
    const groupOrder = groupIds.filter((id) => !ordered.includes(id)).concat(ordered);
    return {
      version: 6,
      stories,
      settings,
      archives, currentGroupId, selectedGroupId, archiveDisplayLimit, archiveDisplayIds, activeLayout, groupOrder,
      groupDisplayMode: source.groupDisplayMode === 'overlap' ? 'overlap' : 'layered',
      editor: cleanEditor(source.editor, selectedStories),
      currentPage: Math.max(0, Math.floor(Number(source.currentPage) || 0)),
      archivePages: source.archivePages && typeof source.archivePages === 'object' ? source.archivePages : {}
    };
  }

  function load() {
    try { return normalise(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
    catch (_) { return normalise(); }
  }

  function save(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalise(state)));
  }

  window.MemoryState = {
    STORAGE_KEY, MAX_MEMORY_LENGTH, DEFAULT_STYLE, SETTINGS, DEMO_TEXTS, uid,
    normalise, load, save, cleanStory, cleanStyle, cleanFlow, flowForNew, DEFAULT_ARCHIVE_LAYOUTS
  };
}());
