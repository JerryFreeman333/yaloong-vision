// Stock photographs/illustrations are cropped from the BPX parts sheets (pp. 6, 9, 15, 22).
// A label can describe a location or a record rather than an identifiable stocked component.
const illustrated=[
  [/膝关节电机|KNEE/,'knee'],[/HIPY/,'hip'],[/HIPX/,'roll'],
  [/长梁/,'tray/long-rail'],[/短梁/,'tray/cross-rail'],[/缓冲垫/,'tray/cushion'],
  [/躯干固定件/,'tray/frame-support'],[/电控盒组件/,'tray/control-box'],[/躯干抱箍/,'tray/body-clamp'],
  [/躯干.*提手|件提手/,'tray/carry-handle'],[/左前腿|LF 腿/,'tray/lf-leg'],[/左后腿|LR 腿/,'tray/lr-leg'],
  [/右前腿|RF 腿/,'tray/rf-leg'],[/右后腿|RR 腿/,'tray/rr-leg']
];
export function materialImage(label){
  if(/线束|接线|固定螺钉|M[36]×/.test(label))return null;
  const row=illustrated.find(([pattern])=>pattern.test(label));
  return row?'./training/'+row[1]+'.webp':null;
}
