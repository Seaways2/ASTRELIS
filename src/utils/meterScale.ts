export const METER_MIN_DB = -60;
export const METER_DB_TICKS = [0, -10, -20, -30, -40, -50, -60] as const;
export const METER_MINOR_DB_TICKS = [-5, -15, -25, -35, -45, -55] as const;

export const dbToMeterPosition = (db: number) => {
  const bounded = Math.max(METER_MIN_DB, Math.min(0, db));
  return ((bounded - METER_MIN_DB) / -METER_MIN_DB) * 100;
};

export const amplitudeToMeterPosition = (amplitude: number) => {
  if (amplitude <= .001) return 0;
  return dbToMeterPosition(20 * Math.log10(amplitude));
};

export const formatMeterTick = (db: number) => db < 0 ? `−${Math.abs(db)}` : `${db}`;
export const formatFaderScaleTick = (db: number) => `${Math.abs(db)}`;
