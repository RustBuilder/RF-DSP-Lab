"use strict";

const PADDING = { left: 58, right: 18, top: 18, bottom: 34 };
const MAX_SAMPLES = 20000;
const FFT_SIZE = 2048;

const controls = {
  source: document.querySelector("#measurementSource"),
  file: document.querySelector("#signalFile"),
  sampleRate: document.querySelector("#measureSampleRate"),
  sampleRateInput: document.querySelector("#measureSampleRateInput"),
  duration: document.querySelector("#duration"),
  noise: document.querySelector("#measureNoise"),
  occupiedPower: document.querySelector("#occupiedPower"),
  threshold: document.querySelector("#activityThreshold"),
  window: document.querySelector("#measureWindow")
};

const outputs = {
  sampleRate: document.querySelector("#measureSampleRateValue"),
  duration: document.querySelector("#durationValue"),
  noise: document.querySelector("#measureNoiseValue"),
  occupiedPower: document.querySelector("#occupiedPowerValue"),
  threshold: document.querySelector("#activityThresholdValue"),
  fileStatus: document.querySelector("#fileStatus"),
  peak: document.querySelector("#peakFrequencyMetric"),
  bandwidth: document.querySelector("#occupiedBandwidthMetric"),
  snr: document.querySelector("#snrMetric"),
  duty: document.querySelector("#dutyMetric"),
  title: document.querySelector("#measurementTitle"),
  text: document.querySelector("#measurementText"),
  timeBadge: document.querySelector("#timeBadge"),
  spectrumBadge: document.querySelector("#spectrumBadge"),
  waterfallBadge: document.querySelector("#waterfallBadge"),
  reportBadge: document.querySelector("#reportBadge"),
  report: document.querySelector("#measurementReport"),
  timeCursor: document.querySelector("#timeCursor"),
  spectrumCursor: document.querySelector("#spectrumCursor"),
  waterfallCursor: document.querySelector("#waterfallCursor"),
  timeRange: document.querySelector("#timeRange"),
  spectrumRange: document.querySelector("#spectrumRange"),
  timeNote: document.querySelector("#timeNote")
};

const elements = {
  fileGroup: document.querySelector("#fileGroup")
};

const canvases = {
  time: document.querySelector("#measureTimeCanvas"),
  spectrum: document.querySelector("#measureSpectrumCanvas"),
  waterfall: document.querySelector("#measureWaterfallCanvas")
};

const chartViews = {
  time: { xMin: 0, xMax: 0.12, yMin: -1.5, yMax: 1.5 },
  spectrum: { xMin: 0, xMax: 48000, yMin: -88, yMax: 6 },
  waterfall: { xMin: 0, xMax: 0.12, yMin: 0, yMax: 48000 }
};

let latest = null;
let imported = null;
let randomState = 0x5135a1f0;

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
  if (abs >= 1000) return `${(value / 1000).toFixed(abs % 1000 ? 2 : 0)} k${suffix}`;
  return `${value.toFixed(0)} ${suffix}`;
}

function formatHz(value) {
  const abs = Math.abs(value);
  if (abs >= 1000) return `${(value / 1000).toFixed(abs % 1000 ? 2 : 0)} kHz`;
  return `${value.toFixed(0)} Hz`;
}

function magnitude(sample) {
  return Math.hypot(sample.i, sample.q);
}

function windowValue(index, length, kind) {
  if (kind === "rect") return 1;
  if (kind === "blackman") return 0.42 - 0.5 * Math.cos(2 * Math.PI * index / (length - 1)) + 0.08 * Math.cos(4 * Math.PI * index / (length - 1));
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (length - 1));
}

function makeSample(i, q = 0) {
  return { i, q };
}

