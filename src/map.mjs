const SVG_NS = "http://www.w3.org/2000/svg";
const METRES_PER_DEGREE = 111_195;

function draw(parent, tag, attributes, value) {
  const element = parent.ownerDocument.createElementNS(SVG_NS, tag);
  for (const [name, attribute] of Object.entries(attributes)) {
    element.setAttribute(name, attribute);
  }
  if (value !== undefined) element.textContent = value;
  parent.append(element);
  return element;
}

function midpoint([x1, y1], [x2, y2]) {
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

function bounds(points) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function line(parent, [x1, y1], [x2, y2], className) {
  return draw(parent, "line", { x1, y1, x2, y2, class: className });
}

function circle(parent, [cx, cy], r, className) {
  return draw(parent, "circle", { cx, cy, r, class: className });
}

function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height;
}

function drawLabel(layer, text, anchor, reserved, frame, { className, concourse, required = false } = {}) {
  const [x, y] = anchor;
  const width = 16 + text.length * 7;
  const height = 23;
  const directions = [[0, -1], [1, 0], [-1, 0], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]];
  let box;
  let fewestOverlaps = Infinity;

  for (const gap of [12, 23, 36, 52, 70]) {
    for (const [dx, dy] of directions) {
      const candidate = {
        x: Math.max(8, Math.min(frame.width - width - 8, x + dx * (width / 2 + gap) - width / 2)),
        y: Math.max(8, Math.min(frame.height - height - 8, y + dy * (height / 2 + gap) - height / 2)),
        width,
        height,
      };
      const count = reserved.filter((area) => overlaps(candidate, area)).length;
      if (count < fewestOverlaps) {
        box = candidate;
        fewestOverlaps = count;
      }
      if (count === 0) break;
    }
    if (fewestOverlaps === 0) break;
  }

  if (!box || (fewestOverlaps > 0 && !required)) return;
  reserved.push(box);
  const group = draw(layer, "g", { class: `bna-map-label ${className}` });
  if (concourse) group.setAttribute("data-concourse", concourse);
  if (className !== "bna-map-label--concourse") {
    const edge = [
      Math.max(box.x, Math.min(x, box.x + width)),
      Math.max(box.y, Math.min(y, box.y + height)),
    ];
    line(group, anchor, edge, "bna-map-label-leader");
  }
  draw(group, "rect", { ...box, rx: 6 });
  draw(group, "text", {
    x: box.x + width / 2,
    y: box.y + height / 2 + 4,
    "text-anchor": "middle",
  }, text);
}

function makeFrame(points, width, height) {
  const [left, top, right, bottom] = bounds(points);
  const [centerX, centerY] = midpoint([left, top], [right, bottom]);
  const padding = Math.min(65, width * 0.15, height * 0.15);
  const scale = Math.min(
    (width - 2 * padding) / Math.max(1, right - left),
    (height - 2 * padding) / Math.max(1, bottom - top),
  );
  const offsetX = width / 2 - centerX * scale;
  const offsetY = height / 2 - centerY * scale;
  return {
    width,
    height,
    scale,
    offsetX,
    offsetY,
    point: ([x, y]) => [offsetX + x * scale, offsetY + y * scale],
  };
}

function drawGrid(svg, { width, height, scale, offsetX, offsetY }, step) {
  const layer = draw(svg, "g", { class: "bna-map-grid" });
  const gridSize = step * scale;
  // Skip a fine grid on very small displays.
  if (gridSize < 15) return;
  for (let x = offsetX % gridSize; x < width; x += gridSize) {
    if (x >= 0) line(layer, [x, 0], [x, height], "bna-map-grid-line");
  }
  for (let y = offsetY % gridSize; y < height; y += gridSize) {
    if (y >= 0) line(layer, [0, y], [width, y], "bna-map-grid-line");
  }
}

function drawMapKeys(svg, { width, height, scale }, step, reserved) {
  const layer = draw(svg, "g", { class: "bna-map-keys" });
  const northX = width - 24;
  draw(layer, "text", { x: northX, y: 20, "text-anchor": "middle" }, "N");
  draw(layer, "path", {
    d: `M ${northX} 28 l -5 9 l 5 -2 l 5 2 z`,
    class: "bna-map-north",
  });
  reserved.push({ x: northX - 14, y: 8, width: 28, height: 34 });

  const scaleEnd = width - 17;
  const scaleStart = scaleEnd - step * scale;
  const scaleY = height - 20;
  draw(layer, "text", {
    x: (scaleStart + scaleEnd) / 2,
    y: scaleY - 7,
    "text-anchor": "middle",
  }, `${step} m`);
  draw(layer, "path", {
    d: `M ${scaleStart} ${scaleY - 3} v 3 H ${scaleEnd} v -3`,
    class: "bna-map-scale",
  });
  reserved.push({ x: scaleStart - 8, y: scaleY - 22, width: scaleEnd - scaleStart + 16, height: 26 });
}

function drawRunway(layer, points) {
  for (let index = 1; index < points.length; index += 1) {
    line(layer, points[index - 1], points[index], "bna-map-runway");
  }
  const [start, end] = [points[0], points.at(-1)];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy) || 1;
  const capX = -dy * 6 / length;
  const capY = dx * 6 / length;
  for (const [x, y] of [start, end]) {
    line(layer, [x - capX, y - capY], [x + capX, y + capY], "bna-map-threshold");
  }
}

