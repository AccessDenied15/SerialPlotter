const messageInput = document.querySelector('#messageInput');
const canvas = document.querySelector('#previewCanvas');
const ctx = canvas.getContext('2d');
const fontUpload = document.querySelector('#fontUpload');
const fontList = document.querySelector('#fontList');
const toast = document.querySelector('#toast');
let zoom = 1;
let latestGcode = '';
const loadedFontFamilies = [];
const parsedFonts = [];
let fontParsing = Promise.resolve();
let lastToolpath = null;
let writingZero = { x: 18, y: 20 };
let pickingWritingZero = false;
let currentPosition = { x: 18, y: 20, z: 0 };
const manualJogCommands = [];

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

function drawPreview() {
  const toolpath = buildToolpath();
  lastToolpath = toolpath;
  document.querySelector('#paper').style.aspectRatio = `${toolpath.settings.workspaceWidth} / ${toolpath.settings.workspaceHeight}`;
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = rect.width * scale;
  canvas.height = rect.height * scale;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  const workspaceWidth = toolpath.settings.workspaceWidth;
  const workspaceHeight = toolpath.settings.workspaceHeight;
  document.querySelector('.paper-label').textContent = `${workspaceWidth} x ${workspaceHeight} mm workspace`;
  const xScale = rect.width / workspaceWidth;
  const yScale = rect.height / workspaceHeight;
  ctx.lineWidth = 1.15;
  ctx.lineCap = 'round';
  if (document.querySelector('#showTravel').checked) {
    ctx.strokeStyle = 'rgba(120, 116, 104, .35)';
    ctx.setLineDash([3, 3]);
    toolpath.travel.forEach((travel) => { ctx.beginPath(); ctx.moveTo(travel.from.x * xScale, travel.from.y * yScale); ctx.lineTo(travel.to.x * xScale, travel.to.y * yScale); ctx.stroke(); });
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = '#4a4943';
  toolpath.paths.forEach((path) => {
    ctx.beginPath();
    path.points.forEach((point, index) => { if (index === 0) ctx.moveTo(point.x * xScale, point.y * yScale); else ctx.lineTo(point.x * xScale, point.y * yScale); });
    ctx.stroke();
  });
  document.querySelector('#pathEstimate').textContent = `${toolpath.stats.pathCount} strokes / ${toolpath.stats.pointCount} points`;
  document.querySelector('#toolpathStatus').textContent = toolpath.overflow ? 'Text exceeds workspace' : (toolpath.usingFallback ? 'Fallback outlines active' : `Using ${toolpath.fontName}`);
  document.querySelector('#toolpathStatus').classList.toggle('overflow', toolpath.overflow);
}

function updateCount() {
  document.querySelector('#charCount').textContent = messageInput.value.length;
  drawPreview();
}

const glyphs = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'], C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'], D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'], E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'], F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'], G: ['01111', '10000', '10000', '10111', '10001', '10001', '01111'], H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'], I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'], J: ['00111', '00010', '00010', '00010', '10010', '10010', '01100'], K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'], L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'], M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'], N: ['10001', '11001', '11001', '10101', '10011', '10011', '10001'], O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'], P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'], Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'], R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'], S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'], T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'], U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'], V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'], W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'], X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'], Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'], Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'], ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'], '.': ['00000', '00000', '00000', '00000', '00000', '00000', '00100'], ',': ['00000', '00000', '00000', '00000', '00100', '00100', '01000'], '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100']
};

function appendGlyph(output, glyph, originX, originY, scale, feedRate, penLift) {
  const pattern = glyphs[glyph] || glyphs[' '];
  pattern.forEach((row, rowIndex) => {
    let runStart = -1;
    [...row, '0'].forEach((cell, columnIndex) => {
      if (cell === '1' && runStart < 0) runStart = columnIndex;
      if (cell !== '1' && runStart >= 0) {
        const startX = originX + runStart * scale;
        const endX = originX + columnIndex * scale;
        const y = originY + rowIndex * scale;
        output.push(`G0 X${startX.toFixed(2)} Y${y.toFixed(2)} Z${penLift}`);
        output.push(`G1 Z0.00 F${feedRate}`);
        output.push(`G1 X${endX.toFixed(2)} Y${y.toFixed(2)} F${feedRate}`);
        output.push(`G0 Z${penLift}`);
        runStart = -1;
      }
    });
  });
}