function generateBuiltInSignal() {
  randomState = 0x5135a1f0;
  const sampleRate = Number(controls.sampleRate.value);
  const duration = Number(controls.duration.value) / 1000;
  const count = Math.min(MAX_SAMPLES, Math.max(512, Math.floor(sampleRate * duration)));
  const source = controls.source.value;
  const noise = Number(controls.noise.value) / 100;
  const samples = [];
  const meta = {
    source,
    complex: source === "iq",
    fileName: null,
    sampleRate,
    note: ""
  };

  for (let n = 0; n < count; n += 1) {
    const t = n / sampleRate;
    let i = 0;
    let q = 0;
    if (source === "fm") {
      const carrier = 24000;
      const message = 850;
      const deviation = 1800;
      const phase = 2 * Math.PI * carrier * t - (deviation / message) * Math.cos(2 * Math.PI * message * t);
      i = Math.cos(phase);
      meta.note = "窄带 FM：峰值接近载波，占用带宽会随频偏扩展。";
    }
    if (source === "ook") {
      const carrier = 18000;
      const slot = Math.floor(t * 900) % 8;
      const gate = [1, 1, 0, 1, 0, 0, 1, 0][slot];
      const edge = 0.5 + 0.5 * Math.sin(2 * Math.PI * 900 * t);
      const envelope = gate ? 0.65 + 0.35 * edge : 0.02;
      i = envelope * Math.cos(2 * Math.PI * carrier * t);
      meta.note = "OOK 脉冲：适合练习占空比、包络门限和突发信号测量。";
    }
    if (source === "chirp") {
      const period = 0.035;
      const local = (t % period) / period;
      const gate = local < 0.62 ? 1 : 0;
      const f0 = 9000;
      const f1 = 36000;
      const chirpTime = Math.min(local, 0.62) / 0.62 * period;
      const slope = (f1 - f0) / (period * 0.62);
      const phase = 2 * Math.PI * (f0 * chirpTime + 0.5 * slope * chirpTime * chirpTime);
      i = gate * Math.cos(phase);
      meta.note = "扫频脉冲：整段 FFT 会变宽，瀑布图能显示频率随时间上升。";
    }
    if (source === "iq") {
      const symbolRate = 2400;
      const sps = Math.max(4, Math.floor(sampleRate / symbolRate));
      const symbolIndex = Math.floor(n / sps);
      const symbols = [
        { i: 1, q: 1 },
        { i: -1, q: 1 },
        { i: -1, q: -1 },
        { i: 1, q: -1 }
      ];
      const base = symbols[(symbolIndex * 5 + 1) % symbols.length];
      const offset = 2600;
      const angle = 2 * Math.PI * offset * t;
      i = (base.i * Math.cos(angle) - base.q * Math.sin(angle)) / Math.SQRT2;
      q = (base.i * Math.sin(angle) + base.q * Math.cos(angle)) / Math.SQRT2;
      meta.note = "复数 IQ：频谱允许正负频率，峰值偏离 0 Hz 表示残余频偏。";
    }
    samples.push(makeSample(i + noise * gaussian(), q + (meta.complex ? noise * gaussian() : 0)));
  }

  return { samples, sampleRate, complex: meta.complex, meta };
}

function getCurrentSignal() {
  if (controls.source.value === "file" && imported) return imported;
  return generateBuiltInSignal();
}

function computeSpectrum(samples, sampleRate, complex, windowKind) {
  const length = Math.min(FFT_SIZE, samples.length);
  const start = Math.max(0, Math.floor((samples.length - length) / 2));
  const bins = [];
  for (let k = 0; k < length; k += 1) {
    let real = 0;
    let imag = 0;
    for (let n = 0; n < length; n += 1) {
      const sample = samples[start + n];
      const w = windowValue(n, length, windowKind);
      const angle = -2 * Math.PI * k * n / length;
      real += (sample.i * Math.cos(angle) - sample.q * Math.sin(angle)) * w;
      imag += (sample.i * Math.sin(angle) + sample.q * Math.cos(angle)) * w;
    }
    const shifted = k < length / 2 ? k + length / 2 : k - length / 2;
    const frequency = (shifted - length / 2) * sampleRate / length;
    if (!complex && frequency < 0) continue;
    const power = Math.max(1e-14, (real * real + imag * imag) / (length * length));
    bins.push({ frequency, power, db: 10 * Math.log10(power) + 42 });
  }
  return bins.sort((a, b) => a.frequency - b.frequency);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.floor((sorted.length - 1) * p), 0, sorted.length - 1);
  return sorted[index];
}

