"use strict";

const PADDING = { left: 54, right: 18, top: 18, bottom: 34 };
const SYMBOL_COUNT = 48;
const SPECTRUM_SIZE = 1024;

const controls = {
  mode: document.querySelector("#iqMode"),
  symbolRate: document.querySelector("#iqSymbolRate"),
  symbolRateInput: document.querySelector("#iqSymbolRateInput"),
  samplesPerSymbol: document.querySelector("#iqSamplesPerSymbol"),
  carrier: document.querySelector("#rfCarrier"),
  carrierInput: document.querySelector("#rfCarrierInput"),
  freqOffset: document.querySelector("#freqOffset"),
  freqOffsetInput: document.querySelector("#freqOffsetInput"),
  phase: document.querySelector("#iqPhase"),
  phaseInput: document.querySelector("#iqPhaseInput"),
  gainImbalance: document.querySelector("#gainImbalance"),
  quadError: document.querySelector("#quadError"),
  dcOffset: document.querySelector("#dcOffset"),
  snr: document.querySelector("#iqSnr"),
  snrInput: document.querySelector("#iqSnrInput")
};

const outputs = {
  symbolRate: document.querySelector("#iqSymbolRateValue"),
  carrier: document.querySelector("#rfCarrierValue"),
  freqOffset: document.querySelector("#freqOffsetValue"),
  phase: document.querySelector("#iqPhaseValue"),
  gainImbalance: document.querySelector("#gainImbalanceValue"),
  quadError: document.querySelector("#quadErrorValue"),
  dcOffset: document.querySelector("#dcOffsetValue"),
  snr: document.querySelector("#iqSnrValue"),
  sampleRate: document.querySelector("#iqSampleRateMetric"),
  bandwidth: document.querySelector("#basebandBwMetric"),
  residual: document.querySelector("#residualMetric"),
  evm: document.querySelector("#evmMetric"),
  sourceHint: document.querySelector("#sourceHint"),
  lessonTitle: document.querySelector("#iqLessonTitle"),
  lessonText: document.querySelector("#iqLessonText"),
  waveBadge: document.querySelector("#iqWaveBadge"),
  planeBadge: document.querySelector("#iqPlaneBadge"),
  spectrumBadge: document.querySelector("#iqSpectrumBadge"),
  waveNote: document.querySelector("#iqWaveNote"),
  diagnosis: document.querySelector("#iqDiagnosis"),
  waveCursor: document.querySelector("#iqWaveCursor"),
  planeCursor: document.querySelector("#iqPlaneCursor"),
  spectrumCursor: document.querySelector("#iqSpectrumCursor"),
  waveRange: document.querySelector("#iqWaveRange")
};

const canvases = {
  wave: document.querySelector("#iqWaveCanvas"),
  plane: document.querySelector("#iqPlaneCanvas"),
  spectrum: document.querySelector("#iqSpectrumCanvas")
};

const chartViews = {
  wave: { xMin: 0, xMax: 18, yMin: -1.7, yMax: 1.7, cursor: null },
  plane: { xMin: -1.8, xMax: 1.8, yMin: -1.8, yMax: 1.8, cursor: null },
  spectrum: { xMin: -12000, xMax: 12000, yMin: -72, yMax: 8, cursor: null }
};

let latest = null;
let randomState = 0x4d595df4;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function random() {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return (randomState >>> 0) / 4294967296;
}