function appendOutline(output, font, text, originX, baselineY, fontSize, feedRate, penLift) {
  const path = font.getPath(text, originX, baselineY, fontSize);
  let current = { x: originX, y: baselineY };
  let contourStart = current;
  const addPoint = (point) => output.push(`G1 X${point.x.toFixed(2)} Y${point.y.toFixed(2)} F${feedRate}`);
  const curvePoint = (start, controlOne, controlTwo, end, t) => {
    const inverse = 1 - t;
    return {
      x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * controlOne.x + 3 * inverse * t ** 2 * controlTwo.x + t ** 3 * end.x,
      y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * controlOne.y + 3 * inverse * t ** 2 * controlTwo.y + t ** 3 * end.y
    };
  };
  const quadraticPoint = (start, control, end, t) => {
    const inverse = 1 - t;
    return { x: inverse ** 2 * start.x + 2 * inverse * t * control.x + t ** 2 * end.x, y: inverse ** 2 * start.y + 2 * inverse * t * control.y + t ** 2 * end.y };
  };
  path.commands.forEach((command) => {
    if (command.type === 'M') {
      current = { x: command.x, y: command.y };
      contourStart = current;
      output.push(`G0 X${current.x.toFixed(2)} Y${current.y.toFixed(2)} Z${penLift}`);
      output.push(`G1 Z0.00 F${feedRate}`);
    } else if (command.type === 'L') {
      current = { x: command.x, y: command.y };
      addPoint(current);
    } else if (command.type === 'C') {
      const start = current;
      for (let step = 1; step <= 8; step += 1) addPoint(curvePoint(start, command.x1 ? { x: command.x1, y: command.y1 } : start, { x: command.x2, y: command.y2 }, { x: command.x, y: command.y }, step / 8));
      current = { x: command.x, y: command.y };
    } else if (command.type === 'Q') {
      const start = current;
      for (let step = 1; step <= 6; step += 1) addPoint(quadraticPoint(start, { x: command.x1, y: command.y1 }, { x: command.x, y: command.y }, step / 6));
      current = { x: command.x, y: command.y };
    } else if (command.type === 'Z') {
      if (current.x !== contourStart.x || current.y !== contourStart.y) addPoint(contourStart);
      output.push(`G0 Z${penLift}`);
    }
  });
  if (path.commands.length && path.commands[path.commands.length - 1].type !== 'Z') output.push(`G0 Z${penLift}`);
  return font.getAdvanceWidth(text, fontSize);
}