function measureSpectrum(spectrum, occupiedPercent) {
  const nonDc = spectrum.filter(bin => Math.abs(bin.frequency) > 1);
  const peak = nonDc.reduce((best, bin) => bin.power > best.power ? bin : best, nonDc[0] || spectrum[0]);
  const totalPower = spectrum.reduce((sum, bin) => sum + bin.power, 0);
  const tail = (1 - occupiedPercent / 100) / 2;
  let cumulative = 0;
  let low = spectrum[0].frequency;
  let high = spectrum[spectrum.length - 1].frequency;
  for (const bin of spectrum) {
    cumulative += bin.power;
    if (cumulative >= totalPower * tail) {
      low = bin.frequency;
      break;
    }
  }
  cumulative = 0;
  for (let index = spectrum.length - 1; index >= 0; index -= 1) {
    cumulative += spectrum[index].power;
    if (cumulative >= totalPower * tail) {
      high = spectrum[index].frequency;
      break;
    }
  }

  const noiseFloor = percentile(spectrum.map(bin => bin.db), 0.25);
  const inBand = spectrum.filter(bin => bin.frequency >= low && bin.frequency <= high);
  const signalDb = percentile(inBand.map(bin => bin.db), 0.8);
  return {
    peakFrequency: peak.frequency,
    peakDb: peak.db,
    low,
    high,
    bandwidth: Math.max(0, high - low),
    noiseFloor,
    snr: Math.max(0, signalDb - noiseFloor)
  };
}

function measureEnvelope(samples, sampleRate, thresholdPercent, complex) {
  const envelope = complex ? samples.map(magnitude) : realEnvelope(samples, sampleRate);
  const max = Math.max(...envelope, 1e-9);
  const threshold = max * thresholdPercent / 100;
  const active = envelope.filter(value => value >= threshold).length;
  const duty = active / envelope.length;
  const activityRate = estimateActivityRate(envelope, sampleRate);
  return { envelope, threshold, duty, activityRate };
}

function realEnvelope(samples, sampleRate) {
  const radius = Math.max(4, Math.floor(sampleRate / 2500));
  const squared = samples.map(sample => sample.i * sample.i);
  const prefix = [0];
  squared.forEach(value => prefix.push(prefix[prefix.length - 1] + value));
  return samples.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(samples.length, index + radius + 1);
    const mean = (prefix[end] - prefix[start]) / Math.max(1, end - start);
    return Math.sqrt(mean) * Math.SQRT2;
  });
}

function estimateActivityRate(envelope, sampleRate) {
  const length = Math.min(1024, envelope.length);
  const mean = envelope.slice(0, length).reduce((sum, value) => sum + value, 0) / length;
  let bestFrequency = 0;
  let bestPower = 0;
  const minBin = Math.max(1, Math.floor(20 * length / sampleRate));
  const maxBin = Math.min(Math.floor(6000 * length / sampleRate), Math.floor(length / 2) - 1);
  for (let k = minBin; k <= maxBin; k += 1) {
    let real = 0;
    let imag = 0;
    for (let n = 0; n < length; n += 1) {
      const value = envelope[n] - mean;
      const angle = -2 * Math.PI * k * n / length;
      real += value * Math.cos(angle);
      imag += value * Math.sin(angle);
    }
    const power = real * real + imag * imag;
    if (power > bestPower) {
      bestPower = power;
      bestFrequency = k * sampleRate / length;
    }
  }
  return bestFrequency;
}

