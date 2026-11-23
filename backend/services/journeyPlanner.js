// Journey planner: time-dependent Dijkstra over the bus-stop network.
//
// States:   'O' origin, 'D' destination,
//           'S:<stop>'            standing at a stop (on foot),
//           'R:<route>:<i>'       aboard route at its i-th stop.
//           Every route is in the graph twice: outbound and its return trip (key `<route>~r`).
// Edges:    O -> S (walk, stops within 1 km)      S -> D (walk, stops within 1 km of destination)
//           S -> S (walk transfer, stops within 400 m)
//           S -> R (board: wait for next bus + 1 min penalty)   R:i -> R:i+1 (ride)   R -> S (alight)
// Cost = minutes from now. The wait for a bus depends on when you reach the stop (live ETA,
// then timetable, then a default), which keeps Dijkstra correct because waiting never lets you
// arrive earlier by leaving later (FIFO).
import Route from '../models/Route.js';
import { haversine, walkMinutes } from '../../shared/geo.js';
import { compileRoute, reverseRoute, nextLiveArrival } from './liveTracker.js';
import { nextScheduledArrival } from './schedule.js';

export const PLANNER = {
  accessMeters: 1000, // max walk to the first stop / from the last stop
  transferMeters: 400,
  boardPenaltyMinutes: 1,
  defaultWaitMinutes: 10, // unknown frequency
  defaultSpeed: 5, // m/s, when a route has no timetable offsets
  directWalkMeters: 2000,
  maxOptions: 3
};

// ---------- Binary min-heap ----------
class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost <= a[i].cost) break;
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
        if (l < a.length && a[l].cost < a[m].cost) m = l;
        if (r < a.length && a[r].cost < a[m].cost) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// ---------- Graph ----------

/** Build the planner graph from compiled routes (see liveTracker.compileRoute). Pure; used by tests. */
export function buildGraph(compiledRoutes) {
  const stops = new Map(); // stopId -> { id, name, lat, lng }
  const stopRoutes = new Map(); // stopId -> [{ routeId, index }]
  const routes = new Map(); // route key -> { id, direction, ..., stops, rideMinutes[] }

  for (const r of compiledRoutes) {
    if (r.stops.length < 2) continue;
    const key = r.direction === 'return' ? `${r.id}~r` : r.id;
    const rideMinutes = [];
    for (let i = 0; i < r.stops.length - 1; i++) {
      const a = r.stops[i];
      const b = r.stops[i + 1];
      const scheduled = b.offsetMinutes - a.offsetMinutes;
      const byDistance = Math.max(b.along - a.along, haversine(a, b)) / PLANNER.defaultSpeed / 60;
      rideMinutes.push(Math.max(0.5, scheduled > 0 ? scheduled : byDistance));
    }
    routes.set(key, { id: r.id, direction: r.direction || 'outbound', number: r.number, name: r.name, color: r.color,
      departures: r.departures, stops: r.stops, rideMinutes });
    r.stops.forEach((s, index) => {
      stops.set(s.id, { id: s.id, name: s.name, lat: s.lat, lng: s.lng });
      if (!stopRoutes.has(s.id)) stopRoutes.set(s.id, []);
      stopRoutes.get(s.id).push({ routeId: key, index });
    });
  }

  // Walking transfers between nearby stops.
  // ponytail: O(n²) over stops; fine for a few thousand stops, use a spatial grid beyond that.
  const transfers = new Map();
  const list = [...stops.values()];
  for (const s of list) transfers.set(s.id, []);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const meters = haversine(list[i], list[j]);
      if (meters <= PLANNER.transferMeters) {
        transfers.get(list[i].id).push({ to: list[j].id, meters });
        transfers.get(list[j].id).push({ to: list[i].id, meters });
      }
    }
  }
  return { stops, stopRoutes, routes, transfers };
}

let graphPromise = null;

export function invalidateGraph() {
  graphPromise = null;
}