function transformOutlineCommands(font, text, originX, originY, textSize, characterSpacing, output, stats) {
  if (!text) return 0;
  const unitPath = font.getPath(text, 0, 0, 1);
  const bounds = unitPath.getBoundingBox();
  const height = Math.max(0.001, bounds.y2 - bounds.y1);
  const scale = textSize / height;
  let cursor = 0;
  [...text].forEach((character, index) => {
    const glyphPath = font.getPath(character, cursor, 0, 1);
    let current = null;
    let contour = null;
    const addPoint = (x, y) => {
      if (!contour) contour = [];
      contour.push({ x: originX + x * scale + index * characterSpacing, y: originY + (y - bounds.y1) * scale });
    };
    glyphPath.commands.forEach((command) => {
      if (command.type === 'M') {
        if (contour && contour.length > 1) { output.push({ points: contour }); stats.pathCount += 1; stats.pointCount += contour.length; }
        contour = [];
        current = { x: command.x, y: command.y };
        addPoint(current.x, current.y);
      } else if (command.type === 'L') {
        current = { x: command.x, y: command.y };
        addPoint(current.x, current.y);
      } else if (command.type === 'Q') {
        const start = current;
        for (let step = 1; step <= 10; step += 1) {
          const t = step / 10;
          const inverse = 1 - t;
          addPoint(inverse ** 2 * start.x + 2 * inverse * t * command.x1 + t ** 2 * command.x, inverse ** 2 * start.y + 2 * inverse * t * command.y1 + t ** 2 * command.y);
          stats.curveSegments += 1;
        }
        current = { x: command.x, y: command.y };
      } else if (command.type === 'C') {
        const start = current;
        for (let step = 1; step <= 12; step += 1) {
          const t = step / 12;
          const inverse = 1 - t;
          addPoint(inverse ** 3 * start.x + 3 * inverse ** 2 * t * command.x1 + 3 * inverse * t ** 2 * command.x2 + t ** 3 * command.x, inverse ** 3 * start.y + 3 * inverse ** 2 * t * command.y1 + 3 * inverse * t ** 2 * command.y2 + t ** 3 * command.y);
          stats.curveSegments += 1;
        }
        current = { x: command.x, y: command.y };
      } else if (command.type === 'Z' && contour && contour.length > 1) {
        const first = contour[0];
        const last = contour[contour.length - 1];
        if (first.x !== last.x || first.y !== last.y) contour.push(first);
        output.push({ points: contour });
        stats.pathCount += 1;
        stats.pointCount += contour.length;
        contour = null;
      }
    });
    if (contour && contour.length > 1) { output.push({ points: contour }); stats.pathCount += 1; stats.pointCount += contour.length; }
    cursor += font.getAdvanceWidth(character, 1);
    if (character !== ' ') stats.glyphCount += 1;
  });
  return cursor * scale + Math.max(0, text.length - 1) * characterSpacing;
}

function buildFallbackLine(text, originX, originY, textSize, characterSpacing, paths, stats) {
  const cell = textSize / 7;
  const advance = cell * 6;
  [...text.toUpperCase()].forEach((character, characterIndex) => {
    const pattern = glyphs[character] || glyphs[' '];
    pattern.forEach((row, rowIndex) => {
      let start = -1;
      [...row, '0'].forEach((cellValue, columnIndex) => {
        if (cellValue === '1' && start < 0) start = columnIndex;
        if (cellValue !== '1' && start >= 0) {
          paths.push({ points: [{ x: originX + characterIndex * (advance + characterSpacing) + start * cell, y: originY + rowIndex * cell }, { x: originX + characterIndex * (advance + characterSpacing) + columnIndex * cell, y: originY + rowIndex * cell }] });
          stats.pathCount += 1;
          stats.pointCount += 2;
          start = -1;
        }
      });
    });
    if (character !== ' ') stats.glyphCount += 1;
  });
}

function buildToolpath() {
  const text = messageInput.value || 'Your words will live here.';
  const settings = { workspaceWidth: Number(document.querySelector('#workspaceWidth').value) || 200, workspaceHeight: Number(document.querySelector('#workspaceHeight').value) || 150, textSize: Number(document.querySelector('#textSizeRange').value) || 10, characterSpacing: Number(document.querySelector('#characterSpacingRange').value) || 0, lineSpacing: Number(document.querySelector('#lineSpacingRange').value) || 0 };
  const feedRate = Number(document.querySelector('#speedRange').value) * 10;
  const paths = [];
  const stats = { glyphCount: 0, pathCount: 0, pointCount: 0, curveSegments: 0 };
  const lines = text.split('\n');
  let y = writingZero.y;
  lines.forEach((line, lineIndex) => {
    const fontEntry = parsedFonts.length ? parsedFonts[lineIndex % parsedFonts.length] : null;
    if (fontEntry) transformOutlineCommands(fontEntry.font, line, writingZero.x, y, settings.textSize, settings.characterSpacing, paths, stats);
    else buildFallbackLine(line, writingZero.x, y, settings.textSize, settings.characterSpacing, paths, stats);
    y += settings.textSize + settings.lineSpacing;
  });
  const travel = [];
  let previous = { x: writingZero.x, y: writingZero.y };
  paths.forEach((path) => { travel.push({ from: previous, to: path.points[0] }); previous = path.points[path.points.length - 1]; });
  const allPoints = paths.flatMap((path) => path.points);
  const maxX = allPoints.length ? Math.max(...allPoints.map((point) => point.x)) : writingZero.x;
  const maxY = allPoints.length ? Math.max(...allPoints.map((point) => point.y)) : writingZero.y;
  const overflow = allPoints.some((point) => point.x < 0 || point.y < 0 || point.x > settings.workspaceWidth || point.y > settings.workspaceHeight);
  return { paths, travel, stats, settings, feedRate, penLift: Number(document.querySelector('#liftRange').value).toFixed(2), fontName: parsedFonts.length ? parsedFonts.map((entry) => entry.name).join(', ') : '', usingFallback: !parsedFonts.length, overflow, maxX, maxY };
}

