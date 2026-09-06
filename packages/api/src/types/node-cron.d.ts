declare module 'node-cron' {
  interface ScheduleOptions { timezone?: string; scheduled?: boolean }
  interface ScheduledTask { start(): void; stop(): void }
  function schedule(expr: string, fn: () => void, opts?: ScheduleOptions): ScheduledTask;
  const cron: { schedule: typeof schedule };
  export default cron;
}
