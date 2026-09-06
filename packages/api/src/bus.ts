import { EventEmitter } from 'node:events';

/** In-process event bus: alerts fan out to the caregiver SSE stream. */
export const bus = new EventEmitter();
bus.setMaxListeners(100);

export interface AlertEvent {
  id: string;
  patientId: string;
  severity: 'red' | 'amber';
  ruleId: string;
  reasonEn: string;
  reasonUr: string;
  at: string;
}
