(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XLINK_NS = 'http://www.w3.org/1999/xlink';
  const FONT_STACKS = {
    serif: '"Noto Serif CJK SC", "Noto Serif CJK JP", "Source Han Serif SC", "Source Han Serif JP", "Songti SC", SimSun, "Yu Mincho", "Hiragino Mincho ProN", Georgia, serif',
    sans: 'Inter, "Noto Sans CJK SC", "Noto Sans CJK JP", "Source Han Sans SC", "Source Han Sans JP", "Microsoft YaHei UI", "Yu Gothic UI", Meiryo, Arial, sans-serif'
  };
  const SEPARATOR = ' · ';
  let measureCanvas;
  const widthCache = new Map();
  const geometryCache = new Map();
  function remember(cache, key, create) {
    if (cache.has(key)) return cache.get(key);
    const value = create();
    if (cache.size > 8000) cache.clear();
    cache.set(key, value);
    return value;
  }
  function baseGeometry(key, radius, spacing) {
    return remember(geometryCache, `${key}|${radius}|${spacing}`, () => MemoryGeometry.closedRingGeometry(key, radius, spacing));
  }

  function element(name, attrs) {
    const node = document.createElementNS(SVG_NS, name);
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  }

  function cleanText(text) {
    return text.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ');
  }

  function fontAttributes(style) {
    return {
      'font-size': style.fontSize,
      'font-weight': style.fontWeight,
      'font-family': FONT_STACKS[style.fontStyle],
      'letter-spacing': style.letterSpacing
    };
  }

  function approximateWidth(text, style) {
    measureCanvas = measureCanvas || document.createElement('canvas');
    const context = measureCanvas.getContext('2d');
    context.font = `${style.fontWeight} ${style.fontSize}px ${FONT_STACKS[style.fontStyle]}`;
    return (context.measureText(text).width + Math.max(0, Array.from(text).length - 1) * style.letterSpacing) * style.widthScale / 100;
  }

  function renderedWidth(svg, text, style) {
    if (!text) return 0;
    const cacheKey = JSON.stringify([text, style.fontStyle, style.fontSize, style.fontWeight, style.letterSpacing, style.widthScale]);
    return remember(widthCache, cacheKey, () => measureRenderedWidth(svg, text, style));
  }

  function measureRenderedWidth(svg, text, style) {
    const probe = element('text', Object.assign({ x: -5000, y: -5000, visibility: 'hidden' }, fontAttributes(style)));
    probe.textContent = text;
    svg.append(probe);
    let width;
    try { width = probe.getComputedTextLength(); }
    catch (_) { width = approximateWidth(text, Object.assign({}, style, { widthScale: 100 })); }
    probe.remove();
    if (!Number.isFinite(width) || width <= 0) width = approximateWidth(text, Object.assign({}, style, { widthScale: 100 }));
    return width * style.widthScale / 100;
  }

  function graphemeClusters(text) {
    if (window.Intl && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), (part) => part.segment);
    }
    return Array.from(text);
  }

  function flowingGlyphLayout(svg, raw, pathLength, style) {
    const clean = cleanText(raw);
    const cycleText = clean + SEPARATOR;
    const clusters = graphemeClusters(cycleText);
    const measurementStyle = Object.assign({}, style, { letterSpacing: 0 });
    const units = clusters.map((glyph) => ({
      glyph,
      advance: Math.max(.1, renderedWidth(svg, glyph, measurementStyle) + style.letterSpacing)
    }));
    const cycleWidth = units.reduce((total, unit) => total + unit.advance, 0);
    const repetitions = Math.max(1, Math.round(pathLength / Math.max(1, cycleWidth)));
    const rawLoopWidth = Math.max(1, cycleWidth * repetitions);
    const advanceScale = pathLength / rawLoopWidth;
    const glyphs = [];
    let cursor = 0;

    for (let repetition = 0; repetition < repetitions; repetition += 1) {
      units.forEach((unit) => {
        const scaledAdvance = unit.advance * advanceScale;
        glyphs.push({
          glyph: unit.glyph,
          offset: (cursor + scaledAdvance / 2) / pathLength
        });
        cursor += scaledAdvance;
      });
    }

    return {
      clean, glyphs, repetitions, cycleWidth,
      loopLength: pathLength,
      advanceScale,
      averageCharacterWidth: renderedWidth(svg, clean, style) / Math.max(1, graphemeClusters(clean).length)
    };
  }

  function partialTextToFit(svg, raw, style, maximumWidth) {
    const characters = Array.from(raw);
    let low = 0;
    let high = characters.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (renderedWidth(svg, characters.slice(0, middle).join(''), style) <= maximumWidth) low = middle;
      else high = middle - 1;
    }
    return characters.slice(0, low).join('');
  }

  function displayText(svg, raw, pathLength, style, flowEnabled) {
    const clean = cleanText(raw);
    const seamGap = Math.max(14, style.fontSize * .9);
    const target = Math.max(1, pathLength - seamGap);
    const baseWidth = renderedWidth(svg, clean, style);
    const separatorWidth = renderedWidth(svg, SEPARATOR, style);
    const cycleWidth = baseWidth + separatorWidth;
    const averageCharacterWidth = baseWidth / Math.max(1, Array.from(clean).length);
    if (flowEnabled && baseWidth > 0) {
      const repetitions = Math.max(3, Math.ceil((pathLength + cycleWidth * 2) / cycleWidth));
      const text = Array(repetitions).fill(clean).join(SEPARATOR);
      return {
        text, width: renderedWidth(svg, text, style), seamGap,
        repetitions, cycleWidth, averageCharacterWidth
      };
    }
    if (!baseWidth || baseWidth >= target) {
      return { text: clean, width: Math.min(baseWidth, target), seamGap, repetitions: 1, cycleWidth, averageCharacterWidth };
    }

    let text = clean;
    let width = baseWidth;
    let repetitions = 1;
    while (width + separatorWidth + baseWidth <= target) {
      text += SEPARATOR + clean;
      width += separatorWidth + baseWidth;
      repetitions += 1;
    }

    const remainder = target - width - separatorWidth;
    if (remainder > renderedWidth(svg, Array.from(clean)[0] || '', style)) {
      const partial = partialTextToFit(svg, clean, style, remainder);
      if (partial) {
        text += SEPARATOR + partial;
        width += separatorWidth + renderedWidth(svg, partial, style);
      }
    }
    return { text, width, seamGap, repetitions, cycleWidth, averageCharacterWidth };
  }

  function splitTextToWidth(raw, style, maximumWidth) {
    const characters = graphemeClusters(raw);
    if (approximateWidth(raw, style) <= maximumWidth) return { text: raw, rest: '' };
    let low = 1;
    let high = characters.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (approximateWidth(characters.slice(0, middle).join(''), style) <= maximumWidth) low = middle;
      else high = middle - 1;
    }
    let end = Math.max(1, low);
    const preferredMinimum = Math.max(1, Math.floor(end * .68));
    for (let index = end; index >= preferredMinimum; index -= 1) {
      if (/\s|[,.!?;:，。！？；、]/u.test(characters[index - 1])) {
        end = index;
        break;
      }
    }
    const text = characters.slice(0, end).join('');
    const rest = characters.slice(end).join('');
    return { text: text || characters[0], rest };
  }

  function layoutPages(stories, settings, options) {
    const continuous = Boolean(options && options.continuous);
    const maximumRadius = continuous ? Infinity : 520;
    const pages = [];
    let page = { items: [], maxRadius: 0, maxFontSize: 14 };
    let globalIndex = 0;

    function finishPage() {
      if (page.items.length) pages.push(page);
      page = { items: [], maxRadius: 0, maxFontSize: 14 };
    }

    stories.forEach((story, storyIndex) => {
      const style = story.style || MemoryState.cleanStyle(settings);
      const minimumInnerRadius = Math.max(76, style.fontSize * 3.25);
      let remaining = cleanText(story.text);
      let segmentIndex = 0;

      while (remaining) {
        if (!continuous && page.items.length >= settings.ringsPerPage) finishPage();
        let previous = page.items[page.items.length - 1];
        const continuationGap = Math.max(18, Math.min(settings.ringSpacing, story.gapBefore));
        const clearGap = segmentIndex === 0 ? story.gapBefore : continuationGap;
        let radius = previous
          ? previous.radius + previous.style.fontSize / 2 + style.fontSize / 2 + clearGap
          : minimumInnerRadius;
        if (radius > maximumRadius && page.items.length) {
          finishPage();
          previous = null;
          radius = minimumInnerRadius;
        }

        const seamGap = Math.max(14, style.fontSize * .9);
        const capacity = Math.max(style.fontSize * 4, MemoryGeometry.circumference(radius) * .88 - seamGap);
        const segment = splitTextToWidth(remaining, style, capacity);
        const ringId = `${story.id}--${segmentIndex}`;
        page.items.push({
          story, storyIndex, style, radius, globalIndex, ringId,
          segmentIndex, displayText: segment.text,
          gapBefore: previous ? clearGap : 0
        });
        page.maxRadius = radius;
        page.maxFontSize = Math.max(page.maxFontSize, style.fontSize);
        globalIndex += 1;
        segmentIndex += 1;
        remaining = segment.rest;
      }
    });
    if (page.items.length || !pages.length) pages.push(page);
    return pages;
  }

  function render(canvas, state, options) {
    const composition = canvas.querySelector('.composition') || canvas.querySelector('#composition') || canvas;
    canvas.classList.toggle('is-overlap-mode', state.groupDisplayMode === 'overlap');
    composition.replaceChildren();
    const settings = state.settings;
    const selectedArchive = options && options.admin && state.archives && state.archives.find((group) => group.id === state.selectedGroupId);
    const selectedStories = selectedArchive ? selectedArchive.stories : state.stories;
    const selectedSettings = selectedArchive ? selectedArchive.settings : settings;
    const pages = layoutPages(selectedStories, selectedSettings, selectedArchive ? { continuous: true } : undefined);
    const totalPages = pages.length;
    const pageIndex = selectedArchive ? 0 : Math.min(Math.max(0, state.currentPage), totalPages - 1);
    const layout = pages[pageIndex];
    const activePages = selectedArchive ? layoutPages(state.stories, settings) : pages;
    const activeLayout = activePages[Math.min(state.currentPage, activePages.length - 1)];
    const visibleArchives = (state.archiveDisplayIds || []).map((id) => (state.archives || []).find((group) => group.id === id)).filter(Boolean);
    const autoFit = activeLayout.maxRadius ? Math.min(1, (372 - activeLayout.maxFontSize * .7) / activeLayout.maxRadius) : 1;
    const scale = settings.compositionScale / 100;
    composition.setAttribute('transform', `translate(${settings.offsetX * 6} ${settings.offsetY * 4}) translate(600 400) scale(${scale}) translate(-600 -400)`);

    const showGuides = Boolean(options && options.admin) || Boolean(settings.showSelectionProjection);
    const selected = showGuides ? new Set((state.editor && state.editor.selectedIds) || []) : new Set();

    const motionItems = [];
    const groupLayouts = [];
    const activePlacement = state.activeLayout || { x: 0, y: 0, scale: 100, manual: false };
    const activeScale = activePlacement.scale / 100 * (activePlacement.manual ? 1 : autoFit);
    groupLayouts.push({ id: state.currentGroupId, x: activePlacement.x, y: activePlacement.y,
      scale: activeScale, layout: activeLayout, settings, archived: false });
    visibleArchives.forEach((group) => {
      const archivedLayout = layoutPages(group.stories, group.settings, { continuous: true })[0];
      groupLayouts.push({ id: group.id, x: group.layout.x, y: group.layout.y,
        scale: group.layout.scale / 100,
        layout: archivedLayout, settings: group.settings, archived: true });
    });
    const order = state.groupOrder || [];
    groupLayouts.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    groupLayouts.forEach((group) => {
      const layer = element('g', { class: `memory-group${group.archived ? ' is-archived' : ' is-current'}`, 'data-group-id': group.id });
      const destination = groupTransform(group);
      if (group.id === (options && options.archiveTransitionId)) {
        const fromScale = Number(options.archiveFromScale) || 1;
        const from = options.archiveOrigin || { x: 0, y: 0 };
        layer.setAttribute('transform', groupTransform({ x: from.x, y: from.y, scale: fromScale }));
        layer.style.transition = 'transform 3.2s cubic-bezier(.2,.7,.2,1), opacity 3.2s ease';
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (layer.isConnected) layer.setAttribute('transform', destination);
        }));
      } else layer.setAttribute('transform', destination);
      composition.append(layer);
      const outer = group.layout.items[group.layout.items.length - 1];
      if (outer) {
        const maskGeometry = baseGeometry(`${outer.globalIndex}-${outer.ringId}`, outer.radius + outer.style.fontSize * .72,
          Math.max(32, outer.gapBefore + outer.style.fontSize));
        layer.append(element('path', { class: 'group-occlusion', d: maskGeometry.d, fill: '#000', 'pointer-events': 'none', 'aria-hidden': 'true' }));
      }
      group.layout.items.forEach((item) => {
      const story = item.story;
      const style = item.style;
      const safeId = `${group.id}-${item.ringId}`.replace(/[^a-zA-Z0-9_-]/g, '');
      const pathId = `${canvas.id || 'canvas'}-path-${safeId}`;
      const clipId = `${canvas.id || 'canvas'}-clip-${safeId}`;
      const geometry = baseGeometry(`${item.globalIndex}-${item.ringId}`, item.radius, Math.max(32, item.gapBefore + style.fontSize));
      const d = geometry.d;
      const path = element('path', {
        id: pathId, d, fill: 'none', class: `ring-guide${selected.has(story.id) ? ' is-selected' : ''}`,
        'data-story-id': story.id, 'data-ring-id': item.ringId
      });
      layer.append(path);
      const actualLength = path.getTotalLength ? path.getTotalLength() : geometry.length;

      const isNew = !group.archived && options && options.animateId === story.id;
      let revealPath = null;
      if (isNew) {
        const clip = element('clipPath', { id: clipId });
        const reveal = element('path', {
          d, class: 'reveal-path is-revealing', pathLength: 1,
          'stroke-dasharray': 1, 'stroke-dashoffset': 1,
          'stroke-width': Math.max(32, style.fontSize * 2.4)
        });
        reveal.style.setProperty('--reveal-duration', `${group.settings.revealSpeed}s`);
        clip.append(reveal);
        layer.append(clip);
        revealPath = reveal;
      }

      const flowConfigured = Boolean(story.flow && story.flow.enabled);
      const prepared = flowConfigured
        ? flowingGlyphLayout(canvas, item.displayText, actualLength, style)
        : displayText(canvas, item.displayText, actualLength, style, false);
      const text = element(flowConfigured ? 'g' : 'text', Object.assign({
        class: `ring-text${selected.has(story.id) ? ' is-selected' : ''}`,
        'aria-label': item.displayText, 'data-story-id': story.id, 'data-ring-id': item.ringId,
        'data-path-length': actualLength.toFixed(2),
        'data-rendered-length': (flowConfigured ? prepared.loopLength : prepared.width).toFixed(2),
        'data-repetitions': prepared.repetitions
      }, fontAttributes(style)));
      if (isNew) text.setAttribute('clip-path', `url(#${clipId})`);
      let textPath = null;
      let flowGlyphs = null;
      if (flowConfigured) {
        text.classList.add('flow-ring-text');
        text.setAttribute('data-advance-scale', prepared.advanceScale.toFixed(5));
        text.setAttribute('data-average-character-width', prepared.averageCharacterWidth.toFixed(4));
        flowGlyphs = prepared.glyphs.map((entry) => {
          const glyph = element('text', {
            class: 'flow-glyph',
            x: 0, y: 0, 'text-anchor': 'middle', 'letter-spacing': 0,
            'data-offset': entry.offset.toFixed(8)
          });
          glyph.textContent = entry.glyph;
          text.append(glyph);
          return { node: glyph, offset: entry.offset };
        });
      } else {
        textPath = element('textPath', {
          href: `#${pathId}`,
          startOffset: (prepared.seamGap / 2).toFixed(2),
          textLength: Math.max(1, prepared.width).toFixed(2),
          lengthAdjust: 'spacingAndGlyphs'
        });
        textPath.setAttributeNS(XLINK_NS, 'xlink:href', `#${pathId}`);
        textPath.textContent = prepared.text;
        text.append(textPath);
      }
      layer.append(text);

      if (showGuides) {
        const label = element('text', {
          x: 600 + item.radius + 8, y: 404, class: `ring-number${selected.has(story.id) ? ' is-selected' : ''}`,
          'data-story-id': story.id, 'data-ring-id': item.ringId
        });
        label.textContent = String(item.globalIndex + 1).padStart(2, '0');
        layer.append(label);
      }
      path.classList.toggle('is-visible', showGuides);
      motionItems.push(Object.assign({}, item, {
        groupId: group.id, groupX: group.x, groupY: group.y, groupScale: group.scale,
        groupMaxRadius: group.layout.maxRadius, groupSettings: group.settings,
        groupItems: group.layout.items, archived: group.archived,
        path, revealPath, textPath, text, flowGlyphs, baseGeometry: geometry, flowGeometry: geometry,
        flowLoopLength: flowConfigured ? prepared.loopLength : 0,
        cycleWidth: prepared.cycleWidth,
        averageCharacterWidth: prepared.averageCharacterWidth,
        seamGap: prepared.seamGap || 0,
        flowReadyAt: 0
      }));
      });
    });
    const boundaryGroup = groupLayouts.find((group) => group.id === state.selectedGroupId);
    if (options && options.admin && state.editor.mode === 'layout' && boundaryGroup) {
      composition.append(element('circle', {
        class: 'group-layout-boundary', 'data-group-boundary': boundaryGroup.id,
        cx: 600 + boundaryGroup.x, cy: 400 + boundaryGroup.y,
        r: Math.max(45, boundaryGroup.layout.maxRadius * boundaryGroup.scale + 16)
      }));
    }

    if (window.MemoryMotion) {
      MemoryMotion.register(canvas, {
        state, canvas, composition, pageIndex, layout, items: motionItems,
        groupLayouts,
        admin: Boolean(options && options.admin)
      });
    }

    return { page: pageIndex, totalPages, storyCount: layout.items.length, layout, pages, groupLayouts };
  }

  function groupTransform(group) {
    return `translate(${group.x} ${group.y}) translate(600 400) scale(${group.scale}) translate(-600 -400)`;
  }

  function applyGroupLayout(canvas, id, placement) {
    const layer = Array.from(canvas.querySelectorAll('.memory-group')).find((node) => node.dataset.groupId === id);
    if (!layer) return;
    layer.setAttribute('transform', groupTransform(placement));
    const boundary = Array.from(canvas.querySelectorAll('[data-group-boundary]')).find((node) => node.dataset.groupBoundary === id);
    if (boundary) {
      const scene = window.MemoryMotion && MemoryMotion.groupPlacement(canvas, id);
      boundary.setAttribute('cx', 600 + placement.x);
      boundary.setAttribute('cy', 400 + placement.y);
      boundary.setAttribute('r', Math.max(45, (scene ? scene.layout.maxRadius : 0) * placement.scale + 16));
    }
    if (window.MemoryMotion) MemoryMotion.updateGroupPlacement(canvas, id, placement);
  }

  window.MemoryRings = {
    render, applyGroupLayout, displayText, flowingGlyphLayout, layoutPages, approximateWidth, FONT_STACKS, SEPARATOR
  };
}());