function generateGcode() {
  const toolpath = buildToolpath();
  lastToolpath = toolpath;
  const text = messageInput.value || 'Your words will live here.';
  const output = [];
  output.push('; INKLINE TOOLPATH', `; Generated ${new Date().toISOString()}`, `; ${text.replace(/\n/g, ' / ')}`, toolpath.usingFallback ? '; Outline fonts: built-in fallback' : `; Outline font: ${toolpath.fontName}`, `; Glyphs: ${toolpath.stats.glyphCount} / contours: ${toolpath.stats.pathCount} / curve segments: ${toolpath.stats.curveSegments}`, `; Z${toolpath.penLift} = pen up, Z0.00 = pen down`, 'G21 ; millimeters', 'G90 ; absolute positioning');
  if (manualJogCommands.length) output.push('; MANUAL JOG MOVES', ...manualJogCommands);
  toolpath.paths.forEach((path) => {
    output.push(`G0 Z${toolpath.penLift}`, `G0 X${path.points[0].x.toFixed(2)} Y${path.points[0].y.toFixed(2)}`, `G1 Z0.00 F${toolpath.feedRate}`);
    path.points.slice(1).forEach((point) => output.push(`G1 X${point.x.toFixed(2)} Y${point.y.toFixed(2)} F${toolpath.feedRate}`));
    output.push(`G0 Z${toolpath.penLift}`);
  });
  output.push(`G0 Z${toolpath.penLift}`, `G0 X${writingZero.x.toFixed(2)} Y${writingZero.y.toFixed(2)}`, '; END');
  latestGcode = output.join('\n');
  document.querySelector('#gcodeOutput').textContent = latestGcode;
  return latestGcode;
}

/*
function generateGcode() {
  const text = messageInput.value || 'Your words will live here.';
  const speed = document.querySelector('#speedRange').value;
  const feedRate = speed * 10;
  const penLift = Number(document.querySelector('#liftRange').value).toFixed(2);
  const scale = 1.7;
  const characterAdvance = 10;
  const maxCharacters = 12;
  const lines = text.split('\n').flatMap((line) => {
    const chunks = [];
    for (let index = 0; index < line.length || (index === 0 && !line); index += maxCharacters) chunks.push(line.slice(index, index + maxCharacters));
    return chunks;
  });
  const commands = [];
  let y = writingZero.y;
  lines.forEach((line, lineIndex) => {
    const outlineFont = parsedFonts.length ? parsedFonts[lineIndex % parsedFonts.length].font : null;
    if (outlineFont) appendOutline(commands, outlineFont, line, writingZero.x, y + 10, 10, feedRate, penLift);
    else [...line.toUpperCase()].forEach((character, index) => appendGlyph(commands, character, writingZero.x + index * characterAdvance, y, scale, feedRate, penLift));
    y += 14;
  });
  const jogOutput = manualJogCommands.length ? `; MANUAL JOG MOVES\n${manualJogCommands.join('\n')}\n` : '';
  const fontComment = parsedFonts.length ? `; Outline fonts: ${parsedFonts.map((entry) => entry.name).join(', ')}\n` : '; Outline fonts: built-in fallback (upload a TTF or OTF for exact contours)\n';
  let output = `; INKLINE TOOLPATH\n; Generated ${new Date().toISOString()}\n; ${text.replace(/\n/g, ' / ')}\n${fontComment}; Z${penLift} = pen up, Z0.00 = pen down\nG21 ; millimeters\nG90 ; absolute positioning\n${jogOutput}`;
  output += `${commands.join('\n')}\nG0 X${writingZero.x.toFixed(2)} Y${writingZero.y.toFixed(2)} Z${penLift}\n; END`;
  latestGcode = output;
  document.querySelector('#gcodeOutput').textContent = output;
  return output;
}
*/

