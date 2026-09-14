import { FlightRecorder, verifyTraceChain } from 'circuit-core/src/trace/flight-recorder.js';

class MemoryTracePersistence {
  constructor() { this.rows = []; }
  insertTrace(event) { this.rows.push(structuredClone(event)); }
  lastTrace() { return this.rows.length ? structuredClone(this.rows.at(-1)) : null; }
  listTraces() { return structuredClone(this.rows); }
  getTrace(traceId) { return structuredClone(this.rows.find((entry) => entry.traceId === traceId) ?? null); }
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
