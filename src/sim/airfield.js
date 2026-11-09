// Airfield model: taxi routing graph, gate stands and runway geometry.
//
// Sources:
//   - data/osm/bna-airfield.geojson  OSM taxiways (with node ids) and gate lead-in lines
//   - data/gates.geojson             BNA gate survey (nose-wheel stop positions)
//   - data/runways.geojson           FAA runway thresholds
//
// Everything is converted into the local metric frame from geo.js.

import { dist2, norm2, projectOnSegment, sub, vectorHeading, dot2 } from './geo.js';

const RUNWAY_ACCESS_LATERAL = 80; // metres from centreline that still counts as a runway connector
const LEAD_IN_MATCH = 9; // metres between a surveyed stop and an OSM lead-in line

/** Tiny binary heap for Dijkstra. */
class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(key, value) {
    const a = this.items;
    a.push([key, value]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Parse a runway pair like "2L/20R" into its two ends' designators. */
const runwayEnds = (pair) => pair.split('/').map((d) => d.replace(/^0+/, ''));

export function buildAirfield({ frame, osm, gates, runways }) {
  const nodes = new Map(); // id → { id, p: [x, y], edges: Map<id, weight> }
  let syntheticId = -1;
  const addNode = (id, p) => {
    if (!nodes.has(id)) nodes.set(id, { id, p, edges: new Map() });
    return nodes.get(id);
  };
  const link = (a, b) => {
    const w = dist2(nodes.get(a).p, nodes.get(b).p);
    nodes.get(a).edges.set(b, w);
    nodes.get(b).edges.set(a, w);
  };
  const unlink = (a, b) => {
    nodes.get(a).edges.delete(b);
    nodes.get(b).edges.delete(a);
  };

  // --- 1. Taxiway graph ------------------------------------------------------
  const features = osm?.features ?? [];
  const taxiways = features.filter((f) => f.properties.aeroway === 'taxiway' && f.geometry.type === 'LineString');
  for (const feature of taxiways) {
    const ids = feature.properties.nodes;
    const coords = feature.geometry.coordinates;
    ids.forEach((id, i) => addNode(id, frame.toLocal(coords[i])));
    for (let i = 1; i < ids.length; i += 1) link(ids[i - 1], ids[i]);
  }
  const taxiwayNodeIds = [...nodes.keys()];

  /** Nearest graph edge to a point (each undirected edge is visited once). */
  const nearestEdge = (p, maxDistance = Infinity, filter = () => true) => {
    let best = null;
    for (const node of nodes.values()) {
      for (const [otherId] of node.edges) {
        if (otherId < node.id) continue;
        const other = nodes.get(otherId);
        if (!filter(node, other)) continue;
        const hit = projectOnSegment(p, node.p, other.p);
        if (hit.distance < maxDistance && (!best || hit.distance < best.distance)) {
          best = { ...hit, a: node.id, b: otherId };
        }
      }
    }
    return best;
  };

  /** Split edge a–b at point p (unless p is at an end) and return the node id there. */
  const splitEdge = (a, b, p) => {
    if (dist2(nodes.get(a).p, p) < 1) return a;
    if (dist2(nodes.get(b).p, p) < 1) return b;
    const id = syntheticId;
    syntheticId -= 1;
    addNode(id, p);
    unlink(a, b);
    link(a, id);
    link(id, b);
    return id;
  };

  // --- 2. Runways --------------------------------------------------------------
  const runwayEndsById = new Map();
  const runwayPairs = [];
  for (const feature of runways.features) {
    const pair = feature.properties.pair;
    const [idA, idB] = runwayEnds(pair);
    const A = frame.toLocal(feature.geometry.coordinates[0]);
    const B = frame.toLocal(feature.geometry.coordinates.at(-1));
    const length = dist2(A, B);
    const dirAB = norm2(sub(B, A));
    const record = { pair, A, B, length, dir: dirAB, access: [] };
    runwayPairs.push(record);

    // Taxiway nodes close to this runway's centreline become access candidates.
    const candidates = [];
    for (const id of taxiwayNodeIds) {
      const node = nodes.get(id);
      const rel = sub(node.p, A);
      const s = dot2(rel, dirAB);
      const lateral = rel[0] * dirAB[1] - rel[1] * dirAB[0]; // + = right of A→B
      if (s < -120 || s > length + 120 || Math.abs(lateral) > RUNWAY_ACCESS_LATERAL) continue;
      candidates.push({ id, s, lateral });
    }
    // Cluster along the runway; within a cluster keep the closest node on each side.
    candidates.sort((a, b) => a.s - b.s);
    const clusters = [];
    for (const c of candidates) {
      const last = clusters.at(-1);
      if (last && c.s - last.sMax < 45) {
        last.items.push(c);
        last.sMax = c.s;
      } else {
        clusters.push({ items: [c], sMax: c.s });
      }
    }
    for (const cluster of clusters) {
      const onCentre = cluster.items.filter((c) => Math.abs(c.lateral) < 3);
      let centreId;
      let s;
      if (onCentre.length) {
        // OSM already joins this connector to the runway.
        const best = onCentre.reduce((a, b) => (Math.abs(a.lateral) < Math.abs(b.lateral) ? a : b));
        centreId = best.id;
        s = best.s;
      } else {
        const sides = [cluster.items.filter((c) => c.lateral > 0), cluster.items.filter((c) => c.lateral < 0)]
          .filter((side) => side.length)
          .map((side) => side.reduce((a, b) => (Math.abs(a.lateral) < Math.abs(b.lateral) ? a : b)));
        s = sides.reduce((sum, c) => sum + c.s, 0) / sides.length;
        const centre = [A[0] + dirAB[0] * s, A[1] + dirAB[1] * s];
        centreId = syntheticId;
        syntheticId -= 1;
        addNode(centreId, centre);
        for (const side of sides) link(side.id, centreId);
      }
      if (s >= -60 && s <= length + 60) record.access.push({ nodeId: centreId, s });
    }

    for (const [id, threshold, opposite, dir, fromA] of [
      [idA, A, B, dirAB, true],
      [idB, B, A, [-dirAB[0], -dirAB[1]], false],
    ]) {
      runwayEndsById.set(id, {
        id,
        pair,
        threshold,
        opposite,
        dir,
        heading: vectorHeading(dir),
        length,
        /** Access points measured from this end's threshold. */
        get access() {
          return record.access.map((a) => ({ nodeId: a.nodeId, s: fromA ? a.s : length - a.s }));
        },
      });
    }
  }

  // --- 3. Gate stands -----------------------------------------------------------
  const leadIns = features
    .filter((f) => f.properties.aeroway === 'parking_position' && f.geometry.type === 'LineString')
    .map((f) => ({ ref: f.properties.ref ?? null, points: f.geometry.coordinates.map(frame.toLocal), used: false }));
  const terminals = features
    .filter((f) => f.properties.aeroway === 'terminal' && f.geometry.type === 'Polygon')
    .map((f) => f.geometry.coordinates[0].map(frame.toLocal));

  const nearestTerminalPoint = (p) => {
    let best = null;
    for (const ring of terminals) {
      for (let i = 1; i < ring.length; i += 1) {
        const hit = projectOnSegment(p, ring[i - 1], ring[i]);
        if (!best || hit.distance < best.distance) best = hit;
      }
    }
    return best;
  };

  const stands = new Map();
  for (const gate of gates.features) {
    const { code, concourse } = gate.properties;
    const surveyed = frame.toLocal(gate.geometry.coordinates);

    // Match to the nearest unused OSM lead-in line whose terminal end sits on the stop mark.
    let match = null;
    for (const line of leadIns) {
      if (line.used) continue;
      for (let i = 1; i < line.points.length; i += 1) {
        const hit = projectOnSegment(surveyed, line.points[i - 1], line.points[i]);
        if (hit.distance < LEAD_IN_MATCH && (!match || hit.distance < match.hit.distance)) match = { line, hit };
      }
    }

    let leadIn;
    if (match) {
      match.line.used = true;
      const pts = match.line.points;
      const ordered = dist2(pts[0], surveyed) < dist2(pts.at(-1), surveyed) ? [...pts].reverse() : [...pts];
      // Lead-in runs from the taxilane end to the stop mark (snapped onto the line).
      ordered[ordered.length - 1] = match.hit.point;
      leadIn = ordered;
    } else {
      // No mapped lead-in: point the nose at the closest terminal wall.
      const wall = nearestTerminalPoint(surveyed);
      const nose = wall && wall.distance > 1 ? norm2(sub(wall.point, surveyed)) : [0, 1];
      leadIn = [[surveyed[0] - nose[0] * 45, surveyed[1] - nose[1] * 45], surveyed];
    }
    const stop = leadIn.at(-1);
    const nose = norm2(sub(stop, leadIn.at(-2)));
    const leadStart = leadIn[0];

    stands.set(code, {
      code,
      concourse,
      surveyed,
      stop,
      nose,
      heading: vectorHeading(nose),
      leadIn,
      leadStart,
      fromOsm: Boolean(match),
      joinNodeId: null,
    });
  }

  // Join every stand to the taxiway network at the closest point to its lead-in start,
  // skipping runway centreline nodes and the stubs that lead onto them.
  const runwayNodeIds = new Set(runwayPairs.flatMap((r) => r.access.map((a) => a.nodeId)));
  for (const stand of stands.values()) {
    const hit = nearestEdge(stand.leadStart, 400, (a, b) => !runwayNodeIds.has(a.id) && !runwayNodeIds.has(b.id));
    if (hit) stand.joinNodeId = splitEdge(hit.a, hit.b, hit.point);
  }

  // --- 4. Shortest-path trees from every stand -----------------------------------
  const trees = new Map();
  const treeFrom = (sourceId) => {
    if (trees.has(sourceId)) return trees.get(sourceId);
    const distance = new Map([[sourceId, 0]]);
    const previous = new Map();
    const heap = new MinHeap();
    heap.push(0, sourceId);
    while (heap.size) {
      const [d, id] = heap.pop();
      if (d > distance.get(id)) continue;
      for (const [next, w] of nodes.get(id).edges) {
        const nd = d + w;
        if (nd < (distance.get(next) ?? Infinity)) {
          distance.set(next, nd);
          previous.set(next, id);
          heap.push(nd, next);
        }
      }
    }
    const tree = { distance, previous };
    trees.set(sourceId, tree);
    return tree;
  };

  /** Node ids from the stand's join node to `targetId` (inclusive), or null. */
  const routeFromStand = (code, targetId) => {
    const stand = stands.get(code);
    if (!stand?.joinNodeId) return null;
    const tree = treeFrom(stand.joinNodeId);
    if (!tree.distance.has(targetId)) return null;
    const ids = [targetId];
    while (ids.at(-1) !== stand.joinNodeId) ids.push(tree.previous.get(ids.at(-1)));
    return ids.reverse();
  };

  const taxiDistance = (code, targetId) => {
    const stand = stands.get(code);
    if (!stand?.joinNodeId) return Infinity;
    return treeFrom(stand.joinNodeId).distance.get(targetId) ?? Infinity;
  };

  return {
    frame,
    nodes,
    stands,
    runwayPairs,
    runwayEnds: runwayEndsById,
    routeFromStand,
    taxiDistance,
    pointOf: (id) => nodes.get(id).p,
    taxiways: taxiways.map((f) => f.geometry.coordinates.map(frame.toLocal)),
    aprons: features
      .filter((f) => f.properties.aeroway === 'apron' && f.geometry.type === 'Polygon')
      .map((f) => f.geometry.coordinates[0].map(frame.toLocal)),
    terminals,
  };
}
