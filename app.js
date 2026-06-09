"use strict";

const FFT_SIZE = 1024;
const controls = {
  waveform: document.querySelector("#waveform"),
  frequency: document.querySelector("#frequency"),
  secondFrequency: document.querySelector("#secondFrequency"),
  secondAmplitude: document.querySelector("#secondAmplitude"),
  noise: document.querySelector("#noise"),
  sampleRate: document.querySelector("#sampleRate"),
  windowType: document.querySelector("#windowType"),
  filterType: document.querySelector("#filterType"),
  cutoff: document.querySelector("#cutoff")
};

const outputs = {
  frequency: document.querySelector("#frequencyValue"),
  secondFrequency: document.querySelector("#secondFrequencyValue"),
  secondAmplitude: document.querySelector("#secondAmplitudeValue"),
  noise: document.querySelector("#noiseValue"),
  cutoff: document.querySelector("#cutoffValue"),
  sampleInterval: document.querySelector("#sampleInterval"),
  nyquist: document.querySelector("#nyquist"),
  resolution: document.querySelector("#resolution"),
  filterStatus: document.querySelector("#filterStatus")
};

const timeCanvas = document.querySelector("#timeCanvas");
const spectrumCanvas = document.querySelector("#spectrumCanvas");
const warning = document.querySelector("#warning");
const chartOutputs = {
  timeCursor: document.querySelector("#timeCursor"),
  spectrumCursor: document.querySelector("#spectrumCursor"),
  timeRange: document.querySelector("#timeRange"),
  spectrumRange: document.querySelector("#spectrumRange")
};

const chartViews = {
  time: { xMin: 0, xMax: 0.1, yMin: -2, yMax: 2, autoY: true, xAuto: false, cursor: null },
  spectrum: { xMin: 0, xMax: 500, yMin: -80, yMax: 0, autoY: true, xAuto: true, cursor: null }
};

let latestData = null;
const plotPadding = { left: 58, right: 20, top: 18, bottom: 38 };

function pseudoNoise(index) {
  const value = Math.sin(index * 12.9898 + 78.233) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
}

function makeSignal(sampleRate) {
  const frequency = Number(controls.frequency.value);
  const secondFrequency = Number(controls.secondFrequency.value);
  const secondAmplitude = Number(controls.secondAmplitude.value) / 100;
  const noiseAmplitude = Number(controls.noise.value) / 100;

  return Array.from({ length: FFT_SIZE }, (_, index) => {
    const time = index / sampleRate;
    const phase = 2 * Math.PI * frequency * time;
    const main = controls.waveform.value === "square"
      ? Math.sign(Math.sin(phase))
      : Math.sin(phase);
    const second = secondAmplitude * Math.sin(2 * Math.PI * secondFrequency * time);
    return main + second + noiseAmplitude * pseudoNoise(index);
  });
}

function lowPass(signal, cutoff, sampleRate) {
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cutoff);
  const alpha = dt / (rc + dt);
  const result = new Array(signal.length);
  result[0] = signal[0];
  for (let i = 1; i < signal.length; i += 1) {
    result[i] = result[i - 1] + alpha * (signal[i] - result[i - 1]);
  }
  return result;
}

function highPass(signal, cutoff, sampleRate) {
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cutoff);
  const alpha = rc / (rc + dt);
  const result = new Array(signal.length);
  result[0] = 0;
  for (let i = 1; i < signal.length; i += 1) {
    result[i] = alpha * (result[i - 1] + signal[i] - signal[i - 1]);
  }
  return result;
}

function filterSignal(signal, sampleRate) {
  const cutoff = Number(controls.cutoff.value);
  if (controls.filterType.value === "lowpass") {
    return lowPass(signal, cutoff, sampleRate);
  }
  if (controls.filterType.value === "highpass") {
    return highPass(signal, cutoff, sampleRate);
  }
  return signal.slice();
}

function windowCoefficient(type, index, size) {
  const ratio = index / (size - 1);
  if (type === "hann") return 0.5 - 0.5 * Math.cos(2 * Math.PI * ratio);
  if (type === "hamming") return 0.54 - 0.46 * Math.cos(2 * Math.PI * ratio);
  if (type === "blackman") {
    return 0.42 - 0.5 * Math.cos(2 * Math.PI * ratio) + 0.08 * Math.cos(4 * Math.PI * ratio);
  }
  return 1;
}