function gaussian() {
  const u = Math.max(1e-9, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

function formatRate(value, suffix) {
  const abs = Math.abs(value);
  if (abs >= 1000000) return `${(value / 1000000).toFixed(2)} M${suffix}`;
  if (abs >= 1000) return `${(value / 1000).toFixed(value % 1000 ? 2 : 0)} k${suffix}`;
  return `${value.toFixed ? value.toFixed(0) : value} ${suffix}`;
}

function formatHz(value) {
  const abs = Math.abs(value);
  if (abs >= 1000) return `${(value / 1000).toFixed(abs % 1000 ? 2 : 0)} kHz`;
  return `${value.toFixed(0)} Hz`;
}

function dbToLinear(db) {
  return 10 ** (db / 20);
}

function add(a, b) {
  return { i: a.i + b.i, q: a.q + b.q };
}

function sub(a, b) {
  return { i: a.i - b.i, q: a.q - b.q };
}

function mul(a, b) {
  return { i: a.i * b.i - a.q * b.q, q: a.i * b.q + a.q * b.i };
}

function rotate(point, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { i: point.i * c - point.q * s, q: point.i * s + point.q * c };
}

function magnitude(point) {
  return Math.hypot(point.i, point.q);
}

function idealConstellation(mode) {
  if (mode === "tone") return [{ i: 1, q: 0, label: "tone" }];
  if (mode === "qpsk") {
    return [
      { i: 1 / Math.SQRT2, q: 1 / Math.SQRT2, label: "00" },
      { i: -1 / Math.SQRT2, q: 1 / Math.SQRT2, label: "01" },
      { i: -1 / Math.SQRT2, q: -1 / Math.SQRT2, label: "11" },
      { i: 1 / Math.SQRT2, q: -1 / Math.SQRT2, label: "10" }
    ];
  }
  if (mode === "psk8") {
    return Array.from({ length: 8 }, (_, index) => {
      const angle = Math.PI / 8 + index * Math.PI / 4;
      return { i: Math.cos(angle), q: Math.sin(angle), label: index.toString(2).padStart(3, "0") };
    });
  }
  const levels = [-3, -1, 1, 3];
  const scale = Math.sqrt(10);
  const points = [];
  levels.forEach(q => {
    levels.forEach(i => points.push({ i: i / scale, q: q / scale, label: `${i},${q}` }));
  });
  return points;
}

function makeSymbols(mode) {
  const constellation = idealConstellation(mode);
  if (mode === "tone") {
    return Array.from({ length: SYMBOL_COUNT }, (_, index) => {
      const angle = index * 0.32;
      return { i: Math.cos(angle), q: Math.sin(angle), label: "tone" };
    });
  }
  return Array.from({ length: SYMBOL_COUNT }, () => constellation[Math.floor(random() * constellation.length)]);
}

function nearestIdeal(point, constellation) {
  let best = constellation[0];
  let bestDistance = Infinity;
  constellation.forEach(candidate => {
    const distance = (point.i - candidate.i) ** 2 + (point.q - candidate.q) ** 2;
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  });
  return best;
}

function generateData() {
  randomState = 0x4d595df4;
  const mode = controls.mode.value;
  const symbolRate = Number(controls.symbolRate.value);
  const sps = Number(controls.samplesPerSymbol.value);
  const carrier = Number(controls.carrier.value);
  const freqOffset = Number(controls.freqOffset.value);
  const phase = Number(controls.phase.value) * Math.PI / 180;
  const gainImbalance = Number(controls.gainImbalance.value) / 100;
  const quadError = Number(controls.quadError.value) * Math.PI / 180;
  const dcOffset = Number(controls.dcOffset.value) / 100;
  const snr = Number(controls.snr.value);
  const sampleRate = chooseSampleRate(symbolRate, sps, carrier, freqOffset);
  const symbols = makeSymbols(mode);
  const constellation = idealConstellation(mode);
  const noiseSigma = 1 / dbToLinear(snr) / Math.SQRT2;
  const samples = [];
  const symbolSamples = [];
  const rfSamples = [];
  const totalSamples = symbols.length * sps;

  for (let n = 0; n < totalSamples; n += 1) {
    const symbolIndex = Math.min(symbols.length - 1, Math.floor(n / sps));
    const progress = (n % sps) / sps;
    const previous = symbols[Math.max(0, symbolIndex - 1)];
    const current = symbols[symbolIndex];
    const shaped = smoothstep(progress);
    const base = {
      i: previous.i + (current.i - previous.i) * shaped,
      q: previous.q + (current.q - previous.q) * shaped
    };
    const t = n / sampleRate;
    const drifted = rotate(base, 2 * Math.PI * freqOffset * t + phase);
    const impaired = applyIqImpairments(drifted, gainImbalance, quadError, dcOffset);
    const received = {
      i: impaired.i + noiseSigma * gaussian(),
      q: impaired.q + noiseSigma * gaussian()
    };
    samples.push({ time: t, symbol: n / sps, ideal: base, received });
    const rfAngle = 2 * Math.PI * carrier * t;
    rfSamples.push(received.i * Math.cos(rfAngle) - received.q * Math.sin(rfAngle));
    if (n % sps === sps - 1) symbolSamples.push({ ideal: current, received, index: symbolIndex });
  }

  const evm = computeEvm(symbolSamples, constellation, mode);
  return {
    mode,
    symbolRate,
    sps,
    carrier,
    freqOffset,
    phase,
    gainImbalance,
    quadError,
    dcOffset,
    snr,
    sampleRate,
    symbols,
    constellation,
    samples,
    symbolSamples,
    rfSamples,
    spectrum: computeSpectrum(samples, sampleRate),
    evm
  };
}

function chooseSampleRate(symbolRate, sps, carrier, freqOffset) {
  const base = symbolRate * sps;
  const rfNeed = 2.8 * (Math.abs(carrier) + Math.abs(freqOffset) + symbolRate * 3);
  const target = Math.max(base, rfNeed, 48000);
  const choices = [48000, 96000, 192000, 384000, 768000];
  return choices.find(rate => rate >= target) || choices[choices.length - 1];
}

function smoothstep(x) {
  return x * x * (3 - 2 * x);
}

function applyIqImpairments(point, gainImbalance, quadError, dcOffset) {
  const iGain = 1 + gainImbalance;
  const qGain = 1 - gainImbalance;
  const skewedQ = point.i * Math.sin(quadError) + point.q * Math.cos(quadError);
  return {
    i: point.i * iGain + dcOffset,
    q: skewedQ * qGain - dcOffset * 0.55
  };
}

function computeEvm(symbolSamples, constellation, mode) {
  if (mode === "tone") {
    const idealPower = symbolSamples.reduce((sum, sample) => sum + magnitude(sample.ideal) ** 2, 0) / symbolSamples.length;
    const errorPower = symbolSamples.reduce((sum, sample) => {
      const ideal = rotate({ i: 1, q: 0 }, Math.atan2(sample.ideal.q, sample.ideal.i));
      return sum + magnitude(sub(sample.received, ideal)) ** 2;
    }, 0) / symbolSamples.length;
    return 100 * Math.sqrt(errorPower / Math.max(idealPower, 1e-9));
  }
  const idealPower = constellation.reduce((sum, point) => sum + magnitude(point) ** 2, 0) / constellation.length;
  const errorPower = symbolSamples.reduce((sum, sample) => {
    const nearest = nearestIdeal(sample.received, constellation);
    return sum + magnitude(sub(sample.received, nearest)) ** 2;
  }, 0) / symbolSamples.length;
  return 100 * Math.sqrt(errorPower / Math.max(idealPower, 1e-9));
}

function computeSpectrum(samples, sampleRate) {
  const length = Math.min(SPECTRUM_SIZE, samples.length);
  const start = Math.max(0, Math.floor((samples.length - length) / 2));
  const bins = [];
  for (let k = 0; k < length; k += 1) {
    let sum = { i: 0, q: 0 };
    for (let n = 0; n < length; n += 1) {
      const sample = samples[start + n].received;
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (length - 1));
      const angle = -2 * Math.PI * k * n / length;
      sum = add(sum, mul({ i: sample.i * window, q: sample.q * window }, { i: Math.cos(angle), q: Math.sin(angle) }));
    }
    const shifted = k < length / 2 ? k + length / 2 : k - length / 2;
    const frequency = (shifted - length / 2) * sampleRate / length;
    const magnitudeDb = 20 * Math.log10(Math.max(1e-6, magnitude(sum) / length));
    bins.push({ frequency, magnitude: magnitudeDb + 42 });
  }
  return bins.sort((a, b) => a.frequency - b.frequency);
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.floor(rect.width * ratio));
  const height = Math.max(220, Math.floor(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width: width / ratio, height: height / ratio };
}

function plotArea(width, height) {
  return {
    left: PADDING.left,
    right: width - PADDING.right,
    top: PADDING.top,
    bottom: height - PADDING.bottom,
    width: width - PADDING.left - PADDING.right,
    height: height - PADDING.top - PADDING.bottom
  };
}

function xToPixel(x, view, area) {
  return area.left + (x - view.xMin) / (view.xMax - view.xMin) * area.width;
}

function yToPixel(y, view, area) {
  return area.bottom - (y - view.yMin) / (view.yMax - view.yMin) * area.height;
}

function pixelToX(pixel, view, area) {
  return view.xMin + (pixel - area.left) / area.width * (view.xMax - view.xMin);
}

function pixelToY(pixel, view, area) {
  return view.yMin + (area.bottom - pixel) / area.height * (view.yMax - view.yMin);
}

function clearChart(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#09120f";
  ctx.fillRect(0, 0, width, height);
}

function drawAxes(ctx, area, view, options = {}) {
  ctx.strokeStyle = "rgba(145, 163, 157, 0.22)";
  ctx.lineWidth = 1;
  ctx.strokeRect(area.left, area.top, area.width, area.height);
  ctx.fillStyle = "#71857e";
  ctx.font = "11px Cascadia Code, Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";

  const xTicks = options.xTicks || 5;
  for (let index = 0; index <= xTicks; index += 1) {
    const value = view.xMin + (view.xMax - view.xMin) * index / xTicks;
    const x = xToPixel(value, view, area);
    ctx.beginPath();
    ctx.moveTo(x, area.top);
    ctx.lineTo(x, area.bottom);
    ctx.stroke();
    ctx.fillText(options.formatX ? options.formatX(value) : value.toFixed(1), x, area.bottom + 8);
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const yTicks = options.yTicks || 4;
  for (let index = 0; index <= yTicks; index += 1) {
    const value = view.yMin + (view.yMax - view.yMin) * index / yTicks;
    const y = yToPixel(value, view, area);
    ctx.beginPath();
    ctx.moveTo(area.left, y);
    ctx.lineTo(area.right, y);
    ctx.stroke();
    ctx.fillText(options.formatY ? options.formatY(value) : value.toFixed(1), area.left - 8, y);
  }

  if (view.xMin < 0 && view.xMax > 0) {
    const x0 = xToPixel(0, view, area);
    ctx.strokeStyle = "rgba(183, 255, 60, 0.35)";
    ctx.beginPath();
    ctx.moveTo(x0, area.top);
    ctx.lineTo(x0, area.bottom);
    ctx.stroke();
  }
  if (view.yMin < 0 && view.yMax > 0) {
    const y0 = yToPixel(0, view, area);
    ctx.strokeStyle = "rgba(183, 255, 60, 0.35)";
    ctx.beginPath();
    ctx.moveTo(area.left, y0);
    ctx.lineTo(area.right, y0);
    ctx.stroke();
  }
}

function drawLine(ctx, points, view, area, color, mapX, mapY) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  let started = false;
  points.forEach(point => {
    const xValue = mapX(point);
    if (xValue < view.xMin || xValue > view.xMax) return;
    const x = xToPixel(xValue, view, area);
    const y = yToPixel(mapY(point), view, area);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();
}

function drawWave() {
  const { ctx, width, height } = setupCanvas(canvases.wave);
  const area = plotArea(width, height);
  const view = chartViews.wave;
  clearChart(ctx, width, height);
  drawAxes(ctx, area, view, {
    formatX: value => value.toFixed(1),
    formatY: value => value.toFixed(1)
  });
  drawLine(ctx, latest.samples, view, area, "#45e8d4", point => point.symbol, point => point.received.i);
  drawLine(ctx, latest.samples, view, area, "#b7ff3c", point => point.symbol, point => point.received.q);
}

function drawPlane() {
  const { ctx, width, height } = setupCanvas(canvases.plane);
  const area = plotArea(width, height);
  const view = chartViews.plane;
  clearChart(ctx, width, height);
  drawAxes(ctx, area, view, {
    formatX: value => value.toFixed(1),
    formatY: value => value.toFixed(1)
  });

  ctx.strokeStyle = "rgba(69, 232, 212, 0.38)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  let started = false;
  latest.samples.forEach((sample, index) => {
    if (index % 2) return;
    const x = xToPixel(sample.received.i, view, area);
    const y = yToPixel(sample.received.q, view, area);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  latest.constellation.forEach(point => {
    const x = xToPixel(point.i, view, area);
    const y = yToPixel(point.q, view, area);
    ctx.strokeStyle = "rgba(238, 247, 242, 0.75)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.stroke();
  });

  latest.symbolSamples.forEach(sample => {
    const x = xToPixel(sample.received.i, view, area);
    const y = yToPixel(sample.received.q, view, area);
    ctx.fillStyle = latest.evm > 28 ? "#ff9f43" : "#b7ff3c";
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawSpectrum() {
  const { ctx, width, height } = setupCanvas(canvases.spectrum);
  const area = plotArea(width, height);
  const view = chartViews.spectrum;
  clearChart(ctx, width, height);
  drawAxes(ctx, area, view, {
    formatX: value => formatHz(value),
    formatY: value => `${value.toFixed(0)}`
  });
  ctx.strokeStyle = "#b7ff3c";
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  let started = false;
  latest.spectrum.forEach(bin => {
    if (bin.frequency < view.xMin || bin.frequency > view.xMax) return;
    const x = xToPixel(bin.frequency, view, area);
    const y = yToPixel(bin.magnitude, view, area);
    if (!started) {
      ctx.moveTo(x, y);
      started = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  const offsetX = xToPixel(latest.freqOffset, view, area);
  ctx.strokeStyle = "rgba(255, 159, 67, 0.85)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(offsetX, area.top);
  ctx.lineTo(offsetX, area.bottom);
  ctx.stroke();
  ctx.setLineDash([]);
}

function renderCharts() {
  if (!latest) return;
  drawWave();
  drawPlane();
  drawSpectrum();
}

function resetView(kind, auto = false, skipRender = false) {
  if (kind === "wave") {
    chartViews.wave.xMin = 0;
    chartViews.wave.xMax = auto ? latest.symbols.length : 18;
    chartViews.wave.yMin = -1.7;
    chartViews.wave.yMax = 1.7;
  }
  if (kind === "plane") {
    const limit = auto ? Math.max(1.4, ...latest.samples.map(sample => magnitude(sample.received))) * 1.15 : 1.8;
    chartViews.plane.xMin = -limit;
    chartViews.plane.xMax = limit;
    chartViews.plane.yMin = -limit;
    chartViews.plane.yMax = limit;
  }
  if (kind === "spectrum") {
    const span = auto ? Math.max(3000, latest.symbolRate * 4 + Math.abs(latest.freqOffset) * 2) : 12000;
    chartViews.spectrum.xMin = -span;
    chartViews.spectrum.xMax = span;
    chartViews.spectrum.yMin = -72;
    chartViews.spectrum.yMax = 8;
  }
  updateRanges();
  if (!skipRender) renderCharts();
}

function zoomView(kind, axis, factor, anchor = 0.5) {
  const view = chartViews[kind];
  const minKey = axis === "x" ? "xMin" : "yMin";
  const maxKey = axis === "x" ? "xMax" : "yMax";
  const min = view[minKey];
  const max = view[maxKey];
  const center = min + (max - min) * anchor;
  const span = (max - min) * factor;
  view[minKey] = center - span * anchor;
  view[maxKey] = center + span * (1 - anchor);
  updateRanges();
  renderCharts();
}

function panView(kind, dxRatio, dyRatio) {
  const view = chartViews[kind];
  const dx = (view.xMax - view.xMin) * dxRatio;
  const dy = (view.yMax - view.yMin) * dyRatio;
  view.xMin += dx;
  view.xMax += dx;
  view.yMin += dy;
  view.yMax += dy;
  updateRanges();
  renderCharts();
}

function attachChart(kind, canvas, cursor) {
  let dragging = false;
  let last = null;
  canvas.addEventListener("pointerdown", event => {
    dragging = true;
    last = { x: event.clientX, y: event.clientY };
    canvas.classList.add("is-dragging");
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", event => {
    const rect = canvas.getBoundingClientRect();
    const area = plotArea(rect.width, rect.height);
    const view = chartViews[kind];
    const x = pixelToX(event.clientX - rect.left, view, area);
    const y = pixelToY(event.clientY - rect.top, view, area);
    chartViews[kind].cursor = { x, y };
    if (kind === "wave") cursor.textContent = `${x.toFixed(2)} sym | I/Q ${y.toFixed(2)}`;
    if (kind === "plane") cursor.textContent = `I ${x.toFixed(2)} | Q ${y.toFixed(2)}`;
    if (kind === "spectrum") cursor.textContent = `${formatHz(x)} | ${y.toFixed(1)} dB`;
    if (dragging && last) {
      panView(kind, -(event.clientX - last.x) / Math.max(1, area.width), (event.clientY - last.y) / Math.max(1, area.height));
      last = { x: event.clientX, y: event.clientY };
    }
  });
  canvas.addEventListener("pointerup", event => {
    dragging = false;
    last = null;
    canvas.classList.remove("is-dragging");
    canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointerleave", () => {
    dragging = false;
    last = null;
    canvas.classList.remove("is-dragging");
  });
  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const area = plotArea(rect.width, rect.height);
    const anchorX = clamp((event.clientX - rect.left - area.left) / area.width, 0, 1);
    const anchorY = clamp((area.bottom - (event.clientY - rect.top)) / area.height, 0, 1);
    const factor = event.deltaY < 0 ? 0.82 : 1.22;
    zoomView(kind, event.shiftKey ? "y" : "x", factor, event.shiftKey ? anchorY : anchorX);
  }, { passive: false });
  canvas.addEventListener("dblclick", () => resetView(kind, false));
}

function updateCopy() {
  outputs.symbolRate.textContent = formatRate(latest.symbolRate, "Bd");
  outputs.carrier.textContent = formatHz(latest.carrier);
  outputs.freqOffset.textContent = formatHz(latest.freqOffset);
  outputs.phase.textContent = `${Math.round(latest.phase * 180 / Math.PI)}°`;
  outputs.gainImbalance.textContent = `${Math.round(latest.gainImbalance * 100)}%`;
  outputs.quadError.textContent = `${Math.round(latest.quadError * 180 / Math.PI)}°`;
  outputs.dcOffset.textContent = `${Math.round(latest.dcOffset * 100)}%`;
  outputs.snr.textContent = `${latest.snr} dB`;
  outputs.sampleRate.textContent = formatRate(latest.sampleRate, "Sa/s");
  outputs.bandwidth.textContent = formatHz(latest.symbolRate * (latest.mode === "qam16" ? 1.4 : 2));
  outputs.residual.textContent = formatHz(latest.freqOffset);
  outputs.evm.textContent = `${latest.evm.toFixed(1)}%`;
  outputs.waveBadge.textContent = `显示 ${Math.round(chartViews.wave.xMax - chartViews.wave.xMin)} 个符号`;
  outputs.planeBadge.textContent = `${latest.symbolSamples.length} 个判决采样`;
  outputs.spectrumBadge.textContent = `频偏 ${formatHz(latest.freqOffset)}`;

  const descriptions = {
    qpsk: ["QPSK：I/Q 各有两种状态", "QPSK 可以理解为 I 路一比特、Q 路一比特。只要频偏很小，采样点会稳定聚在四个象限。", "QPSK 的 I/Q 分量像两路同步的 BPSK，组合后形成四个星座点。"],
    psk8: ["8PSK：更多相位，更小间距", "8PSK 把 8 个符号放在同一个圆上，频谱效率提高，但相邻点更近，所以相位误差更危险。", "8PSK 主要改变相位，观察复数平面时会看到八个方向。"],
    qam16: ["16QAM：幅度和相位一起承载信息", "16QAM 同时使用多个幅度和相位层级。它效率更高，但对噪声、IQ 失衡和线性度更敏感。", "16QAM 的 I/Q 分量有四个电平，EVM 会比 QPSK 更敏感。"],
    tone: ["复数单音：最纯粹的旋转向量", "复数单音是理解频偏最好的入口：频率就是复数相量每秒旋转的圈数。", "如果存在频偏，I 和 Q 会像正弦/余弦一样持续交替。"]
  };
  const copy = descriptions[latest.mode];
  outputs.lessonTitle.textContent = copy[0];
  outputs.lessonText.textContent = copy[1];
  outputs.sourceHint.textContent = copy[1];
  outputs.waveNote.textContent = copy[2];
  updateRanges();
  updateDiagnosis();
}

function updateRanges() {
  outputs.waveRange.textContent = `${chartViews.wave.xMin.toFixed(1)} - ${chartViews.wave.xMax.toFixed(1)} sym | ${chartViews.wave.yMin.toFixed(1)} - ${chartViews.wave.yMax.toFixed(1)}`;
}

function updateDiagnosis() {
  const rows = [
    {
      name: "频偏",
      text: Math.abs(latest.freqOffset) < 50 ? "本振基本对准，星座不会明显持续旋转。" : `本振差了 ${formatHz(latest.freqOffset)}，星座会随时间旋转，解调前需要频率同步。`,
      warn: Math.abs(latest.freqOffset) > latest.symbolRate * 0.2
    },
    {
      name: "相位",
      text: Math.abs(latest.phase) < 0.08 ? "相位偏差很小，判决边界压力不大。" : `整体相位转了 ${(latest.phase * 180 / Math.PI).toFixed(0)}°，PSK 调制会特别敏感。`,
      warn: Math.abs(latest.phase) > 0.45
    },
    {
      name: "I/Q 失衡",
      text: Math.abs(latest.gainImbalance) < 0.04 && Math.abs(latest.quadError) < 0.05 ? "I/Q 幅度和正交性接近理想。" : "幅度或正交误差会让星座拉伸，并产生镜像分量。",
      warn: Math.abs(latest.gainImbalance) > 0.16 || Math.abs(latest.quadError) > 0.18
    },
    {
      name: "EVM",
      text: latest.evm < 12 ? "星座质量不错，可以进入判决。" : latest.evm < 28 ? "星座已经发散，建议先校正频偏、相偏和增益。" : "EVM 偏高，后续误码率会明显上升。",
      warn: latest.evm >= 28
    }
  ];
  outputs.diagnosis.innerHTML = rows.map(row => `
    <article>
      <strong${row.warn ? " class=\"warning-text\"" : ""}>${row.name}</strong>
      <span${row.warn ? " class=\"warning-text\"" : ""}>${row.text}</span>
    </article>
  `).join("");
}

function render() {
  latest = generateData();
  resetView("wave", false, true);
  resetView("plane", false, true);
  resetView("spectrum", false, true);
  updateCopy();
  renderCharts();
}

function syncPair(range, input) {
  const value = clamp(Number(input.value) || 0, Number(range.min), Number(range.max));
  range.value = String(value);
  input.value = String(value);
  render();
}

const defaults = {
  mode: "qpsk",
  symbolRate: "2000",
  samplesPerSymbol: "16",
  carrier: "24000",
  freqOffset: "320",
  phase: "18",
  gainImbalance: "8",
  quadError: "5",
  dcOffset: "4",
  snr: "18"
};

function applyValues(values) {
  Object.entries(values).forEach(([key, value]) => {
    controls[key].value = value;
    if (controls[`${key}Input`]) controls[`${key}Input`].value = value;
  });
  render();
}

["mode", "samplesPerSymbol", "gainImbalance", "quadError", "dcOffset"].forEach(key => {
  controls[key].addEventListener("input", render);
  controls[key].addEventListener("change", render);
});

[
  [controls.symbolRate, controls.symbolRateInput],
  [controls.carrier, controls.carrierInput],
  [controls.freqOffset, controls.freqOffsetInput],
  [controls.phase, controls.phaseInput],
  [controls.snr, controls.snrInput]
].forEach(([range, input]) => {
  range.addEventListener("input", () => {
    input.value = range.value;
    render();
  });
  input.addEventListener("input", () => {
    if (input.value !== "") syncPair(range, input);
  });
  input.addEventListener("change", () => syncPair(range, input));
});

document.querySelector("#resetStage4").addEventListener("click", () => applyValues(defaults));

document.querySelectorAll("[data-iq-chart]").forEach(button => {
  button.addEventListener("click", () => {
    const kind = button.dataset.iqChart;
    const action = button.dataset.action;
    if (action === "zoom-in") zoomView(kind, "x", 0.65);
    if (action === "zoom-out") zoomView(kind, "x", 1.5);
    if (action === "y-in") zoomView(kind, "y", 0.65);
    if (action === "y-out") zoomView(kind, "y", 1.5);
    if (action === "auto") resetView(kind, true);
    if (action === "reset") resetView(kind, false);
  });
});

document.querySelectorAll("[data-iq-preset]").forEach(button => {
  button.addEventListener("click", () => {
    const preset = button.dataset.iqPreset;
    if (preset === "downconvert") applyValues({ mode: "qpsk", freqOffset: "0", phase: "0", gainImbalance: "0", quadError: "0", dcOffset: "0", snr: "24" });
    if (preset === "offset") applyValues({ mode: "tone", freqOffset: "1200", phase: "0", gainImbalance: "0", quadError: "0", dcOffset: "0", snr: "30" });
    if (preset === "imbalance") applyValues({ mode: "qpsk", freqOffset: "0", phase: "8", gainImbalance: "22", quadError: "14", dcOffset: "8", snr: "24" });
    if (preset === "qam") applyValues({ mode: "qam16", symbolRate: "4000", freqOffset: "120", phase: "10", gainImbalance: "6", quadError: "4", dcOffset: "2", snr: "22" });
  });
});

attachChart("wave", canvases.wave, outputs.waveCursor);
attachChart("plane", canvases.plane, outputs.planeCursor);
attachChart("spectrum", canvases.spectrum, outputs.spectrumCursor);

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderCharts, 100);
});

render();
