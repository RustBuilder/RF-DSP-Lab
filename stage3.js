"use strict";

const PADDING = { left: 54, right: 18, top: 18, bottom: 34 };

const controls = {
  mode: document.querySelector("#digitalMode"),
  bits: document.querySelector("#bitPattern"),
  symbolRate: document.querySelector("#symbolRate"),
  symbolRateInput: document.querySelector("#symbolRateInput"),
  samplesPerSymbol: document.querySelector("#samplesPerSymbol"),
  snr: document.querySelector("#snr"),
  snrInput: document.querySelector("#snrInput"),
  separation: document.querySelector("#frequencySeparation"),
  separationInput: document.querySelector("#frequencySeparationInput"),
  phase: document.querySelector("#phaseOffset"),
  phaseInput: document.querySelector("#phaseOffsetInput")
};

const outputs = {
  symbolRate: document.querySelector("#symbolRateValue"),
  snr: document.querySelector("#snrValue"),
  separation: document.querySelector("#frequencySeparationValue"),
  phase: document.querySelector("#phaseOffsetValue"),
  bitsPerSymbol: document.querySelector("#bitsPerSymbolMetric"),
  bitRate: document.querySelector("#bitRateMetric"),
  ber: document.querySelector("#berMetric"),
  efficiency: document.querySelector("#efficiencyMetric"),
  mappingTitle: document.querySelector("#mappingTitle"),
  mappingText: document.querySelector("#mappingText"),
  modeExplanation: document.querySelector("#modeExplanation"),
  waveformBadge: document.querySelector("#waveformBadge"),
  waveformNote: document.querySelector("#waveformNote"),
  constellationBadge: document.querySelector("#constellationBadge"),
  berBadge: document.querySelector("#berBadge"),
  waveformCursor: document.querySelector("#waveformCursor"),
  constellationCursor: document.querySelector("#constellationCursor"),
  eyeCursor: document.querySelector("#eyeCursor"),
  berCursor: document.querySelector("#berCursor"),
  waveformRange: document.querySelector("#waveformRange")
};

const canvases = {
  waveform: document.querySelector("#digitalWaveCanvas"),
  constellation: document.querySelector("#constellationCanvas"),
  eye: document.querySelector("#eyeCanvas"),
  ber: document.querySelector("#berCanvas")
};

const chartViews = {
  waveform: { xMin: 0, xMax: 8, yMin: -1.6, yMax: 1.6, cursor: null },
  constellation: { xMin: -2, xMax: 2, yMin: -2, yMax: 2, cursor: null },
  eye: { xMin: 0, xMax: 2, yMin: -1.6, yMax: 1.6, cursor: null },
  ber: { xMin: -8, xMax: 24, yMin: 1e-4, yMax: 1, cursor: null }
};

let latest = null;
let randomState = 0x12345678;

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
  return value >= 1000 ? `${(value / 1000).toFixed(value % 1000 ? 2 : 0)} k${suffix}` : `${value} ${suffix}`;
}

function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + z / 2);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196
    + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398
    + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

function qFunction(x) {
  return 0.5 * erfc(x / Math.SQRT2);
}

function theoreticalBer(mode, ebn0Db) {
  const linear = 10 ** (ebn0Db / 10);
  if (mode === "ask") return qFunction(Math.sqrt(linear));
  if (mode === "fsk") return qFunction(Math.sqrt(linear));
  return qFunction(Math.sqrt(2 * linear));
}

function sanitizeBits() {
  let bits = controls.bits.value.replace(/[^01]/g, "").slice(0, 96);
  if (!bits) bits = "0";
  if (controls.mode.value === "qpsk" && bits.length % 2) bits += "0";
  controls.bits.value = bits;
  return bits.split("").map(Number);
}