function fftMagnitudes(signal, windowType) {
  const real = signal.map((value, index) => value * windowCoefficient(windowType, index, signal.length));
  const imag = new Array(signal.length).fill(0);
  fft(real, imag);
  const magnitudes = [];
  for (let i = 0; i < signal.length / 2; i += 1) {
    const amplitude = Math.sqrt(real[i] ** 2 + imag[i] ** 2) / signal.length;
    magnitudes.push(20 * Math.log10(amplitude + 1e-6));
  }
  return magnitudes;
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

function formatTime(value) {
  if (Math.abs(value) < 1e-9) return "0";
  if (value < 0.001) return `${Math.round(value * 1e6)} μs`;
  if (value < 1) return `${Number((value * 1000).toPrecision(3))} ms`;
  return `${Number(value.toPrecision(3))} s`;
}

function formatFrequency(value) {
  if (value >= 1000) return `${Number((value / 1000).toPrecision(3))} kHz`;
  return `${Math.round(value)} Hz`;
}

function formatAmplitude(value) {
  const normalized = Math.abs(value) < 1e-8 ? 0 : value;
  return `${normalized > 0 ? "+" : ""}${Number(normalized.toPrecision(3))}`;
}

function drawGrid(context, width, height, view, xFormatter, yFormatter) {
  const plotWidth = width - plotPadding.left - plotPadding.right;
  const plotHeight = height - plotPadding.top - plotPadding.bottom;
  context.clearRect(0, 0, width, height);
  context.strokeStyle = "#20302c";
  context.fillStyle = "#71857e";
  context.font = '11px "Cascadia Code", monospace';
  context.lineWidth = 1;

  makeTicks(view.xMin, view.xMax).forEach((value, index, ticks) => {
    const x = plotPadding.left + plotWidth * index / (ticks.length - 1);
    context.beginPath();
    context.moveTo(x, plotPadding.top);
    context.lineTo(x, height - plotPadding.bottom);
    context.stroke();
    context.textAlign = index === 0 ? "left" : index === ticks.length - 1 ? "right" : "center";
    context.fillText(xFormatter(value), x, height - 13);
  });

  makeTicks(view.yMax, view.yMin).forEach((value, index, ticks) => {
    const y = plotPadding.top + plotHeight * index / (ticks.length - 1);
    context.beginPath();
    context.moveTo(plotPadding.left, y);
    context.lineTo(width - plotPadding.right, y);
    context.stroke();
    context.textAlign = "right";
    context.fillText(yFormatter(value), plotPadding.left - 9, y + 4);
  });

  context.strokeStyle = "#30423d";
  context.strokeRect(plotPadding.left, plotPadding.top, plotWidth, plotHeight);
}

function valueToPixel(value, min, max, start, length, invert = false) {
  const ratio = (value - min) / (max - min);
  return invert ? start + length * (1 - ratio) : start + length * ratio;
}

function drawSeries(context, values, step, color, width, height, view) {
  const plotWidth = width - plotPadding.left - plotPadding.right;
  const plotHeight = height - plotPadding.top - plotPadding.bottom;
  const firstIndex = Math.max(0, Math.floor(view.xMin / step) - 1);
  const lastIndex = Math.min(values.length - 1, Math.ceil(view.xMax / step) + 1);
  if (lastIndex <= firstIndex) return;

  context.save();
  context.beginPath();
  context.rect(plotPadding.left, plotPadding.top, plotWidth, plotHeight);
  context.clip();
  context.beginPath();
  context.strokeStyle = color;
  context.lineWidth = 1.6;
  for (let i = firstIndex; i <= lastIndex; i += 1) {
    const xValue = i * step;
    const x = valueToPixel(xValue, view.xMin, view.xMax, plotPadding.left, plotWidth);
    const y = valueToPixel(values[i], view.yMin, view.yMax, plotPadding.top, plotHeight, true);
    if (i === firstIndex) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.restore();
}

function fitVisibleY(view, series, step, fallback) {
  const start = Math.max(0, Math.floor(view.xMin / step));
  const end = Math.min(series[0].length - 1, Math.ceil(view.xMax / step));
  let min = Infinity;
  let max = -Infinity;
  series.forEach(values => {
    for (let index = start; index <= end; index += 1) {
      if (Number.isFinite(values[index])) {
        min = Math.min(min, values[index]);
        max = Math.max(max, values[index]);
      }
    }
  });
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    [view.yMin, view.yMax] = fallback;
    return;
  }
  const baseSpan = Math.max(max - min, fallback[1] - fallback[0]);
  const margin = baseSpan * 0.1;
  view.yMin = min - margin;
  view.yMax = max + margin;
}

function fitSpectrumY(view, series, step) {
  const start = Math.max(0, Math.floor(view.xMin / step));
  const end = Math.min(series[0].length - 1, Math.ceil(view.xMax / step));
  let max = -120;
  series.forEach(values => {
    for (let index = start; index <= end; index += 1) {
      max = Math.max(max, values[index]);
    }
  });
  view.yMax = Math.min(10, Math.ceil((max + 5) / 10) * 10);
  view.yMin = Math.max(-140, view.yMax - 80);
}

function drawCrosshair(context, width, height, view, cursor) {
  if (!cursor) return;
  const plotWidth = width - plotPadding.left - plotPadding.right;
  const plotHeight = height - plotPadding.top - plotPadding.bottom;
  const x = valueToPixel(cursor.x, view.xMin, view.xMax, plotPadding.left, plotWidth);
  const y = valueToPixel(cursor.y, view.yMin, view.yMax, plotPadding.top, plotHeight, true);
  if (x < plotPadding.left || x > width - plotPadding.right || y < plotPadding.top || y > height - plotPadding.bottom) return;
  context.save();
  context.strokeStyle = "rgba(183, 255, 60, 0.45)";
  context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(x, plotPadding.top);
  context.lineTo(x, height - plotPadding.bottom);
  context.moveTo(plotPadding.left, y);
  context.lineTo(width - plotPadding.right, y);
  context.stroke();
  context.restore();
}

function drawTime(signal, filtered, sampleRate) {
  const view = chartViews.time;
  const totalDuration = (signal.length - 1) / sampleRate;
  if (view.xAuto) {
    view.xMin = 0;
    view.xMax = totalDuration;
  } else {
    constrainX(view, 0, totalDuration);
  }
  const series = controls.filterType.value === "none" ? [signal] : [signal, filtered];
  if (view.autoY) fitVisibleY(view, series, 1 / sampleRate, [-1, 1]);
  const { context, width, height } = prepareCanvas(timeCanvas);
  drawGrid(context, width, height, view, formatTime, formatAmplitude);
  drawSeries(context, signal, 1 / sampleRate, "#45e8d4", width, height, view);
  if (controls.filterType.value !== "none") {
    drawSeries(context, filtered, 1 / sampleRate, "#b7ff3c", width, height, view);
  }
  drawCrosshair(context, width, height, view, view.cursor);
  chartOutputs.timeRange.value = `${formatTime(view.xMin)} – ${formatTime(view.xMax)}  |  ${formatAmplitude(view.yMin)} – ${formatAmplitude(view.yMax)}`;
}

function drawSpectrum(rawSpectrum, filteredSpectrum, sampleRate) {
  const view = chartViews.spectrum;
  const nyquist = sampleRate / 2;
  const step = sampleRate / FFT_SIZE;
  if (view.xAuto) {
    view.xMin = 0;
    view.xMax = nyquist;
  } else {
    constrainX(view, 0, nyquist);
  }
  const series = controls.filterType.value === "none" ? [rawSpectrum] : [rawSpectrum, filteredSpectrum];
  if (view.autoY) fitSpectrumY(view, series, step);
  const { context, width, height } = prepareCanvas(spectrumCanvas);
  drawGrid(context, width, height, view, formatFrequency, value => `${Math.round(value)} dB`);
  drawSeries(context, rawSpectrum, step, "#45e8d4", width, height, view);
  if (controls.filterType.value !== "none") {
    drawSeries(context, filteredSpectrum, step, "#b7ff3c", width, height, view);
  }
  drawCrosshair(context, width, height, view, view.cursor);
  chartOutputs.spectrumRange.value = `${formatFrequency(view.xMin)} – ${formatFrequency(view.xMax)}  |  ${Math.round(view.yMin)} – ${Math.round(view.yMax)} dB`;
}

function constrainX(view, dataMin, dataMax) {
  const dataSpan = dataMax - dataMin;
  let span = view.xMax - view.xMin;
  if (span >= dataSpan) {
    view.xMin = dataMin;
    view.xMax = dataMax;
    return;
  }
  if (view.xMin < dataMin) {
    view.xMin = dataMin;
    view.xMax = dataMin + span;
  }
  if (view.xMax > dataMax) {
    view.xMax = dataMax;
    view.xMin = dataMax - span;
  }
}

function dataBounds(kind) {
  if (!latestData) return { xMin: 0, xMax: 1, minSpan: 0.001 };
  if (kind === "time") {
    return {
      xMin: 0,
      xMax: (latestData.signal.length - 1) / latestData.sampleRate,
      minSpan: 8 / latestData.sampleRate
    };
  }
  return {
    xMin: 0,
    xMax: latestData.sampleRate / 2,
    minSpan: latestData.sampleRate / FFT_SIZE * 8
  };
}

function renderCharts() {
  if (!latestData) return;
  drawTime(latestData.signal, latestData.filtered, latestData.sampleRate);
  drawSpectrum(latestData.rawSpectrum, latestData.filteredSpectrum, latestData.sampleRate);
}

function zoomView(kind, axis, factor, anchorRatio = 0.5) {
  const view = chartViews[kind];
  if (axis === "x") {
    const bounds = dataBounds(kind);
    const span = view.xMax - view.xMin;
    const nextSpan = Math.min(bounds.xMax - bounds.xMin, Math.max(bounds.minSpan, span * factor));
    const anchor = view.xMin + span * anchorRatio;
    view.xMin = anchor - nextSpan * anchorRatio;
    view.xMax = view.xMin + nextSpan;
    view.xAuto = nextSpan >= (bounds.xMax - bounds.xMin) * 0.999;
    constrainX(view, bounds.xMin, bounds.xMax);
  } else {
    const span = view.yMax - view.yMin;
    const minimum = kind === "time" ? 0.05 : 5;
    const maximum = kind === "time" ? 20 : 180;
    const nextSpan = Math.min(maximum, Math.max(minimum, span * factor));
    const anchor = view.yMin + span * (1 - anchorRatio);
    view.yMin = anchor - nextSpan * (1 - anchorRatio);
    view.yMax = view.yMin + nextSpan;
    view.autoY = false;
  }
  renderCharts();
}

function resetView(kind, fitAll = false) {
  const view = chartViews[kind];
  view.cursor = null;
  view.autoY = true;
  if (kind === "time") {
    const bounds = dataBounds(kind);
    view.xMin = 0;
    view.xMax = fitAll ? bounds.xMax : Math.min(0.1, bounds.xMax);
    view.xAuto = fitAll;
  } else {
    view.xMin = 0;
    view.xMax = dataBounds(kind).xMax;
    view.xAuto = true;
  }
  renderCharts();
}

function pointInPlot(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const plotWidth = rect.width - plotPadding.left - plotPadding.right;
  const plotHeight = rect.height - plotPadding.top - plotPadding.bottom;
  return {
    x,
    y,
    inside: x >= plotPadding.left && x <= rect.width - plotPadding.right
      && y >= plotPadding.top && y <= rect.height - plotPadding.bottom,
    xRatio: (x - plotPadding.left) / plotWidth,
    yRatio: (y - plotPadding.top) / plotHeight,
    plotWidth,
    plotHeight
  };
}

function attachChartInteractions(kind, canvas, cursorOutput) {
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
      view.xAuto = false;
      view.autoY = false;
      const bounds = dataBounds(kind);
      constrainX(view, bounds.xMin, bounds.xMax);
      renderCharts();
      return;
    }
    if (!point.inside) {
      view.cursor = null;
      cursorOutput.value = "拖拽平移 · 滚轮缩放 X · Shift + 滚轮缩放 Y";
      renderCharts();
      return;
    }
    view.cursor = {
      x: view.xMin + (view.xMax - view.xMin) * point.xRatio,
      y: view.yMax - (view.yMax - view.yMin) * point.yRatio
    };
    cursorOutput.value = kind === "time"
      ? `${formatTime(view.cursor.x)}  |  ${formatAmplitude(view.cursor.y)}`
      : `${formatFrequency(view.cursor.x)}  |  ${view.cursor.y.toFixed(1)} dB`;
    renderCharts();
  });

  const finishDrag = event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    canvas.classList.remove("is-dragging");
  };
  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);
  canvas.addEventListener("pointerleave", () => {
    if (drag) return;
    view.cursor = null;
    cursorOutput.value = "拖拽平移 · 滚轮缩放 X · Shift + 滚轮缩放 Y";
    renderCharts();
  });

  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const point = pointInPlot(canvas, event);
    if (!point.inside) return;
    const factor = Math.exp(event.deltaY * 0.0015);
    zoomView(kind, event.shiftKey ? "y" : "x", factor, event.shiftKey ? point.yRatio : point.xRatio);
  }, { passive: false });

  canvas.addEventListener("dblclick", () => resetView(kind, false));
}

