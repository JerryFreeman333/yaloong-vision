// World-space dimensions in metres. The tray and the robot's home station
// sit near the rear end; +Z is the forward walking direction.
const length = 5.4;
const minZ = -.81;

export const bench = Object.freeze({
  width: 1.9,
  length,
  thickness: .054,
  minZ,
  maxZ: minZ + length,
  centerZ: minZ + length / 2,
  brakingMargin: .13,
});

export function onBench(x, z, margin = 0) {
  return Math.abs(x) <= bench.width / 2 - margin &&
    z >= bench.minZ + margin && z <= bench.maxZ - margin;
}

export const partsTray=Object.freeze({x:-.72,z:0,width:.28,length:.68});
export function onWalkingSurface(x,z,margin=0){
  return onBench(x,z,margin) && (Math.abs(x-partsTray.x)>partsTray.width/2+margin ||
    Math.abs(z-partsTray.z)>partsTray.length/2+margin);
}