export function getGraph() {
  graphPromise ||= Route.find().populate('stops.stop')
    .then((docs) => buildGraph(docs.map(compileRoute).flatMap((r) => [r, reverseRoute(r)])))
    .catch((error) => { graphPromise = null; throw error; });
  return graphPromise;
}

// ---------- Search ----------

/**
 * waitFor(route, stopIndex, arriveMinutes) -> { minutes, source, bus? }
 * minutes = time spent waiting at the stop after arriving at `arriveMinutes` from now.
 */
export function makeWaitFor(now = new Date()) {
  return (route, index, arrive) => {
    const stop = route.stops[index];
    const live = nextLiveArrival(route.id, stop.id, arrive, route.direction);
    if (live) return { minutes: Math.max(0, live.minutes - arrive), source: 'live', bus: live };
    const scheduled = nextScheduledArrival(route.departures, stop.offsetMinutes,
      new Date(now.getTime() + arrive * 60000));
    if (scheduled) {
      return { minutes: (scheduled - now) / 60000 - arrive, source: 'schedule' };
    }
    return { minutes: PLANNER.defaultWaitMinutes, source: 'estimate' };
  };
}

function dijkstra(graph, from, to, waitFor, bannedRoutes) {
  const best = new Map([['O', 0]]);
  const prev = new Map();
  const heap = new MinHeap();
  heap.push({ node: 'O', cost: 0 });

  const relax = (node, cost, from_, edge) => {
    if (cost < (best.get(node) ?? Infinity)) {
      best.set(node, cost);
      prev.set(node, { from: from_, edge });
      heap.push({ node, cost });
    }
  };

  while (heap.size) {
    const { node, cost } = heap.pop();
    if (cost > (best.get(node) ?? Infinity)) continue;
    if (node === 'D') break;

    if (node === 'O') {
      for (const s of graph.stops.values()) {
        const meters = haversine(from, s);
        if (meters <= PLANNER.accessMeters) relax(`S:${s.id}`, cost + walkMinutes(meters), node, { type: 'walk', meters });
      }
    } else if (node.startsWith('S:')) {
      const stopId = node.slice(2);
      const stop = graph.stops.get(stopId);
      const toDest = haversine(stop, to);
      if (toDest <= PLANNER.accessMeters) relax('D', cost + walkMinutes(toDest), node, { type: 'walk', meters: toDest });
      for (const t of graph.transfers.get(stopId) || []) {
        relax(`S:${t.to}`, cost + walkMinutes(t.meters), node, { type: 'walk', meters: t.meters });
      }
      for (const { routeId, index } of graph.stopRoutes.get(stopId) || []) {
        const route = graph.routes.get(routeId);
        if (bannedRoutes.has(route.id) || index >= route.stops.length - 1) continue;
        const wait = waitFor(route, index, cost);
        relax(`R:${routeId}:${index}`, cost + wait.minutes + PLANNER.boardPenaltyMinutes, node,
          { type: 'board', wait });
      }
    } else {
      const [, routeId, idx] = node.split(':');
      const index = Number(idx);
      const route = graph.routes.get(routeId);
      relax(`S:${route.stops[index].id}`, cost, node, { type: 'alight' });
      if (index < route.stops.length - 1) {
        relax(`R:${routeId}:${index + 1}`, cost + route.rideMinutes[index], node, { type: 'ride' });
      }
    }
  }

  if (!prev.has('D')) return null;
  const chain = [];
  for (let node = 'D'; node !== 'O'; node = prev.get(node).from) {
    chain.unshift({ node, ...prev.get(node), cost: best.get(node) });
  }
  return { chain, totalMinutes: best.get('D') };
}