function updateReadouts(sampleRate) {
  const cutoff = Number(controls.cutoff.value);
  outputs.frequency.value = `${controls.frequency.value} Hz`;
  outputs.secondFrequency.value = `${controls.secondFrequency.value} Hz`;
  outputs.secondAmplitude.value = `${controls.secondAmplitude.value}%`;
  outputs.noise.value = `${controls.noise.value}%`;
  outputs.cutoff.value = `${cutoff} Hz`;
  outputs.sampleInterval.textContent = `${(1000 / sampleRate).toFixed(2)} ms`;
  outputs.nyquist.textContent = `${sampleRate / 2} Hz`;
  outputs.resolution.textContent = `${(sampleRate / FFT_SIZE).toFixed(2)} Hz`;
  const names = { none: "关闭", lowpass: "低通", highpass: "高通" };
  outputs.filterStatus.textContent = controls.filterType.value === "none"
    ? names.none
    : `${names[controls.filterType.value]} · ${cutoff} Hz`;

  const activeFrequencies = [
    Number(controls.frequency.value),
    Number(controls.secondAmplitude.value) > 0 ? Number(controls.secondFrequency.value) : 0
  ];
  warning.hidden = Math.max(...activeFrequencies) < sampleRate / 2;
  controls.cutoff.max = String(Math.max(10, sampleRate / 2 - 5));
  if (Number(controls.cutoff.value) > Number(controls.cutoff.max)) {
    controls.cutoff.value = controls.cutoff.max;
  }
}