/**
 * Draw a local, north-up schematic from bundled GeoJSON. The page's gate
 * picker supplies keyboard access to the same selection state.
 */
export function createMap(svg, { gates, runways, referencePoint, onSelect }) {
  const [referenceLon, referenceLat] = referencePoint;
  const longitudeScale = Math.cos(referenceLat * Math.PI / 180) * METRES_PER_DEGREE;
  const project = ([lon, lat]) => [
    (lon - referenceLon) * longitudeScale,
    (referenceLat - lat) * METRES_PER_DEGREE,
  ];
  const gatePoints = gates.features.map(({ geometry, properties }) => ({
    ...properties,
    point: project(geometry.coordinates),
  }));
  const runwayLines = runways.features.map(({ geometry, properties }) => ({
    pair: properties.pair,
    points: geometry.coordinates.map(project),
  }));
  let view = "terminal";
  let selected = null;
  let screenGates = [];
  let size = { width: 820, height: 510 };

  svg.classList.add("bna-map");
  svg.setAttribute("role", "img");

  function render() {
    const isTerminal = view === "terminal";
    const points = gatePoints.map(({ point }) => point);
    if (!isTerminal) points.push(...runwayLines.flatMap((runway) => runway.points));
    if (points.length === 0) points.push([0, 0]);
    const frame = makeFrame(points, size.width, size.height);
    const step = isTerminal ? 100 : 500;
    const radius = isTerminal ? 4.5 : 2.8;
    const reserved = [];

    svg.setAttribute("viewBox", `0 0 ${frame.width} ${frame.height}`);
    svg.setAttribute("aria-label", isTerminal
      ? "BNA terminal schematic with gate locations"
      : "BNA airfield schematic with gate locations and runway thresholds");
    svg.replaceChildren();
    draw(svg, "rect", { class: "bna-map-background", width: frame.width, height: frame.height });
    drawGrid(svg, frame, step);

    const runwayLayer = draw(svg, "g", { class: "bna-map-runways" });
    if (!isTerminal) {
      for (const runway of runwayLines) drawRunway(runwayLayer, runway.points.map(frame.point));
    }

    const gateLayer = draw(svg, "g", { class: "bna-map-gates" });
    screenGates = gatePoints.map((gate) => {
      const point = frame.point(gate.point);
      const [x, y] = point;
      const group = draw(gateLayer, "g", {
        "data-concourse": gate.concourse,
        "data-gate": gate.code,
        class: "bna-map-gate",
      });
      circle(group, point, 10, "bna-map-gate-target");
      circle(group, point, radius, "bna-map-gate-dot");
      reserved.push({ x: x - 6, y: y - 6, width: 12, height: 12 });
      return { ...gate, point };
    });

    drawMapKeys(svg, frame, step, reserved);
    const labels = draw(svg, "g", { class: "bna-map-labels" });
    const selectedGate = screenGates.find((gate) => gate.code === selected);
    if (selectedGate) {
      const group = draw(labels, "g", { "data-concourse": selectedGate.concourse });
      circle(group, selectedGate.point, 10, "bna-map-selection-halo");
      circle(group, selectedGate.point, 6, "bna-map-selection-dot");
      drawLabel(labels, selectedGate.code, selectedGate.point, reserved, frame, {
        className: "bna-map-label--selected",
        required: true,
      });
    }

    if (isTerminal) {
      const concourses = new Map();
      for (const gate of screenGates) {
        if (!concourses.has(gate.concourse)) concourses.set(gate.concourse, []);
        concourses.get(gate.concourse).push(gate.point);
      }
      for (const [concourse, coordinates] of concourses) {
        const [left, top, right, bottom] = bounds(coordinates);
        const text = concourse.length === 1 ? `Concourse ${concourse}` : concourse;
        drawLabel(labels, text, midpoint([left, top], [right, bottom]), reserved, frame, {
          className: "bna-map-label--concourse",
          concourse,
        });
      }
    } else {
      for (const runway of runwayLines) {
        const start = frame.point(runway.points[0]);
        const end = frame.point(runway.points.at(-1));
        drawLabel(labels, runway.pair, midpoint(start, end), reserved, frame, {
          className: "bna-map-label--runway",
          required: true,
        });
      }
    }
  }

  function measure() {
    const width = svg.clientWidth;
    const height = svg.clientHeight;
    if (width > 0 && height > 0) size = { width, height };
  }

  svg.addEventListener("click", (event) => {
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const cursor = svg.createSVGPoint();
    cursor.x = event.clientX;
    cursor.y = event.clientY;
    const { x, y } = cursor.matrixTransform(matrix.inverse());
    let nearest;
    let distance = 12;
    for (const gate of screenGates) {
      const gap = Math.hypot(gate.point[0] - x, gate.point[1] - y);
      if (gap < distance) {
        nearest = gate;
        distance = gap;
      }
    }
    if (nearest) onSelect(nearest.code);
  });

  measure();
  render();
  const observer = new ResizeObserver(() => {
    const previous = size;
    measure();
    if (size.width !== previous.width || size.height !== previous.height) render();
  });
  observer.observe(svg);

  return {
    setView(nextView) {
      if (nextView === view) return;
      view = nextView;
      render();
    },
    setSelected(code) {
      if (code === selected) return;
      selected = code;
      render();
    },
  };
}