function computeWaterfall(samples, sampleRate, complex, windowKind) {
  const frameSize = 256;
  const hop = 96;
  const frames = [];
  for (let start = 0; start + frameSize <= samples.length && frames.length < 90; start += hop) {
    const bins = [];
    const maxBin = complex ? frameSize : Math.floor(frameSize / 2);
    for (let k = 0; k < maxBin; k += 2) {
      const rawK = complex ? k : k;
      let real = 0;
      let imag = 0;
      for (let n = 0; n < frameSize; n += 1) {
        const sample = samples[start + n];
        const w = windowValue(n, frameSize, windowKind);
        const angle = -2 * Math.PI * rawK * n / frameSize;
        real += (sample.i * Math.cos(angle) - sample.q * Math.sin(angle)) * w;
        imag += (sample.i * Math.sin(angle) + sample.q * Math.cos(angle)) * w;
      }
      const shifted = complex && rawK < frameSize / 2 ? rawK + frameSize / 2 : rawK;
      const frequency = complex ? (shifted - frameSize / 2) * sampleRate / frameSize : rawK * sampleRate / frameSize;
      const db = 10 * Math.log10(Math.max(1e-14, (real * real + imag * imag) / (frameSize * frameSize))) + 42;
      bins.push({ frequency, db });
    }
    frames.push({ time: (start + frameSize / 2) / sampleRate, bins });
  }
  return frames;
}

function analyze() {
  const signal = getCurrentSignal();
  const sampleRate = signal.sampleRate;
  const spectrum = computeSpectrum(signal.samples, sampleRate, signal.complex, controls.window.value);
  const measurement = measureSpectrum(spectrum, Number(controls.occupiedPower.value));
  const envelope = measureEnvelope(signal.samples, sampleRate, Number(controls.threshold.value), signal.complex);
  const waterfall = computeWaterfall(signal.samples, sampleRate, signal.complex, controls.window.value);
  latest = {
    ...signal,
    spectrum,
    measurement,
    envelope,
    waterfall,
    duration: signal.samples.length / sampleRate
  };
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
  for (let index = 0; index <= 5; index += 1) {
    const value = view.xMin + (view.xMax - view.xMin) * index / 5;
    const x = xToPixel(value, view, area);
    ctx.beginPath();
    ctx.moveTo(x, area.top);
    ctx.lineTo(x, area.bottom);
    ctx.stroke();
    ctx.fillText(options.formatX ? options.formatX(value) : value.toFixed(1), x, area.bottom + 8);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let index = 0; index <= 4; index += 1) {
    const value = view.yMin + (view.yMax - view.yMin) * index / 4;
    const y = yToPixel(value, view, area);
    ctx.beginPath();
    ctx.moveTo(area.left, y);
    ctx.lineTo(area.right, y);
    ctx.stroke();
    ctx.fillText(options.formatY ? options.formatY(value) : value.toFixed(0), area.left - 8, y);
  }
}

function drawLine(ctx, points, view, area, color, mapX, mapY) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.7;
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

function drawTime() {
  const { ctx, width, height } = setupCanvas(canvases.time);
  const area = plotArea(width, height);
  const view = chartViews.time;
  clearChart(ctx, width, height);
  drawAxes(ctx, area, view, {
    formatX: value => `${(value * 1000).toFixed(0)}ms`,
    formatY: value => value.toFixed(1)
  });
  const points = latest.samples.map((sample, index) => ({ time: index / latest.sampleRate, value: sample.i, envelope: latest.envelope.envelope[index] }));
  drawLine(ctx, points, view, area, "#45e8d4", point => point.time, point => point.value);
  drawLine(ctx, points, view, area, "#b7ff3c", point => point.time, point => point.envelope);
  const y = yToPixel(latest.envelope.threshold, view, area);
  ctx.strokeStyle = "rgba(255, 159, 67, 0.8)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(area.left, y);
  ctx.lineTo(area.right, y);
  ctx.stroke();
  ctx.setLineDash([]);
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
  drawLine(ctx, latest.spectrum, view, area, "#b7ff3c", bin => bin.frequency, bin => bin.db);
  drawVerticalMarker(ctx, area, view, latest.measurement.low, "rgba(69, 232, 212, 0.75)");
  drawVerticalMarker(ctx, area, view, latest.measurement.high, "rgba(69, 232, 212, 0.75)");
  drawVerticalMarker(ctx, area, view, latest.measurement.peakFrequency, "rgba(255, 159, 67, 0.9)");
}

