"use strict";

const SIGNAL_SIZE = 8192;
const MAX_FREQUENCY = 20000;
const SAMPLE_RATES = [4096, 8000, 16000, 32000, 44100, 48000, 96000];
const PADDING = { left: 62, right: 20, top: 18, bottom: 38 };

const controls = {
  mode: document.querySelector("#experimentMode"),
  signalKind: document.querySelector("#signalKind"),
  carrier: document.querySelector("#carrier"),
  carrierInput: document.querySelector("#carrierInput"),
  message: document.querySelector("#message"),
  messageInput: document.querySelector("#messageInput"),
  depth: document.querySelector("#depth"),
  deviation: document.querySelector("#deviation"),
  deviationInput: document.querySelector("#deviationInput"),
  noise: document.querySelector("#stageNoise"),
  sampleRate: document.querySelector("#stageSampleRate"),
  stftSize: document.querySelector("#stftSize"),
  overlap: document.querySelector("#overlap")
};

const outputs = {
  carrier: document.querySelector("#carrierValue"),
  message: document.querySelector("#messageValue"),
  depth: document.querySelector("#depthValue"),
  deviation: document.querySelector("#deviationValue"),
  noise: document.querySelector("#stageNoiseValue"),
  sampleRate: document.querySelector("#stageSampleRateValue"),
  overlap: document.querySelector("#overlapValue"),
  timeResolution: document.querySelector("#timeResolution"),
  frequencyResolution: document.querySelector("#frequencyResolution"),
  hint: document.querySelector("#resolutionHint"),
  metricOneLabel: document.querySelector("#metricOneLabel"),
  metricOneValue: document.querySelector("#metricOneValue"),
  metricTwoLabel: document.querySelector("#metricTwoLabel"),
  metricTwoValue: document.querySelector("#metricTwoValue"),
  metricThreeLabel: document.querySelector("#metricThreeLabel"),
  metricFourLabel: document.querySelector("#metricFourLabel"),
  stftBadge: document.querySelector("#stftBadge"),
  peakBadge: document.querySelector("#peakBadge"),
  timeViewBadge: document.querySelector("#timeViewBadge"),
  timeCursor: document.querySelector("#stageTimeCursor"),
  spectrogramCursor: document.querySelector("#spectrogramCursor"),
  spectrumCursor: document.querySelector("#stageSpectrumCursor"),
  timeRange: document.querySelector("#stageTimeRange"),
  spectrogramRange: document.querySelector("#spectrogramRange"),
  spectrumRange: document.querySelector("#stageSpectrumRange"),
  referenceLegend: document.querySelector("#referenceLegend"),
  signalLegend: document.querySelector("#signalLegend")
};

const groups = {
  signalKind: document.querySelector("#signalKindGroup"),
  carrier: document.querySelector("#carrierGroup"),
  message: document.querySelector("#messageGroup"),
  depth: document.querySelector("#depthGroup"),
  deviation: document.querySelector("#deviationGroup")
};

const canvases = {
  time: document.querySelector("#stageTimeCanvas"),
  spectrogram: document.querySelector("#spectrogramCanvas"),
  spectrum: document.querySelector("#stageSpectrumCanvas")
};

const chartViews = {
  time: { xMin: 0, xMax: 0.08, yMin: -2.2, yMax: 2.2, autoY: false, followSignal: true, cursor: null },
  spectrogram: { xMin: 0, xMax: 1, yMin: 0, yMax: 2048, cursor: null },
  spectrum: { xMin: 0, xMax: 2048, yMin: -80, yMax: 0, autoY: true, cursor: null }
};

let latestData = null;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatHertz(value) {
  if (value >= 1000) {
    const digits = value >= 10000 || value % 1000 === 0 ? 0 : 2;
    return `${(value / 1000).toFixed(digits)} kHz`;
  }
  return `${Number(value.toFixed(value < 10 ? 2 : 0))} Hz`;
}

function formatTime(value) {
  if (value < 0.001) return `${(value * 1e6).toFixed(0)} us`;
  if (value < 1) return `${Number((value * 1000).toPrecision(3))} ms`;
  return `${Number(value.toPrecision(3))} s`;
}

function resolveSampleRate() {
  if (controls.sampleRate.value !== "auto") return Number(controls.sampleRate.value);
  if (controls.mode.value === "stft") return 4096;
  const carrier = Number(controls.carrier.value);
  const message = Number(controls.message.value);
  const deviation = controls.mode.value === "fm" ? Number(controls.deviation.value) : 0;
  const highestFrequency = carrier + message + deviation;
  const required = highestFrequency * 2.4;
  return SAMPLE_RATES.find(rate => rate >= required) || SAMPLE_RATES[SAMPLE_RATES.length - 1];
}