function idealSymbols(bits, mode) {
  if (mode === "qpsk") {
    const map = {
      "00": { i: 1, q: 1, label: "00" },
      "01": { i: -1, q: 1, label: "01" },
      "11": { i: -1, q: -1, label: "11" },
      "10": { i: 1, q: -1, label: "10" }
    };
    const symbols = [];
    for (let index = 0; index < bits.length; index += 2) {
      const symbol = map[`${bits[index]}${bits[index + 1]}`];
      symbols.push({ ...symbol, i: symbol.i / Math.SQRT2, q: symbol.q / Math.SQRT2 });
    }
    return symbols;
  }
  return bits.map(bit => {
    if (mode === "ask") return { i: bit, q: 0, label: String(bit) };
    if (mode === "fsk") return { i: bit ? 1 : -1, q: 0, label: String(bit), tone: bit };
    return { i: bit ? 1 : -1, q: 0, label: String(bit) };
  });
}

function noisySymbols(symbols, mode) {
  const snrLinear = 10 ** (Number(controls.snr.value) / 10);
  const sigma = Math.sqrt(1 / (2 * snrLinear));
  const phase = Number(controls.phase.value) * Math.PI / 180;
  return symbols.map(symbol => {
    let i = symbol.i + sigma * gaussian();
    let q = symbol.q + sigma * gaussian();
    if (mode === "ask") q *= 0.55;
    return {
      ...symbol,
      receivedI: i * Math.cos(phase) - q * Math.sin(phase),
      receivedQ: i * Math.sin(phase) + q * Math.cos(phase)
    };
  });
}

function decide(symbols, mode) {
  const bits = [];
  symbols.forEach(symbol => {
    if (mode === "ask") bits.push(symbol.receivedI > 0.5 ? 1 : 0);
    if (mode === "bpsk" || mode === "fsk") bits.push(symbol.receivedI >= 0 ? 1 : 0);
    if (mode === "qpsk") {
      const iPositive = symbol.receivedI >= 0;
      const qPositive = symbol.receivedQ >= 0;
      if (iPositive && qPositive) bits.push(0, 0);
      else if (!iPositive && qPositive) bits.push(0, 1);
      else if (!iPositive && !qPositive) bits.push(1, 1);
      else bits.push(1, 0);
    }
  });
  return bits;
}

function makeWaveform(symbols, mode) {
  const sps = Number(controls.samplesPerSymbol.value);
  const values = [];
  const carrierCycles = 3;
  const separationRatio = Number(controls.separation.value) / Number(controls.symbolRate.value);
  symbols.forEach((symbol, symbolIndex) => {
    for (let sample = 0; sample < sps; sample += 1) {
      const local = sample / sps;
      const phase = 2 * Math.PI * carrierCycles * (symbolIndex + local);
      let value;
      if (mode === "ask") value = symbol.i * Math.cos(phase);
      else if (mode === "fsk") {
        const cycles = carrierCycles + (symbol.tone ? separationRatio * 0.7 : -separationRatio * 0.7);
        value = Math.cos(2 * Math.PI * cycles * (symbolIndex + local));
      } else if (mode === "bpsk") value = symbol.i * Math.cos(phase);
      else value = symbol.i * Math.cos(phase) - symbol.q * Math.sin(phase);
      values.push({ x: symbolIndex + local, y: value });
    }
  });
  return { values, symbols: symbols.length, sps };
}

function prepareCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * ratio);
  canvas.height = Math.round(rect.height * ratio);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);
  return { context, width: rect.width, height: rect.height };
}

function makeTicks(min, max, count = 5) {
  return Array.from({ length: count }, (_, index) => min + (max - min) * index / (count - 1));
}

function drawAxes(context, width, height, view, xFormatter, yFormatter) {
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;
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
    context.fillText(xFormatter(value), x, height - 12);
  });
  makeTicks(view.yMax, view.yMin).forEach((value, index, ticks) => {
    const y = PADDING.top + plotHeight * index / (ticks.length - 1);
    context.beginPath();
    context.moveTo(PADDING.left, y);
    context.lineTo(width - PADDING.right, y);
    context.stroke();
    context.textAlign = "right";
    context.fillText(yFormatter(value), PADDING.left - 8, y + 4);
  });
  context.strokeStyle = "#30423d";
  context.strokeRect(PADDING.left, PADDING.top, plotWidth, plotHeight);
}