function drawVerticalMarker(ctx, area, view, value, color) {
  if (value < view.xMin || value > view.xMax) return;
  const x = xToPixel(value, view, area);
  ctx.strokeStyle = color;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(x, area.top);
  ctx.lineTo(x, area.bottom);
  ctx.stroke();
  ctx.setLineDash([]);
}

function heatColor(value) {
  const x = clamp(value, 0, 1);
  const r = Math.round(10 + 220 * Math.max(0, x - 0.45) / 0.55);
  const g = Math.round(24 + 231 * x);
  const b = Math.round(22 + 190 * (1 - Math.abs(x - 0.45)));
  return `rgb(${r}, ${g}, ${b})`;
}

function drawWaterfall() {
  const { ctx, width, height } = setupCanvas(canvases.waterfall);
  const area = plotArea(width, height);
  const view = chartViews.waterfall;
  clearChart(ctx, width, height);
  drawAxes(ctx, area, view, {
    formatX: value => `${(value * 1000).toFixed(0)}ms`,
    formatY: value => formatHz(value)
  });
  const allDb = latest.waterfall.flatMap(frame => frame.bins.map(bin => bin.db));
  const minDb = percentile(allDb, 0.08);
  const maxDb = percentile(allDb, 0.98);
  latest.waterfall.forEach((frame, frameIndex) => {
    const nextFrame = latest.waterfall[frameIndex + 1] || frame;
    const x = xToPixel(frame.time, view, area);
    const nextX = xToPixel(nextFrame.time, view, area);
    frame.bins.forEach((bin, binIndex) => {
      if (bin.frequency < view.yMin || bin.frequency > view.yMax) return;
      const nextBin = frame.bins[binIndex + 1] || bin;
      const y = yToPixel(bin.frequency, { yMin: view.yMin, yMax: view.yMax }, area);
      const nextY = yToPixel(nextBin.frequency, { yMin: view.yMin, yMax: view.yMax }, area);
      const intensity = (bin.db - minDb) / Math.max(1e-9, maxDb - minDb);
      ctx.fillStyle = heatColor(intensity);
      ctx.fillRect(x, Math.min(y, nextY), Math.max(1, nextX - x + 1), Math.max(1, Math.abs(nextY - y) + 1));
    });
  });
}

function renderCharts() {
  if (!latest) return;
  drawTime();
  drawSpectrum();
  drawWaterfall();
}