function syncPair(range, input) {
  const value = clamp(Math.round(Number(input.value) || 0), Number(range.min), Number(range.max));
  range.value = String(value);
  input.value = String(value);
  render();
}

function noiseAt(index) {
  const value = Math.sin(index * 91.73 + 17.11) * 15347.235;
  return (value - Math.floor(value)) * 2 - 1;
}

function makeSignal(sampleRate) {
  const mode = controls.mode.value;
  const carrier = Number(controls.carrier.value);
  const messageFrequency = Math.max(1, Number(controls.message.value));
  const depth = Number(controls.depth.value) / 100;
  const deviation = Number(controls.deviation.value);
  const noise = Number(controls.noise.value) / 100;
  const duration = SIGNAL_SIZE / sampleRate;
  const signal = new Array(SIGNAL_SIZE);
  const reference = new Array(SIGNAL_SIZE);

  for (let index = 0; index < SIGNAL_SIZE; index += 1) {
    const time = index / sampleRate;
    const progress = index / (SIGNAL_SIZE - 1);
    const message = Math.sin(2 * Math.PI * messageFrequency * time);
    let value;
    let guide;

    if (mode === "am") {
      guide = 1 + depth * message;
      value = guide * Math.cos(2 * Math.PI * carrier * time);
    } else if (mode === "fm") {
      guide = message;
      const beta = deviation / messageFrequency;
      value = Math.cos(2 * Math.PI * carrier * time + beta * Math.sin(2 * Math.PI * messageFrequency * time));
    } else {
      const nyquist = sampleRate / 2;
      const kind = controls.signalKind.value;
      if (kind === "chirp") {
        const start = nyquist * 0.06;
        const end = nyquist * 0.82;
        const slope = (end - start) / duration;
        value = Math.sin(2 * Math.PI * (start * time + 0.5 * slope * time * time));
        guide = (start + slope * time) / nyquist;
      } else if (kind === "hop") {
        const ratios = [0.12, 0.44, 0.24, 0.72, 0.35, 0.6, 0.17, 0.8];
        const ratio = ratios[Math.min(ratios.length - 1, Math.floor(progress * ratios.length))];
        value = Math.sin(2 * Math.PI * nyquist * ratio * time);
        guide = ratio;
      } else if (kind === "burst") {
        const gate = (progress * 10) % 1 < 0.32 ? 1 : 0;
        value = gate * Math.sin(2 * Math.PI * nyquist * 0.4 * time);
        guide = gate;
      } else {
        const ratio = Math.floor(progress * 8) % 2 === 0 ? 0.2 : 0.58;
        value = Math.sin(2 * Math.PI * nyquist * ratio * time);
        guide = ratio;
      }
    }
    signal[index] = value + noise * noiseAt(index);
    reference[index] = guide;
  }
  return { signal, reference, duration };
}

function hann(index, size) {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (size - 1));
}

function fft(real, imag) {
  const size = real.length;
  let target = 0;
  for (let index = 1; index < size; index += 1) {
    let bit = size >> 1;
    while (target & bit) {
      target ^= bit;
      bit >>= 1;
    }
    target ^= bit;
    if (index < target) {
      [real[index], real[target]] = [real[target], real[index]];
      [imag[index], imag[target]] = [imag[target], imag[index]];
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let phaseReal = 1;
      let phaseImag = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const even = start + offset;
        const odd = even + length / 2;
        const oddReal = real[odd] * phaseReal - imag[odd] * phaseImag;
        const oddImag = real[odd] * phaseImag + imag[odd] * phaseReal;
        real[odd] = real[even] - oddReal;
        imag[odd] = imag[even] - oddImag;
        real[even] += oddReal;
        imag[even] += oddImag;
        const nextReal = phaseReal * stepReal - phaseImag * stepImag;
        phaseImag = phaseReal * stepImag + phaseImag * stepReal;
        phaseReal = nextReal;
      }
    }
  }
}

function magnitudes(samples) {
  const real = samples.map((value, index) => value * hann(index, samples.length));
  const imag = new Array(samples.length).fill(0);
  fft(real, imag);
  return real.slice(0, samples.length / 2).map((value, index) => {
    const magnitude = Math.hypot(value, imag[index]) / samples.length;
    return 20 * Math.log10(magnitude + 1e-7);
  });
}

function computeStft(signal, sampleRate) {
  const size = Number(controls.stftSize.value);
  const overlap = Number(controls.overlap.value) / 100;
  const hop = Math.max(1, Math.round(size * (1 - overlap)));
  const frames = [];
  for (let start = 0; start + size <= signal.length; start += hop) {
    frames.push({
      time: (start + size / 2) / sampleRate,
      values: magnitudes(signal.slice(start, start + size))
    });
  }
  return { frames, size, hop, frequencyStep: sampleRate / size };
}

function prepareCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { context, width: rect.width, height: rect.height };
}

function makeTicks(min, max, count = 5) {
  return Array.from({ length: count }, (_, index) => min + (max - min) * index / (count - 1));
}

function drawAxes(context, width, height, view, xFormatter, yFormatter) {
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#20302c";
  context.fillStyle = "#71857e";
  context.font = '11px "Cascadia Code", monospace';
  context.lineWidth = 1;

  makeTicks(view.xMin, view.xMax).forEach((value, index, ticks) => {
    const x = PADDING.left + plotWidth * index / (ticks.length - 1);
    context.beginPath();
    context.moveTo(x, PADDING.top);
    context.lineTo(x, height - PADDING.bottom);
    context.stroke();
    context.textAlign = index === 0 ? "left" : index === ticks.length - 1 ? "right" : "center";
    context.fillText(xFormatter(value), x, height - 13);
  });

  makeTicks(view.yMax, view.yMin).forEach((value, index, ticks) => {
    const y = PADDING.top + plotHeight * index / (ticks.length - 1);
    context.beginPath();
    context.moveTo(PADDING.left, y);
    context.lineTo(width - PADDING.right, y);
    context.stroke();
    context.textAlign = "right";
    context.fillText(yFormatter(value), PADDING.left - 9, y + 4);
  });
  context.strokeStyle = "#30423d";
  context.strokeRect(PADDING.left, PADDING.top, plotWidth, plotHeight);
}

function valueToPixel(value, min, max, start, length, invert = false) {
  const ratio = (value - min) / (max - min);
  return invert ? start + length * (1 - ratio) : start + length * ratio;
}