messageInput.addEventListener('input', updateCount);
document.querySelector('#clearButton').addEventListener('click', () => { messageInput.value = ''; updateCount(); messageInput.focus(); });
document.querySelector('#speedRange').addEventListener('input', (event) => { document.querySelector('#speedValue').textContent = `${event.target.value} mm/s`; });
document.querySelector('#liftRange').addEventListener('input', (event) => { document.querySelector('#liftValue').textContent = `${event.target.value} mm`; });
[['#textSizeRange', '#textSizeValue', ' mm'], ['#characterSpacingRange', '#characterSpacingValue', ' mm'], ['#lineSpacingRange', '#lineSpacingValue', ' mm']].forEach(([inputSelector, valueSelector, suffix]) => {
  document.querySelector(inputSelector).addEventListener('input', (event) => { document.querySelector(valueSelector).textContent = `${event.target.value}${suffix}`; drawPreview(); });
});
['#workspaceWidth', '#workspaceHeight'].forEach((selector) => document.querySelector(selector).addEventListener('input', drawPreview));
document.querySelector('#showTravel').addEventListener('change', drawPreview);
fontList.addEventListener('input', (event) => {
  if (!event.target.classList.contains('font-range')) return;
  const sliders = [...fontList.querySelectorAll('.font-range')];
  const remaining = 100 - Number(event.target.value);
  const others = sliders.filter((slider) => slider !== event.target);
  if (others.length === 1) {
    others[0].value = remaining;
  } else if (others.length) {
    const total = others.reduce((sum, slider) => sum + Number(slider.value), 0) || others.length;
    others.forEach((slider) => { slider.value = Math.round(remaining * Number(slider.value) / total); });
  }
  sliders.forEach((slider) => {
    const voiceRow = slider.closest('.font-row');
    voiceRow.querySelector('em').textContent = `• ${slider.value}%`;
  });
  renderLibrary();
  drawPreview();
});
document.querySelector('#zoomIn').addEventListener('click', () => { zoom = Math.min(1.18, zoom + .08); document.querySelector('#zoomValue').textContent = `${Math.round(zoom * 100)}%`; document.querySelector('#paper').style.transform = `scale(${zoom})`; });
document.querySelector('#zoomOut').addEventListener('click', () => { zoom = Math.max(.84, zoom - .08); document.querySelector('#zoomValue').textContent = `${Math.round(zoom * 100)}%`; document.querySelector('#paper').style.transform = `scale(${zoom})`; });
function renderLibrary() {
  const libraryList = document.querySelector('#libraryList');
  if (!libraryList) return;
  libraryList.innerHTML = [...fontList.querySelectorAll('.font-row')].map((row) => {
    const name = row.dataset.font.replace(/\.(ttf|otf|woff2?)$/i, '');
    const range = row.querySelector('.font-range').value;
    return `<div class="library-font-card"><span class="font-swatch swatch-yellow">Aa</span><div><strong>${name}</strong><span>Available voice</span></div><b>${range}%</b></div>`;
  }).join('');
  document.querySelector('#libraryFontCount').textContent = fontList.children.length;
}

