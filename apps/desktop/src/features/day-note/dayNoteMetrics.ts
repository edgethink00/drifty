/** A minute of the day (past midnight for the next morning) as HH:MM. */
export function clockLabel(minutes: number): string {
  const rounded = Math.round(minutes);
  return String(Math.floor(rounded / 60) % 24).padStart(2, "0") + ":" + String(rounded % 60).padStart(2, "0");
}