function drawSeries(context, values, step, color, width, height, view) {
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;
  const first = Math.max(0, Math.floor(view.xMin / step) - 1);
  const last = Math.min(values.length - 1, Math.ceil(view.xMax / step) + 1);
  if (last <= first) return;
  context.save();
  context.beginPath();
  context.rect(PADDING.left, PADDING.top, plotWidth, plotHeight);
  context.clip();
  context.beginPath();
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  for (let index = first; index <= last; index += 1) {
    const x = valueToPixel(index * step, view.xMin, view.xMax, PADDING.left, plotWidth);
    const y = valueToPixel(values[index], view.yMin, view.yMax, PADDING.top, plotHeight, true);
    if (index === first) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.restore();
}

function drawCrosshair(context, width, height, view) {
  if (!view.cursor) return;
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;
  const x = valueToPixel(view.cursor.x, view.xMin, view.xMax, PADDING.left, plotWidth);
  const y = valueToPixel(view.cursor.y, view.yMin, view.yMax, PADDING.top, plotHeight, true);
  if (x < PADDING.left || x > width - PADDING.right || y < PADDING.top || y > height - PADDING.bottom) return;
  context.save();
  context.strokeStyle = "rgba(183, 255, 60, 0.5)";
  context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(x, PADDING.top);
  context.lineTo(x, height - PADDING.bottom);
  context.moveTo(PADDING.left, y);
  context.lineTo(width - PADDING.right, y);
  context.stroke();
  context.restore();
}

function fitTimeY() {
  const view = chartViews.time;
  const start = Math.max(0, Math.floor(view.xMin * latestData.sampleRate));
  const end = Math.min(SIGNAL_SIZE - 1, Math.ceil(view.xMax * latestData.sampleRate));
  let min = Infinity;
  let max = -Infinity;
  [latestData.signal, latestData.reference].forEach(values => {
    for (let index = start; index <= end; index += 1) {
      min = Math.min(min, values[index]);
      max = Math.max(max, values[index]);
    }
  });
  const span = Math.max(0.2, max - min);
  view.yMin = min - span * 0.12;
  view.yMax = max + span * 0.12;
}

function fitSpectrumY() {
  const view = chartViews.spectrum;
  const step = latestData.sampleRate / SIGNAL_SIZE;
  const start = Math.max(0, Math.floor(view.xMin / step));
  const end = Math.min(latestData.spectrum.length - 1, Math.ceil(view.xMax / step));
  let max = -120;
  for (let index = start; index <= end; index += 1) max = Math.max(max, latestData.spectrum[index]);
  view.yMax = Math.min(10, Math.ceil((max + 5) / 10) * 10);
  view.yMin = Math.max(-140, view.yMax - 80);
}

function drawTime() {
  const view = chartViews.time;
  if (view.followSignal) {
    const focusFrequency = controls.mode.value === "stft"
      ? latestData.sampleRate * 0.1
      : Math.max(1, Number(controls.carrier.value));
    view.xMin = 0;
    view.xMax = Math.min(latestData.duration, 0.08, Math.max(32 / latestData.sampleRate, 10 / focusFrequency));
  }
  constrainView("time");
  if (view.autoY) fitTimeY();
  const { context, width, height } = prepareCanvas(canvases.time);
  drawAxes(context, width, height, view, formatTime, value => value.toFixed(2));
  drawSeries(context, latestData.reference, 1 / latestData.sampleRate, "#45e8d4", width, height, view);
  drawSeries(context, latestData.signal, 1 / latestData.sampleRate, "#b7ff3c", width, height, view);
  drawCrosshair(context, width, height, view);
  outputs.timeViewBadge.textContent = `${formatTime(view.xMin)} - ${formatTime(view.xMax)}`;
  outputs.timeRange.value = `${formatTime(view.xMin)} - ${formatTime(view.xMax)} | ${view.yMin.toFixed(2)} - ${view.yMax.toFixed(2)}`;
}

function heatColor(value) {
  const normalized = clamp((value + 90) / 75, 0, 1);
  if (normalized < 0.35) {
    const t = normalized / 0.35;
    return `rgb(${Math.round(5 + 12 * t)}, ${Math.round(17 + 92 * t)}, ${Math.round(15 + 100 * t)})`;
  }
  if (normalized < 0.75) {
    const t = (normalized - 0.35) / 0.4;
    return `rgb(${Math.round(17 + 166 * t)}, ${Math.round(109 + 146 * t)}, ${Math.round(115 - 55 * t)})`;
  }
  const t = (normalized - 0.75) / 0.25;
  return `rgb(${Math.round(183 + 72 * t)}, ${Math.round(255 - 8 * t)}, ${Math.round(60 + 117 * t)})`;
}

function drawSpectrogram() {
  const view = chartViews.spectrogram;
  constrainView("spectrogram");
  const { context, width, height } = prepareCanvas(canvases.spectrogram);
  drawAxes(context, width, height, view, formatTime, formatHertz);
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;
  const frequencyStep = latestData.stft.frequencyStep;
  const frameSpan = latestData.stft.hop / latestData.sampleRate;
  context.save();
  context.beginPath();
  context.rect(PADDING.left, PADDING.top, plotWidth, plotHeight);
  context.clip();
  latestData.stft.frames.forEach(frame => {
    if (frame.time + frameSpan < view.xMin || frame.time - frameSpan > view.xMax) return;
    const x = valueToPixel(frame.time, view.xMin, view.xMax, PADDING.left, plotWidth);
    const nextX = valueToPixel(frame.time + frameSpan, view.xMin, view.xMax, PADDING.left, plotWidth);
    const firstBin = Math.max(0, Math.floor(view.yMin / frequencyStep));
    const lastBin = Math.min(frame.values.length - 1, Math.ceil(view.yMax / frequencyStep));
    for (let bin = firstBin; bin <= lastBin; bin += 1) {
      const frequency = bin * frequencyStep;
      const y = valueToPixel(frequency, view.yMin, view.yMax, PADDING.top, plotHeight, true);
      const nextY = valueToPixel(frequency + frequencyStep, view.yMin, view.yMax, PADDING.top, plotHeight, true);
      context.fillStyle = heatColor(frame.values[bin]);
      context.fillRect(x, nextY, Math.max(1, nextX - x + 1), Math.max(1, y - nextY + 1));
    }
  });
  context.restore();
  drawCrosshair(context, width, height, view);
  outputs.spectrogramRange.value = `${formatTime(view.xMin)} - ${formatTime(view.xMax)} | ${formatHertz(view.yMin)} - ${formatHertz(view.yMax)}`;
}

function drawSpectrum() {
  const view = chartViews.spectrum;
  constrainView("spectrum");
  if (view.autoY) fitSpectrumY();
  const { context, width, height } = prepareCanvas(canvases.spectrum);
  drawAxes(context, width, height, view, formatHertz, value => `${Math.round(value)} dB`);
  drawSeries(context, latestData.spectrum, latestData.sampleRate / SIGNAL_SIZE, "#45e8d4", width, height, view);
  drawCrosshair(context, width, height, view);
  outputs.spectrumRange.value = `${formatHertz(view.xMin)} - ${formatHertz(view.xMax)} | ${Math.round(view.yMin)} - ${Math.round(view.yMax)} dB`;
}

function renderCharts() {
  if (!latestData) return;
  drawTime();
  drawSpectrogram();
  drawSpectrum();
}

function dataBounds(kind) {
  if (kind === "time") {
    return { xMin: 0, xMax: latestData.duration, yMin: -5, yMax: 5, minX: 8 / latestData.sampleRate, minY: 0.05 };
  }
  if (kind === "spectrogram") {
    return {
      xMin: 0,
      xMax: latestData.duration,
      yMin: 0,
      yMax: latestData.sampleRate / 2,
      minX: latestData.stft.hop / latestData.sampleRate * 2,
      minY: latestData.stft.frequencyStep * 4
    };
  }
  return {
    xMin: 0,
    xMax: latestData.sampleRate / 2,
    yMin: -140,
    yMax: 10,
    minX: latestData.sampleRate / SIGNAL_SIZE * 8,
    minY: 5
  };
}

function constrainAxis(view, minKey, maxKey, boundMin, boundMax) {
  const span = view[maxKey] - view[minKey];
  const dataSpan = boundMax - boundMin;
  if (span >= dataSpan) {
    view[minKey] = boundMin;
    view[maxKey] = boundMax;
    return;
  }
  if (view[minKey] < boundMin) {
    view[minKey] = boundMin;
    view[maxKey] = boundMin + span;
  }
  if (view[maxKey] > boundMax) {
    view[maxKey] = boundMax;
    view[minKey] = boundMax - span;
  }
}

function constrainView(kind) {
  const view = chartViews[kind];
  const bounds = dataBounds(kind);
  constrainAxis(view, "xMin", "xMax", bounds.xMin, bounds.xMax);
  constrainAxis(view, "yMin", "yMax", bounds.yMin, bounds.yMax);
}

function zoomView(kind, axis, factor, anchorRatio = 0.5) {
  const view = chartViews[kind];
  const bounds = dataBounds(kind);
  const minKey = axis === "x" ? "xMin" : "yMin";
  const maxKey = axis === "x" ? "xMax" : "yMax";
  const boundMin = axis === "x" ? bounds.xMin : bounds.yMin;
  const boundMax = axis === "x" ? bounds.xMax : bounds.yMax;
  const minimum = axis === "x" ? bounds.minX : bounds.minY;
  const span = view[maxKey] - view[minKey];
  const nextSpan = clamp(span * factor, minimum, boundMax - boundMin);
  const anchor = view[minKey] + span * anchorRatio;
  view[minKey] = anchor - nextSpan * anchorRatio;
  view[maxKey] = view[minKey] + nextSpan;
  if (kind === "time" && axis === "x") view.followSignal = false;
  if ((kind === "time" || kind === "spectrum") && axis === "y") view.autoY = false;
  constrainView(kind);
  renderCharts();
}

function resetView(kind, fitAll = false) {
  const view = chartViews[kind];
  const bounds = dataBounds(kind);
  view.cursor = null;
  if (kind === "time") {
    view.xMin = 0;
    view.xMax = fitAll ? bounds.xMax : Math.min(bounds.xMax, 0.08);
    view.yMin = -2.2;
    view.yMax = 2.2;
    view.followSignal = !fitAll;
    view.autoY = fitAll;
  } else if (kind === "spectrogram") {
    view.xMin = bounds.xMin;
    view.xMax = bounds.xMax;
    view.yMin = bounds.yMin;
    view.yMax = bounds.yMax;
  } else {
    view.xMin = bounds.xMin;
    view.xMax = bounds.xMax;
    view.yMin = -80;
    view.yMax = 0;
    view.autoY = true;
  }
  renderCharts();
}

function pointInPlot(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const plotWidth = rect.width - PADDING.left - PADDING.right;
  const plotHeight = rect.height - PADDING.top - PADDING.bottom;
  return {
    inside: x >= PADDING.left && x <= rect.width - PADDING.right
      && y >= PADDING.top && y <= rect.height - PADDING.bottom,
    xRatio: clamp((x - PADDING.left) / plotWidth, 0, 1),
    yRatio: clamp((y - PADDING.top) / plotHeight, 0, 1),
    plotWidth,
    plotHeight
  };
}

function cursorText(kind, cursor) {
  if (kind === "time") return `${formatTime(cursor.x)} | ${cursor.y.toFixed(3)}`;
  if (kind === "spectrogram") return `${formatTime(cursor.x)} | ${formatHertz(cursor.y)}`;
  return `${formatHertz(cursor.x)} | ${cursor.y.toFixed(1)} dB`;
}

function attachChartInteractions(kind, canvas, output) {
  const view = chartViews[kind];
  let drag = null;

  canvas.addEventListener("pointerdown", event => {
    const point = pointInPlot(canvas, event);
    if (!point.inside) return;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-dragging");
    drag = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      xMin: view.xMin,
      xMax: view.xMax,
      yMin: view.yMin,
      yMax: view.yMax
    };
  });

  canvas.addEventListener("pointermove", event => {
    const point = pointInPlot(canvas, event);
    if (drag) {
      const xSpan = drag.xMax - drag.xMin;
      const ySpan = drag.yMax - drag.yMin;
      const deltaX = (event.clientX - drag.clientX) / point.plotWidth * xSpan;
      const deltaY = (event.clientY - drag.clientY) / point.plotHeight * ySpan;
      view.xMin = drag.xMin - deltaX;
      view.xMax = drag.xMax - deltaX;
      view.yMin = drag.yMin + deltaY;
      view.yMax = drag.yMax + deltaY;
      if (kind === "time") view.followSignal = false;
      if (kind === "time" || kind === "spectrum") view.autoY = false;
      constrainView(kind);
      renderCharts();
      return;
    }
    if (!point.inside) return;
    view.cursor = {
      x: view.xMin + (view.xMax - view.xMin) * point.xRatio,
      y: view.yMax - (view.yMax - view.yMin) * point.yRatio
    };
    output.value = cursorText(kind, view.cursor);
    renderCharts();
  });

  const finish = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    canvas.classList.remove("is-dragging");
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("pointerleave", () => {
    if (drag) return;
    view.cursor = null;
    const labels = {
      time: "拖拽平移 · 滚轮缩放 X · Shift + 滚轮缩放 Y",
      spectrogram: "拖拽平移时间/频率 · 滚轮缩放时间 · Shift + 滚轮缩放频率",
      spectrum: "拖拽平移 · 滚轮缩放 X · Shift + 滚轮缩放 Y"
    };
    output.value = labels[kind];
    renderCharts();
  });

  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const point = pointInPlot(canvas, event);
    if (!point.inside) return;
    const factor = Math.exp(event.deltaY * 0.0015);
    zoomView(kind, event.shiftKey ? "y" : "x", factor, event.shiftKey ? 1 - point.yRatio : point.xRatio);
  }, { passive: false });

  canvas.addEventListener("dblclick", () => resetView(kind, false));
}