function resetView(kind, auto = false) {
  if (kind === "time") {
    chartViews.time.xMin = 0;
    chartViews.time.xMax = auto ? latest.duration : Math.min(latest.duration, 0.12);
    const max = Math.max(1, percentile(latest.envelope.envelope, 0.98) * 1.25);
    chartViews.time.yMin = -max;
    chartViews.time.yMax = max;
  }
  if (kind === "spectrum") {
    const margin = Math.max(latest.measurement.bandwidth, latest.sampleRate * 0.08, 1000);
    chartViews.spectrum.xMin = auto ? latest.measurement.peakFrequency - margin : (latest.complex ? -latest.sampleRate / 2 : 0);
    chartViews.spectrum.xMax = auto ? latest.measurement.peakFrequency + margin : latest.sampleRate / 2;
    chartViews.spectrum.yMin = Math.floor(latest.measurement.noiseFloor - 18);
    chartViews.spectrum.yMax = Math.ceil(latest.measurement.peakDb + 6);
  }
  if (kind === "waterfall") {
    chartViews.waterfall.xMin = 0;
    chartViews.waterfall.xMax = latest.duration;
    chartViews.waterfall.yMin = latest.complex ? -latest.sampleRate / 2 : 0;
    chartViews.waterfall.yMax = latest.sampleRate / 2;
  }
  updateRanges();
  renderCharts();
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
    if (kind === "time") cursor.textContent = `${(x * 1000).toFixed(2)} ms | ${y.toFixed(2)}`;
    if (kind === "spectrum") cursor.textContent = `${formatHz(x)} | ${y.toFixed(1)} dB`;
    if (kind === "waterfall") cursor.textContent = `${(x * 1000).toFixed(1)} ms | ${formatHz(y)}`;
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

function updateRanges() {
  outputs.timeRange.textContent = `${(chartViews.time.xMin * 1000).toFixed(1)} - ${(chartViews.time.xMax * 1000).toFixed(1)} ms | ${chartViews.time.yMin.toFixed(1)} - ${chartViews.time.yMax.toFixed(1)}`;
  outputs.spectrumRange.textContent = `${formatHz(chartViews.spectrum.xMin)} - ${formatHz(chartViews.spectrum.xMax)} | ${chartViews.spectrum.yMin.toFixed(0)} - ${chartViews.spectrum.yMax.toFixed(0)} dB`;
}

function updateCopy() {
  outputs.sampleRate.textContent = formatRate(Number(controls.sampleRate.value), "Sa/s");
  outputs.duration.textContent = `${controls.duration.value} ms`;
  outputs.noise.textContent = `${controls.noise.value}%`;
  outputs.occupiedPower.textContent = `${controls.occupiedPower.value}%`;
  outputs.threshold.textContent = `${controls.threshold.value}%`;
  outputs.peak.textContent = formatHz(latest.measurement.peakFrequency);
  outputs.bandwidth.textContent = formatHz(latest.measurement.bandwidth);
  outputs.snr.textContent = `${latest.measurement.snr.toFixed(1)} dB`;
  outputs.duty.textContent = `${(latest.envelope.duty * 100).toFixed(1)}%`;
  outputs.timeBadge.textContent = `0 - ${(latest.duration * 1000).toFixed(0)} ms`;
  outputs.spectrumBadge.textContent = `${controls.occupiedPower.value}% OBW`;
  outputs.waterfallBadge.textContent = latest.complex ? "复数频谱" : "实数频谱";
  outputs.title.textContent = titleForSource(latest.meta.source);
  outputs.text.textContent = latest.meta.note;
  outputs.timeNote.textContent = latest.envelope.activityRate > 0
    ? `包络主活动频率约 ${formatHz(latest.envelope.activityRate)}，可作为突发重复率或符号率线索。`
    : "包络超过活动门限的比例，就是占空比的第一版估计。";
  outputs.report.textContent = buildReport();
}

function titleForSource(source) {
  if (source === "ook") return "突发信号先看占空比。";
  if (source === "chirp") return "扫频信号必须看时间。";
  if (source === "iq") return "IQ 文件要保留正负频率。";
  if (source === "file") return "导入文件后先核对采样率。";
  return "先找峰值，再量带宽。";
}

function buildReport() {
  return [
    "RF DSP Lab / 阶段 5 测量报告",
    "--------------------------------",
    `来源: ${latest.meta.fileName || latest.meta.source}`,
    `采样率: ${formatRate(latest.sampleRate, "Sa/s")}`,
    `样本数: ${latest.samples.length}`,
    `观测时长: ${(latest.duration * 1000).toFixed(2)} ms`,
    `数据类型: ${latest.complex ? "复数 IQ" : "实数信号"}`,
    "",
    `峰值频率: ${formatHz(latest.measurement.peakFrequency)}`,
    `${controls.occupiedPower.value}% 占用带宽: ${formatHz(latest.measurement.bandwidth)}`,
    `带宽边界: ${formatHz(latest.measurement.low)} 到 ${formatHz(latest.measurement.high)}`,
    `噪声底估计: ${latest.measurement.noiseFloor.toFixed(1)} dB`,
    `SNR 估计: ${latest.measurement.snr.toFixed(1)} dB`,
    `占空比: ${(latest.envelope.duty * 100).toFixed(1)}%`,
    `包络活动频率线索: ${formatHz(latest.envelope.activityRate)}`,
    "",
    `备注: ${latest.meta.note}`
  ].join("\n");
}

function render() {
  elements.fileGroup.hidden = controls.source.value !== "file";
  analyze();
  resetView("time", false);
  resetView("spectrum", false);
  resetView("waterfall", false);
  updateCopy();
  renderCharts();
}

function syncPair(range, input) {
  const value = clamp(Number(input.value) || 0, Number(range.min), Number(range.max));
  range.value = String(value);
  input.value = String(value);
  render();
}

function applyValues(values) {
  Object.entries(values).forEach(([key, value]) => {
    controls[key].value = value;
    if (controls[`${key}Input`]) controls[`${key}Input`].value = value;
  });
  render();
}

function parseCsv(text, sampleRate, fileName) {
  const rows = text.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith("#"))
    .map(line => line.split(/[,\s;]+/).map(Number).filter(Number.isFinite))
    .filter(row => row.length > 0)
    .slice(0, MAX_SAMPLES);
  if (!rows.length) throw new Error("没有读到数值样本");
  const complex = rows[0].length >= 2;
  const samples = rows.map(row => {
    if (row.length >= 3) return makeSample(row[1], row[2]);
    if (row.length >= 2) return makeSample(row[0], row[1]);
    return makeSample(row[0], 0);
  });
  return {
    samples: normalizeSamples(samples),
    sampleRate,
    complex,
    meta: { source: "file", complex, fileName, note: "CSV/TXT 已导入。若文件没有时间列，请确认左侧采样率设置正确。" }
  };
}