function addFontFiles(files) {
  [...files].forEach((file, index) => {
    const row = document.createElement('div');
    row.className = 'font-row';
    row.dataset.font = file.name;
    row.innerHTML = `<span class="drag-handle">&#8942;&#8942;</span><span class="font-swatch swatch-${index % 2 ? 'blue' : 'yellow'}">Aa</span><div class="font-info"><strong>${file.name.replace(/\.(ttf|otf|woff2?)$/i, '')}</strong><span>Uploaded voice <em>• ${Math.max(8, 20 - index * 4)}%</em></span></div><input class="font-range" type="range" min="0" max="100" value="${Math.max(8, 20 - index * 4)}"><button class="more-button">&#8942;</button>`;
    fontList.appendChild(row);
    if ('FontFace' in window) {
      const family = `uploaded-${Date.now()}-${index}`;
      const face = new FontFace(family, `url(${URL.createObjectURL(file)})`);
      face.load().then((loaded) => {
        document.fonts.add(loaded);
        loadedFontFamilies.push(family);
        drawPreview();
      }).catch(() => showToast(`${file.name} could not be loaded in this browser.`));
    }
    if (window.opentype && (file.name.match(/\.(ttf|otf)$/i))) {
      fontParsing = fontParsing.then(() => file.arrayBuffer().then((buffer) => {
        const font = window.opentype.parse(buffer);
        parsedFonts.push({ name: file.name, font });
        drawPreview();
        showToast(`${file.name} is ready for exact-outline G-code.`);
      }).catch(() => showToast(`${file.name} preview loaded, but its outlines could not be parsed.`)));
    }
  });
  document.querySelector('#fontCount').textContent = fontList.children.length;
  renderLibrary();
  if (files.length) showToast(`${files.length} font${files.length > 1 ? 's' : ''} added to your voice roster.`);
}

document.querySelector('#uploadTrigger').addEventListener('click', () => fontUpload.click());
fontUpload.addEventListener('change', (event) => { addFontFiles(event.target.files); event.target.value = ''; });
document.querySelector('#libraryUploadButton').addEventListener('click', () => document.querySelector('#libraryFontUpload').click());
document.querySelector('#libraryBrowseButton').addEventListener('click', () => document.querySelector('#libraryFontUpload').click());
document.querySelector('#libraryFontUpload').addEventListener('change', (event) => { addFontFiles(event.target.files); event.target.value = ''; });
const libraryDropzone = document.querySelector('#libraryDropzone');
libraryDropzone.addEventListener('dragover', (event) => { event.preventDefault(); libraryDropzone.classList.add('dragging'); });
libraryDropzone.addEventListener('dragleave', () => libraryDropzone.classList.remove('dragging'));
libraryDropzone.addEventListener('drop', (event) => { event.preventDefault(); libraryDropzone.classList.remove('dragging'); addFontFiles(event.dataTransfer.files); });

function showView(view) {
  const compose = view === 'compose';
  document.querySelector('#composeGrid').hidden = !compose;
  document.querySelector('#lowerGrid').hidden = !compose;
  document.querySelector('#actionBar').hidden = !compose;
  document.querySelector('#fontLibraryPage').hidden = compose;
  document.querySelector('#composeNav').classList.toggle('active', compose);
  document.querySelector('#fontLibraryNav').classList.toggle('active', !compose);
}
document.querySelector('#composeNav').addEventListener('click', () => showView('compose'));
document.querySelector('#fontLibraryNav').addEventListener('click', () => showView('library'));
function updateWritingZero(x, y) {
  writingZero = { x, y };
  document.querySelector('#zeroValue').textContent = `X ${x.toFixed(1)} / Y ${y.toFixed(1)} mm`;
  document.querySelector('#zeroHint').textContent = 'Custom page start';
  const paper = document.querySelector('#paper');
  const marker = document.querySelector('#zeroMarker');
  marker.style.left = `${(x / 148) * paper.clientWidth}px`;
  marker.style.top = `${(y / 210) * paper.clientHeight}px`;
  marker.hidden = false;
}

function updateJogPosition() {
  document.querySelector('#jogPosition').textContent = `X ${currentPosition.x.toFixed(1)} / Y ${currentPosition.y.toFixed(1)} / Z ${currentPosition.z.toFixed(1)}`;
}