function updateCopy(sampleRate, stft) {
  const mode = controls.mode.value;
  const isStft = mode === "stft";
  groups.signalKind.hidden = !isStft;
  groups.carrier.hidden = isStft;
  groups.message.hidden = isStft;
  groups.depth.hidden = mode !== "am";
  groups.deviation.hidden = mode !== "fm";

  outputs.carrier.value = formatHertz(Number(controls.carrier.value));
  outputs.message.value = formatHertz(Number(controls.message.value));
  outputs.depth.value = `${controls.depth.value}%`;
  outputs.deviation.value = formatHertz(Number(controls.deviation.value));
  outputs.noise.value = `${controls.noise.value}%`;
  outputs.sampleRate.value = controls.sampleRate.value === "auto"
    ? `自动 · ${formatHertz(sampleRate)}`
    : formatHertz(sampleRate);
  outputs.overlap.value = `${controls.overlap.value}%`;

  const timeResolution = stft.size / sampleRate * 1000;
  const frequencyResolution = sampleRate / stft.size;
  outputs.hint.textContent = `每帧观察 ${timeResolution.toFixed(2)} ms，频率格点间隔 ${formatHertz(frequencyResolution)}，帧移 ${(stft.hop / sampleRate * 1000).toFixed(2)} ms。`;
  outputs.stftBadge.textContent = `${stft.size} 点 · ${controls.overlap.value}% 重叠`;

  const title = document.querySelector("#lessonTitle");
  const text = document.querySelector("#lessonText");
  const waveTitle = document.querySelector("#waveTitle");
  const waveNote = document.querySelector("#waveNote");
  const spectrumNote = document.querySelector("#spectrumNote");

  if (mode === "am") {
    const carrier = Number(controls.carrier.value);
    const message = Number(controls.message.value);
    const depth = Number(controls.depth.value);
    outputs.metricOneLabel.textContent = "下边带";
    outputs.metricOneValue.textContent = formatHertz(Math.max(0, carrier - message));
    outputs.metricTwoLabel.textContent = "载波";
    outputs.metricTwoValue.textContent = formatHertz(carrier);
    outputs.metricThreeLabel.textContent = "上边带";
    outputs.timeResolution.textContent = formatHertz(carrier + message);
    outputs.metricFourLabel.textContent = "调制状态";
    outputs.frequencyResolution.textContent = depth > 100 ? "过调制" : `${depth}% · 正常`;
    outputs.referenceLegend.textContent = "包络";
    outputs.signalLegend.textContent = "AM 信号";
    title.textContent = "AM 为什么会产生上下边带？";
    text.textContent = "消息信号与载波相乘，相当于把消息频谱复制到载波两侧。提高载波频率后，自动采样率会同步保证足够的奈奎斯特余量。";
    waveTitle.textContent = "AM 波形与包络";
    waveNote.textContent = "青色表示包络，绿色表示高频载波。拖拽和缩放可以观察包络细节或单个载波周期。";
    spectrumNote.textContent = "观察载波尖峰 fc，以及位于 fc-fm 和 fc+fm 的两个边带。";
  } else if (mode === "fm") {
    const message = Number(controls.message.value);
    const deviation = Number(controls.deviation.value);
    outputs.metricOneLabel.textContent = "载波";
    outputs.metricOneValue.textContent = formatHertz(Number(controls.carrier.value));
    outputs.metricTwoLabel.textContent = "调制指数 β";
    outputs.metricTwoValue.textContent = (deviation / message).toFixed(2);
    outputs.metricThreeLabel.textContent = "峰值频偏";
    outputs.timeResolution.textContent = formatHertz(deviation);
    outputs.metricFourLabel.textContent = "Carson 带宽";
    outputs.frequencyResolution.textContent = formatHertz(2 * (deviation + message));
    outputs.referenceLegend.textContent = "消息信号";
    outputs.signalLegend.textContent = "FM 信号";
    title.textContent = "FM 的信息藏在哪里？";
    text.textContent = "FM 的幅度基本不变，消息控制瞬时频率。瀑布图纵轴可独立缩放，更容易测量频偏和占用带宽。";
    waveTitle.textContent = "FM 波形与消息";
    waveNote.textContent = "青色是消息信号；绿色波形疏密随消息变化，但振幅保持近似恒定。";
    spectrumNote.textContent = "FM 通常拥有多对边带。频偏与消息频率共同决定主要占用带宽。";
  } else {
    outputs.metricOneLabel.textContent = "观察时长";
    outputs.metricOneValue.textContent = formatTime(SIGNAL_SIZE / sampleRate);
    outputs.metricTwoLabel.textContent = "采样率";
    outputs.metricTwoValue.textContent = formatHertz(sampleRate);
    outputs.metricThreeLabel.textContent = "时间分辨率";
    outputs.timeResolution.textContent = `${timeResolution.toFixed(2)} ms`;
    outputs.metricFourLabel.textContent = "频率分辨率";
    outputs.frequencyResolution.textContent = formatHertz(frequencyResolution);
    outputs.referenceLegend.textContent = "频率轨迹";
    outputs.signalLegend.textContent = "动态信号";
    title.textContent = controls.signalKind.value === "chirp" ? "扫频信号为何是一条斜线？" : "频率在什么时候发生变化？";
    text.textContent = "普通 FFT 把整段信号压缩成一张频谱，而 STFT 对连续短片段分别做 FFT。现在可以直接放大时频图的局部变化。";
    waveTitle.textContent = "动态信号波形";
    waveNote.textContent = "时域能看出振荡疏密或开关变化；拖拽和缩放后可以观察具体发生时刻。";
    spectrumNote.textContent = "与时频图对照：整段 FFT 能看到所有频率，却看不到它们出现的先后顺序。";
  }
}