function parseWav(buffer, fileName) {
  const view = new DataView(buffer);
  if (readString(view, 0, 4) !== "RIFF" || readString(view, 8, 4) !== "WAVE") {
    throw new Error("不是标准 WAV 文件");
  }
  let offset = 12;
  let fmt = null;
  let dataOffset = 0;
  let dataSize = 0;
  while (offset + 8 <= view.byteLength) {
    const id = readString(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt ") {
      fmt = {
        audioFormat: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true)
      };
    }
    if (id === "data") {
      dataOffset = offset + 8;
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || !dataOffset) throw new Error("WAV 缺少 fmt 或 data 块");
  const bytesPerSample = fmt.bitsPerSample / 8;
  const frameSize = bytesPerSample * fmt.channels;
  const frames = Math.min(MAX_SAMPLES, Math.floor(dataSize / frameSize));
  const samples = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const base = dataOffset + frame * frameSize;
    const left = readPcm(view, base, fmt.bitsPerSample, fmt.audioFormat);
    const right = fmt.channels > 1 ? readPcm(view, base + bytesPerSample, fmt.bitsPerSample, fmt.audioFormat) : 0;
    samples.push(makeSample(left, fmt.channels > 1 ? right : 0));
  }
  const complex = fmt.channels > 1;
  return {
    samples: normalizeSamples(samples),
    sampleRate: fmt.sampleRate,
    complex,
    meta: { source: "file", complex, fileName, note: `WAV 已导入：${fmt.channels} 声道，${fmt.bitsPerSample} bit。双声道按 I/Q 分析。` }
  };
}

function readString(view, offset, length) {
  return Array.from({ length }, (_, index) => String.fromCharCode(view.getUint8(offset + index))).join("");
}

function readPcm(view, offset, bits, format) {
  if (format === 3 && bits === 32) return view.getFloat32(offset, true);
  if (bits === 8) return (view.getUint8(offset) - 128) / 128;
  if (bits === 16) return view.getInt16(offset, true) / 32768;
  if (bits === 24) {
    let value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getUint8(offset + 2) << 16);
    if (value & 0x800000) value |= 0xff000000;
    return value / 8388608;
  }
  if (bits === 32) return view.getInt32(offset, true) / 2147483648;
  return 0;
}

