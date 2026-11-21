// Rectangles are fractions of the original C2P20724 page (left, top, width, height).
// Each group shares the same illustration in the manual.
const figures = [
  [6, ['frame-01','frame-02','frame-03-frameBase'], [.065,.561,.447,.394]],
  [6, ['frame-04'], [.500,.561,.435,.394]],
  [7, ['frame-06-controlBox'], [.065,.045,.86,.28]],
  [7, ['frame-07','frame-08-frameBracket'], [.065,.325,.865,.322]],
  [7, ['frame-09','frame-10-buffer'], [.065,.672,.865,.285]],
  [9, ['legs-01'], [.065,.587,.845,.37]],
  [10,['legs-02-kneeMotor'], [.065,.047,.85,.289]],
  [10,['legs-03','legs-03-thighClamp'], [.065,.310,.85,.296]],
  [10,['legs-04','legs-05'], [.065,.616,.85,.340]],
  [11,['legs-06','legs-07-hipKneeClamp'], [.065,.046,.85,.298]],
  [11,['legs-08','legs-09-hipRoll'], [.065,.344,.85,.33]],
  [11,['legs-09','legs-09-hipWire'], [.065,.675,.85,.288]],
  [13,['legs-10'], [.065,.045,.85,.327]],
  [13,['legs-11-kneeMotor'], [.065,.368,.85,.282]],
  [13,['legs-12','legs-12-thighClamp'], [.065,.646,.85,.311]],
  [14,['legs-13','legs-14'], [.065,.04,.85,.325]],
  [14,['legs-15','legs-16-hipKneeClamp'], [.065,.365,.85,.291]],
  [14,['legs-17'], [.065,.659,.85,.303]],
  [16,['legs-19'], [.065,.268,.85,.34]],
  [16,['legs-20-kneeMotor'], [.065,.664,.85,.29]],
  [17,['legs-21','legs-21-thighClamp'], [.065,.024,.85,.301]],
  [17,['legs-22','legs-23'], [.065,.326,.85,.322]],
  [17,['legs-24','legs-25-hipKneeClamp'], [.065,.648,.85,.308]],
  [18,['legs-26','legs-27-hipRoll'], [.065,.028,.85,.355]],
  [18,['legs-27','legs-27-hipWire'], [.065,.384,.85,.284]],
  [19,['legs-28'], [.065,.59,.85,.366]],
  [20,['legs-29-kneeMotor'], [.065,.045,.85,.279]],
  [20,['legs-30','legs-30-thighClamp'], [.065,.324,.85,.313]],
  [20,['legs-31','legs-32'], [.065,.637,.85,.325]],
  [21,['legs-33','legs-34-hipKneeClamp'], [.065,.028,.85,.315]],
  [21,['legs-35','legs-36-hipRoll'], [.065,.343,.85,.323]],
  [21,['legs-36','legs-36-hipWire'], [.065,.668,.85,.292]],
  [23,['mount-01'], [.065,.047,.85,.33]],
  [23,['mount-02','mount-03-legClamp'], [.065,.381,.85,.27]],
  [23,['mount-03','mount-03-bodyWire'], [.065,.665,.85,.29]],
  [24,['mount-13'], [.085,.394,.83,.254]],
  [24,['mount-14'], [.065,.671,.865,.287]],
  [25,['mount-15-handle'], [.065,.066,.85,.312]],
  [26,['battery-01'], [.240,.075,.533,.282]],
  [26,['battery-02','battery-03','battery-04','battery-05'], [.062,.407,.855,.242]],
];

const byStep = new Map(figures.flatMap(([page,ids,rect])=>ids.map(id=>[id,{page,rect}])));
export function drawingRegion(step,page){
  const figure=byStep.get(step?.id);
  return figure?.page===page ? figure.rect : null;
}