function valueToPixel(value, min, max, start, length, invert = false) {
  const ratio = (value - min) / (max - min);
  return invert ? start + length * (1 - ratio) : start + length * ratio;
}

function drawCrosshair(context, width, height, view) {
  if (!view.cursor) return;
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;
  const x = valueToPixel(view.cursor.x, view.xMin, view.xMax, PADDING.left, plotWidth);
  const y = valueToPixel(view.cursor.y, view.yMin, view.yMax, PADDING.top, plotHeight, true);
  context.save();
  context.strokeStyle = "rgba(183, 255, 60, 0.45)";
  context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(x, PADDING.top);
  context.lineTo(x, height - PADDING.bottom);
  context.moveTo(PADDING.left, y);
  context.lineTo(width - PADDING.right, y);
  context.stroke();
  context.restore();
}

function drawWaveform() {
  const view = chartViews.waveform;
  const { context, width, height } = prepareCanvas(canvases.waveform);
  drawAxes(context, width, height, view, value => `${value.toFixed(1)} sym`, value => value.toFixed(1));
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;
  context.save();
  context.beginPath();
  context.rect(PADDING.left, PADDING.top, plotWidth, plotHeight);
  context.clip();
  context.strokeStyle = "#52645e";
  context.setLineDash([5, 6]);
  for (let symbol = Math.ceil(view.xMin); symbol <= Math.floor(view.xMax); symbol += 1) {
    const x = valueToPixel(symbol, view.xMin, view.xMax, PADDING.left, plotWidth);
    context.beginPath();
    context.moveTo(x, PADDING.top);
    context.lineTo(x, height - PADDING.bottom);
    context.stroke();
  }
  context.setLineDash([]);
  context.beginPath();
  context.strokeStyle = "#b7ff3c";
  context.lineWidth = 1.5;
  latest.waveform.values.forEach((point, index) => {
    if (point.x < view.xMin || point.x > view.xMax) return;
    const x = valueToPixel(point.x, view.xMin, view.xMax, PADDING.left, plotWidth);
    const y = valueToPixel(point.y, view.yMin, view.yMax, PADDING.top, plotHeight, true);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.restore();
  drawCrosshair(context, width, height, view);
  outputs.waveformRange.value = `${view.xMin.toFixed(2)} - ${view.xMax.toFixed(2)} sym | ${view.yMin.toFixed(2)} - ${view.yMax.toFixed(2)}`;
}

function idealPoints(mode) {
  if (mode === "ask") return [{ i: 0, q: 0, label: "0" }, { i: 1, q: 0, label: "1" }];
  if (mode === "qpsk") return idealSymbols([0, 0, 0, 1, 1, 1, 1, 0], "qpsk");
  return [{ i: -1, q: 0, label: "0" }, { i: 1, q: 0, label: "1" }];
}

function drawConstellation() {
  const view = chartViews.constellation;
  const { context, width, height } = prepareCanvas(canvases.constellation);
  drawAxes(context, width, height, view, value => value.toFixed(1), value => value.toFixed(1));
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;
  const toX = value => valueToPixel(value, view.xMin, view.xMax, PADDING.left, plotWidth);
  const toY = value => valueToPixel(value, view.yMin, view.yMax, PADDING.top, plotHeight, true);
  context.strokeStyle = "#52645e";
  context.beginPath();
  context.moveTo(toX(0), PADDING.top);
  context.lineTo(toX(0), height - PADDING.bottom);
  context.moveTo(PADDING.left, toY(0));
  context.lineTo(width - PADDING.right, toY(0));
  context.stroke();
  idealPoints(latest.mode).forEach(point => {
    context.beginPath();
    context.strokeStyle = "#b7ff3c";
    context.lineWidth = 2;
    context.arc(toX(point.i), toY(point.q), 8, 0, 2 * Math.PI);
    context.stroke();
    context.fillStyle = "#b7ff3c";
    context.fillText(point.label, toX(point.i) + 11, toY(point.q) - 9);
  });
  latest.received.forEach(point => {
    context.beginPath();
    context.fillStyle = point.error ? "rgba(255, 107, 100, 0.9)" : "rgba(69, 232, 212, 0.78)";
    context.arc(toX(point.receivedI), toY(point.receivedQ), point.error ? 4.5 : 3.4, 0, 2 * Math.PI);
    context.fill();
  });
  drawCrosshair(context, width, height, view);
}

function drawEye() {
  const view = chartViews.eye;
  const { context, width, height } = prepareCanvas(canvases.eye);
  drawAxes(context, width, height, view, value => `${value.toFixed(1)}T`, value => value.toFixed(1));
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;
  const traces = Math.min(56, latest.received.length - 1);
  for (let trace = 0; trace < traces; trace += 1) {
    const first = latest.received[trace];
    const second = latest.received[trace + 1];
    context.beginPath();
    context.strokeStyle = `rgba(69, 232, 212, ${0.11 + trace / Math.max(1, traces) * 0.09})`;
    for (let index = 0; index < 64; index += 1) {
      const position = index / 63;
      const transition = 1 / (1 + Math.exp(-(position - 0.5) * 20));
      let firstValue = first.receivedI;
      let secondValue = second.receivedI;
      if (latest.mode === "ask") {
        firstValue -= 0.5;
        secondValue -= 0.5;
      }
      const value = firstValue * (1 - transition) + secondValue * transition;
      const xValue = position * 2;
      const x = valueToPixel(xValue, view.xMin, view.xMax, PADDING.left, plotWidth);
      const y = valueToPixel(value, view.yMin, view.yMax, PADDING.top, plotHeight, true);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }
  drawCrosshair(context, width, height, view);
}

function drawBerCurve() {
  const view = chartViews.ber;
  const { context, width, height } = prepareCanvas(canvases.ber);
  const logView = { ...view, yMin: Math.log10(view.yMin), yMax: Math.log10(view.yMax) };
  drawAxes(context, width, height, logView, value => `${value.toFixed(0)} dB`, value => `1e${Math.round(value)}`);
  const plotWidth = width - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;
  const toX = value => valueToPixel(value, view.xMin, view.xMax, PADDING.left, plotWidth);
  const toY = value => valueToPixel(Math.log10(clamp(value, view.yMin, view.yMax)), logView.yMin, logView.yMax, PADDING.top, plotHeight, true);
  context.beginPath();
  context.strokeStyle = "#45e8d4";
  context.lineWidth = 1.6;
  for (let db = view.xMin; db <= view.xMax; db += 0.25) {
    const x = toX(db);
    const y = toY(theoreticalBer(latest.mode, db));
    if (db === view.xMin) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  const currentBer = Math.max(latest.ber, 1 / Math.max(1, latest.sentBits.length * 20));
  context.beginPath();
  context.fillStyle = "#b7ff3c";
  context.arc(toX(Number(controls.snr.value)), toY(currentBer), 6, 0, 2 * Math.PI);
  context.fill();
}

function renderCharts() {
  if (!latest) return;
  drawWaveform();
  drawConstellation();
  drawEye();
  drawBerCurve();
}

function chartBounds(kind) {
  if (kind === "waveform") return { xMin: 0, xMax: Math.max(1, latest.symbols.length), yMin: -2.5, yMax: 2.5, minX: 0.25, minY: 0.1 };
  if (kind === "constellation") return { xMin: -3, xMax: 3, yMin: -3, yMax: 3, minX: 0.3, minY: 0.3 };
  if (kind === "eye") return { xMin: 0, xMax: 2, yMin: -3, yMax: 3, minX: 2, minY: 0.1 };
  return { xMin: -8, xMax: 24, yMin: 1e-4, yMax: 1, minX: 2, minY: 1e-4 };
}

function constrainView(kind) {
  const view = chartViews[kind];
  const bounds = chartBounds(kind);
  const xSpan = view.xMax - view.xMin;
  if (xSpan >= bounds.xMax - bounds.xMin) {
    view.xMin = bounds.xMin;
    view.xMax = bounds.xMax;
  } else {
    if (view.xMin < bounds.xMin) {
      view.xMin = bounds.xMin;
      view.xMax = bounds.xMin + xSpan;
    }
    if (view.xMax > bounds.xMax) {
      view.xMax = bounds.xMax;
      view.xMin = bounds.xMax - xSpan;
    }
  }
  if (kind !== "ber") {
    const ySpan = view.yMax - view.yMin;
    if (view.yMin < bounds.yMin) {
      view.yMin = bounds.yMin;
      view.yMax = bounds.yMin + ySpan;
    }
    if (view.yMax > bounds.yMax) {
      view.yMax = bounds.yMax;
      view.yMin = bounds.yMax - ySpan;
    }
  }
}

function zoomView(kind, axis, factor, anchorRatio = 0.5) {
  const view = chartViews[kind];
  const bounds = chartBounds(kind);
  if (axis === "x") {
    const span = view.xMax - view.xMin;
    const nextSpan = clamp(span * factor, bounds.minX, bounds.xMax - bounds.xMin);
    const anchor = view.xMin + span * anchorRatio;
    view.xMin = anchor - nextSpan * anchorRatio;
    view.xMax = view.xMin + nextSpan;
  } else if (kind !== "ber") {
    const span = view.yMax - view.yMin;
    const nextSpan = clamp(span * factor, bounds.minY, bounds.yMax - bounds.yMin);
    const anchor = view.yMin + span * (1 - anchorRatio);
    view.yMin = anchor - nextSpan * (1 - anchorRatio);
    view.yMax = view.yMin + nextSpan;
  }
  constrainView(kind);
  renderCharts();
}

function resetView(kind, fitAll = false) {
  if (kind === "waveform") {
    chartViews.waveform.xMin = 0;
    chartViews.waveform.xMax = fitAll ? Math.max(1, latest.symbols.length) : Math.min(8, latest.symbols.length);
    chartViews.waveform.yMin = -1.6;
    chartViews.waveform.yMax = 1.6;
  }
  if (kind === "constellation") Object.assign(chartViews.constellation, { xMin: -2, xMax: 2, yMin: -2, yMax: 2 });
  if (kind === "eye") Object.assign(chartViews.eye, { xMin: 0, xMax: 2, yMin: -1.6, yMax: 1.6 });
  renderCharts();
}

function pointInPlot(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const width = rect.width - PADDING.left - PADDING.right;
  const height = rect.height - PADDING.top - PADDING.bottom;
  return {
    inside: x >= PADDING.left && x <= rect.width - PADDING.right && y >= PADDING.top && y <= rect.height - PADDING.bottom,
    xRatio: clamp((x - PADDING.left) / width, 0, 1),
    yRatio: clamp((y - PADDING.top) / height, 0, 1),
    plotWidth: width,
    plotHeight: height
  };
}

function attachChart(kind, canvas, output) {
  const view = chartViews[kind];
  let drag = null;
  canvas.addEventListener("pointerdown", event => {
    const point = pointInPlot(canvas, event);
    if (!point.inside || kind === "ber") return;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-dragging");
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, xMin: view.xMin, xMax: view.xMax, yMin: view.yMin, yMax: view.yMax };
  });
  canvas.addEventListener("pointermove", event => {
    const point = pointInPlot(canvas, event);
    if (drag) {
      const dx = (event.clientX - drag.x) / point.plotWidth * (drag.xMax - drag.xMin);
      const dy = (event.clientY - drag.y) / point.plotHeight * (drag.yMax - drag.yMin);
      view.xMin = drag.xMin - dx;
      view.xMax = drag.xMax - dx;
      view.yMin = drag.yMin + dy;
      view.yMax = drag.yMax + dy;
      constrainView(kind);
      renderCharts();
      return;
    }
    if (!point.inside) return;
    view.cursor = {
      x: view.xMin + (view.xMax - view.xMin) * point.xRatio,
      y: view.yMax - (view.yMax - view.yMin) * point.yRatio
    };
    output.value = kind === "constellation"
      ? `I ${view.cursor.x.toFixed(2)} | Q ${view.cursor.y.toFixed(2)}`
      : `${view.cursor.x.toFixed(2)} | ${view.cursor.y.toFixed(2)}`;
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
    renderCharts();
  });
  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const point = pointInPlot(canvas, event);
    if (!point.inside || kind === "ber") return;
    zoomView(kind, event.shiftKey ? "y" : "x", Math.exp(event.deltaY * 0.0015), event.shiftKey ? point.yRatio : point.xRatio);
  }, { passive: false });
  canvas.addEventListener("dblclick", () => resetView(kind, false));
}

function updateDecisionRows(sent, decided) {
  const rows = [
    { label: "发送", values: sent, compare: false },
    { label: "判决", values: decided, compare: true }
  ];
  document.querySelector("#decisionRows").innerHTML = rows.map(row => `
    <div class="decision-row">
      <span>${row.label}</span>
      <div class="decision-bits">
        ${row.values.map((bit, index) => `<i class="${row.compare && bit !== sent[index] ? "error" : ""}">${bit}</i>`).join("")}
      </div>
    </div>
  `).join("");
}

function updateBitChips(bits) {
  document.querySelector("#bitChips").innerHTML = bits.map(bit => `<i class="${bit ? "one" : ""}">${bit}</i>`).join("");
}

function updateCopy() {
  const mode = latest.mode;
  const bitsPerSymbol = mode === "qpsk" ? 2 : 1;
  const symbolRate = Number(controls.symbolRate.value);
  const descriptions = {
    ask: ["2-ASK / OOK：用幅度表示比特", "0 对应无载波或低幅度，1 对应高幅度。结构简单，但幅度噪声会直接影响判决。"],
    fsk: ["2-FSK：用两个频率表示比特", "0 和 1 使用不同频率。包络基本不变，对幅度扰动较稳健，但通常占用更多带宽。"],
    bpsk: ["BPSK：一个比特，两种相位", "比特 0 和 1 分别映射到相差 180° 的两个点。两个点距离较远，抗噪性能通常很好。"],
    qpsk: ["QPSK：两比特组成一个码元", "四个相位点分别代表 00、01、11、10。同样码元率下，比特率是 BPSK 的两倍。"]
  };
  const modeNotes = {
    ask: "幅度携带信息：观察比特 0 时载波消失或减弱。",
    fsk: "频率携带信息：观察不同码元内波形疏密改变。",
    bpsk: "相位携带信息：码元改变时可能出现 180° 相位翻转。",
    qpsk: "I/Q 两路共同携带信息，每个码元代表两个比特。"
  };
  outputs.symbolRate.value = formatRate(symbolRate, "Bd");
  outputs.snr.value = `${controls.snr.value} dB`;
  outputs.separation.value = formatRate(Number(controls.separation.value), "Hz");
  outputs.phase.value = `${controls.phase.value}°`;
  outputs.bitsPerSymbol.textContent = `${bitsPerSymbol} bit${bitsPerSymbol > 1 ? "s" : ""}`;
  outputs.bitRate.textContent = formatRate(symbolRate * bitsPerSymbol, "b/s");
  outputs.ber.textContent = `${(latest.ber * 100).toFixed(2)}% (${latest.errors}/${latest.sentBits.length})`;
  outputs.efficiency.textContent = `${bitsPerSymbol} bit/s/Hz`;
  outputs.mappingTitle.textContent = descriptions[mode][0];
  outputs.mappingText.textContent = descriptions[mode][1];
  outputs.modeExplanation.textContent = modeNotes[mode];
  outputs.waveformNote.textContent = modeNotes[mode];
  outputs.waveformBadge.textContent = `显示 ${Math.min(8, latest.symbols.length)} / ${latest.symbols.length} 个码元`;
  outputs.constellationBadge.textContent = `${latest.received.length} 个接收点 · ${latest.errors} 个错误`;
  outputs.berBadge.textContent = `当前 ${controls.snr.value} dB · BER ${(latest.ber * 100).toFixed(2)}%`;
  document.querySelector("#frequencySeparationGroup").hidden = mode !== "fsk";
}

function render() {
  randomState = 0x12345678 + Number(controls.snr.value) * 97 + Number(controls.phase.value) * 13 + controls.mode.value.length * 31;
  const mode = controls.mode.value;
  const sentBits = sanitizeBits();
  const symbols = idealSymbols(sentBits, mode);
  const received = noisySymbols(symbols, mode);
  const decided = decide(received, mode).slice(0, sentBits.length);
  const errors = sentBits.reduce((count, bit, index) => count + (bit !== decided[index] ? 1 : 0), 0);
  const errorSymbols = received.map((symbol, symbolIndex) => {
    const start = mode === "qpsk" ? symbolIndex * 2 : symbolIndex;
    const length = mode === "qpsk" ? 2 : 1;
    return { ...symbol, error: sentBits.slice(start, start + length).some((bit, offset) => bit !== decided[start + offset]) };
  });
  latest = {
    mode,
    sentBits,
    symbols,
    received: errorSymbols,
    decided,
    errors,
    ber: errors / sentBits.length,
    waveform: makeWaveform(symbols, mode)
  };
  updateCopy();
  updateBitChips(sentBits);
  updateDecisionRows(sentBits, decided);
  resetView("waveform", false);
  renderCharts();
}

function syncPair(range, input) {
  const value = clamp(Number(input.value) || 0, Number(range.min), Number(range.max));
  range.value = String(value);
  input.value = String(value);
  render();
}

const defaults = {
  mode: "bpsk",
  bits: "1101001011100010",
  symbolRate: "1000",
  samplesPerSymbol: "32",
  snr: "8",
  separation: "1000",
  phase: "0"
};

function applyValues(values) {
  Object.entries(values).forEach(([key, value]) => {
    controls[key].value = value;
    if (controls[`${key}Input`]) controls[`${key}Input`].value = value;
  });
  render();
}

["mode", "bits", "samplesPerSymbol"].forEach(key => {
  controls[key].addEventListener("input", render);
  controls[key].addEventListener("change", render);
});

[
  [controls.symbolRate, controls.symbolRateInput],
  [controls.snr, controls.snrInput],
  [controls.separation, controls.separationInput],
  [controls.phase, controls.phaseInput]
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

document.querySelector("#randomBits").addEventListener("click", () => {
  randomState = Date.now() & 0xffffffff;
  const length = controls.mode.value === "qpsk" ? 48 : 32;
  controls.bits.value = Array.from({ length }, () => random() > 0.5 ? "1" : "0").join("");
  render();
});

document.querySelector("#resetStage3").addEventListener("click", () => applyValues(defaults));

document.querySelectorAll("[data-digital-preset]").forEach(button => {
  button.addEventListener("click", () => {
    const preset = button.dataset.digitalPreset;
    if (preset === "compare") {
      const modes = ["ask", "fsk", "bpsk", "qpsk"];
      applyValues({ mode: modes[(modes.indexOf(controls.mode.value) + 1) % modes.length], snr: "10", phase: "0" });
    }
    if (preset === "noise") applyValues({ mode: "bpsk", snr: "-2", phase: "0", bits: "11010010111000100101100111001010" });
    if (preset === "phase") applyValues({ mode: "qpsk", snr: "12", phase: "40", bits: "00011110011011000001111001101100" });
    if (preset === "efficiency") applyValues({ mode: controls.mode.value === "qpsk" ? "bpsk" : "qpsk", symbolRate: "2000", snr: "10", phase: "0" });
  });
});

document.querySelectorAll("[data-digital-chart]").forEach(button => {
  button.addEventListener("click", () => {
    const kind = button.dataset.digitalChart;
    const action = button.dataset.action;
    if (action === "zoom-in") zoomView(kind, "x", 0.65);
    if (action === "zoom-out") zoomView(kind, "x", 1.5);
    if (action === "y-in") zoomView(kind, "y", 0.65);
    if (action === "y-out") zoomView(kind, "y", 1.5);
    if (action === "auto") resetView(kind, true);
    if (action === "reset") resetView(kind, false);
  });
});

attachChart("waveform", canvases.waveform, outputs.waveformCursor);
attachChart("constellation", canvases.constellation, outputs.constellationCursor);
attachChart("eye", canvases.eye, outputs.eyeCursor);

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderCharts, 100);
});

render();