function normalizeSamples(samples) {
  const peak = Math.max(1e-9, ...samples.map(magnitude));
  return samples.map(sample => makeSample(sample.i / peak, sample.q / peak));
}

async function handleFile(file) {
  if (!file) return;
  try {
    if (file.name.toLowerCase().endsWith(".wav")) {
      imported = parseWav(await file.arrayBuffer(), file.name);
      controls.sampleRate.value = String(imported.sampleRate);
      controls.sampleRateInput.value = String(imported.sampleRate);
    } else {
      imported = parseCsv(await file.text(), Number(controls.sampleRate.value), file.name);
    }
    outputs.fileStatus.textContent = `已导入 ${file.name}，样本 ${imported.samples.length} 点。`;
    controls.source.value = "file";
    render();
  } catch (error) {
    outputs.fileStatus.textContent = `导入失败：${error.message}`;
  }
}

[
  [controls.sampleRate, controls.sampleRateInput]
].forEach(([range, input]) => {
  range.addEventListener("input", () => {
    input.value = range.value;
    if (controls.source.value === "file" && imported) imported.sampleRate = Number(range.value);
    render();
  });
  input.addEventListener("input", () => {
    if (input.value !== "") syncPair(range, input);
  });
  input.addEventListener("change", () => syncPair(range, input));
});

["source", "duration", "noise", "occupiedPower", "threshold", "window"].forEach(key => {
  controls[key].addEventListener("input", render);
  controls[key].addEventListener("change", render);
});

controls.file.addEventListener("change", () => handleFile(controls.file.files[0]));

document.querySelector("#resetStage5").addEventListener("click", () => {
  imported = null;
  controls.file.value = "";
  outputs.fileStatus.textContent = "当前使用内置信号，可先练测量流程。";
  applyValues({ source: "fm", sampleRate: "96000", duration: "120", noise: "8", occupiedPower: "99", threshold: "35", window: "hann" });
});

document.querySelector("#copyReport").addEventListener("click", async () => {
  const text = outputs.report.textContent;
  try {
    await navigator.clipboard.writeText(text);
    outputs.reportBadge.textContent = "已复制";
  } catch {
    outputs.reportBadge.textContent = "复制受限";
  }
  setTimeout(() => {
    outputs.reportBadge.textContent = "可复制";
  }, 1400);
});

document.querySelectorAll("[data-measure-chart]").forEach(button => {
  button.addEventListener("click", () => {
    const kind = button.dataset.measureChart;
    const action = button.dataset.action;
    if (action === "zoom-in") zoomView(kind, "x", 0.65);
    if (action === "zoom-out") zoomView(kind, "x", 1.5);
    if (action === "y-in") zoomView(kind, "y", 0.65);
    if (action === "y-out") zoomView(kind, "y", 1.5);
    if (action === "auto") resetView(kind, true);
    if (action === "reset") resetView(kind, false);
  });
});

document.querySelectorAll("[data-measure-preset]").forEach(button => {
  button.addEventListener("click", () => {
    const preset = button.dataset.measurePreset;
    if (preset === "carrier") applyValues({ source: "fm", occupiedPower: "99", threshold: "35", noise: "5", window: "hann" });
    if (preset === "obw") applyValues({ source: "fm", occupiedPower: controls.occupiedPower.value === "99" ? "90" : "99", noise: "8", window: "blackman" });
    if (preset === "duty") applyValues({ source: "ook", occupiedPower: "96", threshold: "55", noise: "10", window: "hann" });
    if (preset === "chirp") applyValues({ source: "chirp", occupiedPower: "98", threshold: "28", noise: "6", window: "hann" });
  });
});

attachChart("time", canvases.time, outputs.timeCursor);
attachChart("spectrum", canvases.spectrum, outputs.spectrumCursor);
attachChart("waterfall", canvases.waterfall, outputs.waterfallCursor);

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderCharts, 100);
});

render();