/** Turn the raw Dijkstra chain into user-facing legs. */
function toLegs(graph, chain, from, to) {
  const legs = [];
  const pointOf = (node) => (node === 'O' ? from : node === 'D' ? to : graph.stops.get(node.slice(2)));
  for (let i = 0; i < chain.length; i++) {
    const step = chain[i];
    if (step.edge.type === 'walk') {
      const last = legs[legs.length - 1];
      const start = pointOf(step.from);
      const end = pointOf(step.node);
      const minutes = walkMinutes(step.edge.meters);
      if (last?.type === 'walk') {
        last.to = end; last.meters += step.edge.meters; last.minutes += minutes;
      } else {
        legs.push({ type: 'walk', from: start, to: end, meters: step.edge.meters, minutes });
      }
    } else if (step.edge.type === 'board') {
      const [, routeId, idx] = step.node.split(':');
      const route = graph.routes.get(routeId);
      const boardIndex = Number(idx);
      let j = i + 1;
      while (chain[j].edge.type === 'ride') j++;
      const alightIndex = Number(chain[j - 1].node.split(':')[2]);
      legs.push({
        type: 'ride',
        route: { id: route.id, number: route.number, name: route.name, color: route.color,
          direction: route.direction, towards: route.stops.at(-1).name },
        from: graph.stops.get(route.stops[boardIndex].id),
        to: graph.stops.get(route.stops[alightIndex].id),
        stops: alightIndex - boardIndex,
        waitMinutes: step.edge.wait.minutes,
        waitSource: step.edge.wait.source,
        bus: step.edge.wait.bus || null,
        rideMinutes: route.rideMinutes.slice(boardIndex, alightIndex).reduce((s, m) => s + m, 0)
      });
      i = j; // skip ride steps and the alight step
    }
  }
  for (const leg of legs) {
    for (const k of ['minutes', 'waitMinutes', 'rideMinutes']) if (leg[k] != null) leg[k] = Math.round(leg[k]);
    if (leg.meters != null) leg.meters = Math.round(leg.meters);
  }
  return legs.filter((l) => l.type !== 'walk' || l.meters >= 20);
}

/**
 * Plan up to 3 journeys. Alternatives are found by re-running with the previous option's
 * routes excluded, so each option uses a genuinely different bus.
 */
export function planWithGraph(graph, { from, to, waitFor }) {
  const options = [];
  const banned = new Set();
  for (let k = 0; k < PLANNER.maxOptions; k++) {
    const result = dijkstra(graph, from, to, waitFor, banned);
    if (!result) break;
    const legs = toLegs(graph, result.chain, from, to);
    const rides = legs.filter((l) => l.type === 'ride');
    if (!rides.length) break; // only walking left: handled below
    options.push({ totalMinutes: Math.round(result.totalMinutes), transfers: rides.length - 1, legs });
    rides.forEach((r) => banned.add(r.route.id));
  }

  const direct = haversine(from, to);
  if (direct <= PLANNER.directWalkMeters) {
    options.push({
      totalMinutes: Math.round(walkMinutes(direct)),
      transfers: 0,
      walkOnly: true,
      legs: [{ type: 'walk', from, to, meters: Math.round(direct), minutes: Math.round(walkMinutes(direct)) }]
    });
  }
  return options.sort((a, b) => a.totalMinutes - b.totalMinutes);
}

export async function plan({ from, to, now = new Date() }) {
  const graph = await getGraph();
  return planWithGraph(graph, { from, to, waitFor: makeWaitFor(now) });
}

/** Nearest stops (that are served by a route) to a point, from the in-memory graph. */
export async function nearestServedStops(point, limit = 3, maxMeters = 3000) {
  const graph = await getGraph();
  return [...graph.stops.values()]
    .map((s) => ({ ...s, meters: Math.round(haversine(point, s)) }))
    .filter((s) => s.meters <= maxMeters)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit)
    .map((s) => ({
      ...s,
      walkMinutes: Math.round(walkMinutes(s.meters)),
      routes: [...new Map((graph.stopRoutes.get(s.id) || []).map(({ routeId }) => {
        const r = graph.routes.get(routeId);
        return [r.id, { id: r.id, number: r.number, name: r.name, color: r.color }];
      })).values()] // each route once, though it stops here in both directions
    }));
}