function render() {
  const sampleRate = resolveSampleRate();
  const nyquistLimit = Math.min(MAX_FREQUENCY, Math.floor(sampleRate / 2 - 1));
  controls.carrier.max = String(MAX_FREQUENCY);
  controls.carrierInput.max = String(MAX_FREQUENCY);
  controls.message.max = "5000";
  controls.messageInput.max = "5000";
  controls.deviation.max = "10000";
  controls.deviationInput.max = "10000";

  const previous = latestData;
  const previousDuration = previous ? previous.duration : null;
  const previousNyquist = previous ? previous.sampleRate / 2 : null;
  const timeWasFull = previous && Math.abs(chartViews.time.xMax - previousDuration) < 1e-9;
  const spectrogramTimeWasFull = previous && Math.abs(chartViews.spectrogram.xMax - previousDuration) < 1e-9;
  const spectrogramFrequencyWasFull = previous && Math.abs(chartViews.spectrogram.yMax - previousNyquist) < 1e-9;
  const spectrumWasFull = previous && Math.abs(chartViews.spectrum.xMax - previousNyquist) < 1e-9;

  const data = makeSignal(sampleRate);
  const stft = computeStft(data.signal, sampleRate);
  const spectrum = magnitudes(data.signal);
  let peakIndex = 1;
  for (let index = 2; index < spectrum.length; index += 1) {
    if (spectrum[index] > spectrum[peakIndex]) peakIndex = index;
  }
  latestData = {
    ...data,
    sampleRate,
    stft,
    spectrum,
    peakFrequency: peakIndex * sampleRate / SIGNAL_SIZE
  };
  updateCopy(sampleRate, stft);
  outputs.peakBadge.textContent = `最强峰值 · ${formatHertz(latestData.peakFrequency)}`;

  if (!previous) {
    chartViews.spectrogram.xMax = latestData.duration;
    chartViews.spectrogram.yMax = sampleRate / 2;
    chartViews.spectrum.xMax = sampleRate / 2;
  }
  if (timeWasFull) chartViews.time.xMax = latestData.duration;
  if (spectrogramTimeWasFull) chartViews.spectrogram.xMax = latestData.duration;
  if (spectrogramFrequencyWasFull) chartViews.spectrogram.yMax = sampleRate / 2;
  if (spectrumWasFull) chartViews.spectrum.xMax = sampleRate / 2;
  const bounds = dataBounds("spectrogram");
  if (chartViews.spectrogram.yMax > bounds.yMax) chartViews.spectrogram.yMax = bounds.yMax;
  if (chartViews.spectrum.xMax > bounds.yMax) chartViews.spectrum.xMax = bounds.yMax;
  renderCharts();

  const highest = controls.mode.value === "am"
    ? Number(controls.carrier.value) + Number(controls.message.value)
    : Number(controls.carrier.value) + Number(controls.deviation.value) + Number(controls.message.value);
  outputs.sampleRate.classList.toggle("warning-text", controls.mode.value !== "stft" && highest >= sampleRate / 2);
  outputs.sampleRate.title = highest >= sampleRate / 2 ? `当前最高频率超过奈奎斯特上限 ${formatHertz(nyquistLimit)}` : "";
}

