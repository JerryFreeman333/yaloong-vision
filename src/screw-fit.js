// Nominal teaching clearances, shared with the CAD service station. All lengths are mm.
export function screwAxesFit(spec, lateralMm, tiltDeg) {
  const [diameter, length] = spec.split('×');
  const clearance = diameter === 'M3' ? 0.18 : 0.24;
  const radialError = Math.abs(lateralMm) + Math.abs(Math.sin(tiltDeg * Math.PI / 180)) * Number(length);
  return radialError <= clearance;
}