function render() {
  const sampleRate = Number(controls.sampleRate.value);
  updateReadouts(sampleRate);
  const signal = makeSignal(sampleRate);
  const filtered = filterSignal(signal, sampleRate);
  const rawSpectrum = fftMagnitudes(signal, controls.windowType.value);
  const filteredSpectrum = fftMagnitudes(filtered, controls.windowType.value);
  latestData = { sampleRate, signal, filtered, rawSpectrum, filteredSpectrum };
  renderCharts();
}

const defaults = {
  waveform: "sine",
  frequency: "50",
  secondFrequency: "120",
  secondAmplitude: "35",
  noise: "8",
  sampleRate: "1000",
  windowType: "hann",
  filterType: "lowpass",
  cutoff: "80"
};

function applyValues(values) {
  Object.entries(values).forEach(([key, value]) => {
    controls[key].value = value;
  });
  render();
}

Object.values(controls).forEach(control => {
  control.addEventListener("input", render);
  control.addEventListener("change", render);
});

document.querySelector("#resetButton").addEventListener("click", () => applyValues(defaults));

document.querySelectorAll("[data-preset]").forEach(button => {
  button.addEventListener("click", () => {
    const preset = button.dataset.preset;
    if (preset === "two-tones") {
      applyValues({ sampleRate: "1000", frequency: "50", secondFrequency: "120", secondAmplitude: "60", windowType: "hann", filterType: "none" });
    } else if (preset === "window") {
      applyValues({ sampleRate: "1000", frequency: "53", secondAmplitude: "0", noise: "0", windowType: "rect", filterType: "none" });
    } else if (preset === "filter") {
      applyValues({ sampleRate: "1000", frequency: "50", secondFrequency: "120", secondAmplitude: "70", windowType: "hann", filterType: "lowpass", cutoff: "80" });
    } else if (preset === "alias") {
      applyValues({ sampleRate: "500", frequency: "350", secondAmplitude: "0", noise: "0", windowType: "hann", filterType: "none" });
    }
  });
});

document.querySelectorAll(".chart-toolbar button").forEach(button => {
  button.addEventListener("click", () => {
    const kind = button.dataset.chart;
    const action = button.dataset.action;
    if (action === "zoom-in") zoomView(kind, "x", 0.65);
    if (action === "zoom-out") zoomView(kind, "x", 1.5);
    if (action === "y-in") zoomView(kind, "y", 0.65);
    if (action === "y-out") zoomView(kind, "y", 1.5);
    if (action === "auto") resetView(kind, true);
    if (action === "reset") resetView(kind, false);
  });
});

attachChartInteractions("time", timeCanvas, chartOutputs.timeCursor);
attachChartInteractions("spectrum", spectrumCanvas, chartOutputs.spectrumCursor);

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderCharts, 100);
});

render();