document.querySelectorAll('[data-jog-axis]').forEach((button) => {
  button.addEventListener('click', () => {
    const axis = button.dataset.jogAxis;
    const direction = Number(button.dataset.jogDirection);
    const step = Number(document.querySelector(`#jogStep${axis.toUpperCase()}`).value);
    if (!Number.isFinite(step) || step <= 0) {
      showToast(`Enter a positive ${axis.toUpperCase()} step first.`);
      return;
    }
    currentPosition[axis] = Math.max(0, currentPosition[axis] + direction * step);
    const command = `G0 X${currentPosition.x.toFixed(1)} Y${currentPosition.y.toFixed(1)} Z${currentPosition.z.toFixed(1)}`;
    manualJogCommands.push(command);
    updateJogPosition();
    document.querySelector('#deviceState').textContent = 'Jogged';
    showToast(`${axis.toUpperCase()} moved ${step.toFixed(1)} mm.`);
  });
});
document.querySelector('#paper').addEventListener('click', (event) => {
  if (!pickingWritingZero) return;
  const paper = event.currentTarget;
  const rect = paper.getBoundingClientRect();
  updateWritingZero(Math.max(0, Math.min(148, ((event.clientX - rect.left) / rect.width) * 148)), Math.max(0, Math.min(210, ((event.clientY - rect.top) / rect.height) * 210)));
  pickingWritingZero = false;
  paper.classList.remove('picking-zero');
  showToast('Writing zero set for this job.');
});
document.querySelectorAll('[data-zero-axis]').forEach((button) => {
  button.addEventListener('click', () => {
    const axis = button.dataset.zeroAxis;
    currentPosition[axis] = 0;
    manualJogCommands.push(`G92 ${axis.toUpperCase()}0`);
    updateJogPosition();
    document.querySelector('#deviceState').textContent = `${axis.toUpperCase()} zeroed`;
    showToast(`${axis.toUpperCase()} zero set.`);
  });
});
document.querySelector('#returnZeroButton').addEventListener('click', () => {
  currentPosition = { x: writingZero.x, y: writingZero.y, z: 0 };
  manualJogCommands.push(`G0 X${currentPosition.x.toFixed(1)} Y${currentPosition.y.toFixed(1)} Z0.0`);
  updateJogPosition();
  document.querySelector('#deviceState').textContent = 'At writing zero';
  showToast('Pen returned to the writing zero in the simulator.');
});
document.querySelector('#gcodeButton').addEventListener('click', async () => { await fontParsing; generateGcode(); document.querySelector('#gcodeModal').classList.add('open'); });
document.querySelector('#closeModal').addEventListener('click', () => document.querySelector('#gcodeModal').classList.remove('open'));
document.querySelector('#gcodeModal').addEventListener('click', (event) => { if (event.target.id === 'gcodeModal') event.currentTarget.classList.remove('open'); });
document.querySelector('#downloadButton').addEventListener('click', () => { const blob = new Blob([latestGcode || generateGcode()], { type: 'text/plain' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'inkline-job.gcode'; link.click(); URL.revokeObjectURL(link.href); showToast('G-code downloaded.'); });
document.querySelector('#connectButton').addEventListener('click', async () => {
  if (!('serial' in navigator)) { showToast('Web Serial is unavailable here. Simulator remains active.'); return; }
  try { await navigator.serial.requestPort(); document.querySelector('#connectionText').textContent = 'USB DEVICE CONNECTED'; document.querySelector('#deviceState').textContent = 'Connected'; document.querySelector('#connectButton').innerHTML = '<span>&#9679;</span> Device connected'; showToast('Plotter connected.'); } catch { showToast('Connection cancelled.'); }
});
document.querySelector('#startButton').addEventListener('click', async () => { await fontParsing; generateGcode(); document.querySelector('#actionStatus').textContent = 'Plotting job in simulator...'; document.querySelector('#deviceState').textContent = 'Plotting'; showToast('Plotting started.'); setTimeout(() => { document.querySelector('#actionStatus').textContent = 'Job complete'; document.querySelector('#deviceState').textContent = 'Idle'; }, 3600); });
window.addEventListener('resize', drawPreview);
renderLibrary();
updateJogPosition();
updateCount();
