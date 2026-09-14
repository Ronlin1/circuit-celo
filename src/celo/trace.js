import { createHash } from 'node:crypto';
import { FlightRecorder, verifyTraceChain } from 'circuit-core/src/trace/flight-recorder.js';
import { canonicalJson } from 'circuit-core/src/trace/canonical-json.js';

class MemoryTracePersistence {
  constructor() { this.rows = []; }
  insertTrace(event) { this.rows.push(structuredClone(event)); }
  lastTrace() { return this.rows.length ? structuredClone(this.rows.at(-1)) : null; }
  listTraces() { return structuredClone(this.rows); }
  getTrace(traceId) { return structuredClone(this.rows.find((entry) => entry.traceId === traceId) ?? null); }
}

function normalizePreviousHash(previousHash) {
  return previousHash || 'GENESIS';
}

export function buildTreasuryTrace(event, previousHash = null) {
  if (!event?.traceId) throw new TypeError('traceId is required');
  if (!event?.timestamp) throw new TypeError('timestamp is required');
  const previous = normalizePreviousHash(previousHash);
  const eventWithoutCurrentHash = {
    surface: 'CELO_TREASURY',
    ...structuredClone(event),
    previousHash: previous
  };
  delete eventWithoutCurrentHash.currentHash;
  const currentHash = createHash('sha256')
    .update(canonicalJson(eventWithoutCurrentHash) + previous)
    .digest('hex');
  return Object.freeze({ ...eventWithoutCurrentHash, currentHash });
}

export function verifyTreasuryTraceChain(events) {
  return verifyTraceChain(events);
}

export function createTreasuryRecorder() {
  const persistence = new MemoryTracePersistence();
  const recorder = new FlightRecorder(persistence);
  return Object.freeze({
    record: (event) => recorder.append({ surface: 'CELO_TREASURY', ...event }),
    list: () => recorder.list(),
    get: (traceId) => recorder.get(traceId),
    verify: () => verifyTraceChain(recorder.list())
  });
}