const defaults = {
  mode: "stft",
  signalKind: "chirp",
  carrier: "800",
  message: "40",
  depth: "70",
  deviation: "220",
  noise: "2",
  sampleRate: "auto",
  stftSize: "256",
  overlap: "75"
};

function applyValues(values) {
  Object.entries(values).forEach(([key, value]) => {
    controls[key].value = value;
    if (controls[`${key}Input`]) controls[`${key}Input`].value = value;
  });
  render();
}

["mode", "signalKind", "depth", "noise", "sampleRate", "stftSize", "overlap"].forEach(key => {
  controls[key].addEventListener("input", render);
  controls[key].addEventListener("change", render);
});

[
  [controls.carrier, controls.carrierInput],
  [controls.message, controls.messageInput],
  [controls.deviation, controls.deviationInput]
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

document.querySelector("#resetStage2").addEventListener("click", () => {
  applyValues(defaults);
  ["time", "spectrogram", "spectrum"].forEach(kind => resetView(kind, false));
});

document.querySelectorAll("[data-stage-preset]").forEach(button => {
  button.addEventListener("click", () => {
    const preset = button.dataset.stagePreset;
    if (preset === "resolution") {
      applyValues({ mode: "stft", signalKind: "chirp", stftSize: controls.stftSize.value === "64" ? "1024" : "64", overlap: "75" });
    }
    if (preset === "am") applyValues({ mode: "am", carrier: "8000", message: "800", depth: "70", sampleRate: "auto", stftSize: "512" });
    if (preset === "overmod") applyValues({ mode: "am", carrier: "6000", message: "400", depth: "120", sampleRate: "auto", stftSize: "512" });
    if (preset === "fm") applyValues({ mode: "fm", carrier: "10000", message: "250", deviation: "3000", sampleRate: "auto", stftSize: "512" });
    ["time", "spectrogram", "spectrum"].forEach(kind => resetView(kind, false));
  });
});

document.querySelectorAll("[data-stage-chart]").forEach(button => {
  button.addEventListener("click", () => {
    const kind = button.dataset.stageChart;
    const action = button.dataset.action;
    if (action === "zoom-in") zoomView(kind, "x", 0.65);
    if (action === "zoom-out") zoomView(kind, "x", 1.5);
    if (action === "y-in") zoomView(kind, "y", 0.65);
    if (action === "y-out") zoomView(kind, "y", 1.5);
    if (action === "auto") resetView(kind, true);
    if (action === "reset") resetView(kind, false);
  });
});

attachChartInteractions("time", canvases.time, outputs.timeCursor);
attachChartInteractions("spectrogram", canvases.spectrogram, outputs.spectrogramCursor);
attachChartInteractions("spectrum", canvases.spectrum, outputs.spectrumCursor);

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderCharts, 100);
});

render();
