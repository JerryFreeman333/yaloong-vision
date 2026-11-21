import assert from 'node:assert/strict';
import {applyAction, createAttempt, oppositeHole, previewAction, restoreAttempt, scoreAttempt} from '../src/knee-rules.js';

const act = (a, type, properties) => applyAction(a, {type, ...properties});
function succeeds(a, type, properties) {
  const result = act(a, type, properties);
  assert.equal(result.ok, true, result.message);
}
const allHoles = [1,2,3,4,5,6];
const kit = side => ({side,motor:'KNEE',spec:'M3×8',count:6});
const seat = {face:'arrow',slot:'lower'};

function prepare(a) {
  succeeds(a, 'kit', kit(a.leg === 'RF' ? 'R' : 'L'));
  succeeds(a, 'seat', seat);
}
function assemble(a, order = [6,3,2,5,4,1]) {
  prepare(a);
  for (const hole of allHoles) succeeds(a, 'preload', {hole, tool:'hex'});
  succeeds(a, 'align');
  for (const hole of order) succeeds(a, 'tighten', {hole});
  assert.equal(a.stage,'inspect');
}
function inspect(a) {
  const {hole,defect} = a.inspection;
  if (defect === 'normal') {
    for (const hole of allHoles) succeeds(a, 'check', {hole});
    succeeds(a, 'judge', {decision:'pass'});
  } else {
    succeeds(a, 'check', {hole});
    succeeds(a, 'judge', {decision:'repair',hole,reason:defect});
    succeeds(a, 'repair', {hole});
    if (defect === 'missing') {
      assert.equal(a.inspection.holes[hole - 1], 'preloaded');
      assert.equal(act(a,'recheck').ok, false);
      succeeds(a, 'repair', {hole});
    }
  }
  succeeds(a, 'recheck');
  succeeds(a, 'submit');
}

for (const defect of ['loose','missing','normal']) {
  const a = createAttempt({mode:'exam',student:'T-01',defect,defectHole:5});
  assemble(a);
  assert.equal(act(a, 'hint', {level:1}).ok, false);
  assert.equal(act(a, 'judge', {decision:'pass'}).code, 'evidence');
  inspect(a);
  assert.deepEqual(scoreAttempt(a), {kit:20,seat:20,fasten:35,inspection:25,total:100,passed:true});
  const original = JSON.stringify(a);
  succeeds(a,'submit');
  assert.equal(act(a,'undo').ok,false);
  assert.equal(JSON.stringify(a), original, 'submitted attempt must be immutable and retryable');
  const restored = restoreAttempt(original);
  assert.ok(restored);
  assert.equal(JSON.stringify(restored), original);
}

const sample = createAttempt({mode:'exam',defect:'loose',defectHole:3});
assert.equal(act(sample,'kit', {...kit('R'), spec:'M6×16'}).ok,false);
assert.equal(act(sample,'kit', {...kit('R'), spec:'M6×16'}).ok,false);
assert.equal(sample.events.length,1,'a double click is logged once');
prepare(sample);
const clean = JSON.stringify(sample);
assert.equal(previewAction(sample,{type:'preload',hole:1,tool:'hex'}).ok,true);
assert.equal(clean,JSON.stringify(sample),'dry run changed progress');
assert.equal(act(sample,'preload',{hole:1,tool:'cross'}).ok,false);
assert.equal(act(sample,'preload',{hole:1,tool:'hex',blocked:true}).ok,false);
assert.equal(act(sample,'preload',{hole:1,tool:'hex',lateralMm:.4,tiltDeg:0}).code,'blocked');
assert.equal(sample.events.at(-1).action.lateralMm,.4);
assert.equal(act(sample,'preload',{hole:1,tool:'hex',lateralMm:0,tiltDeg:4}).code,'blocked');
assert.equal(sample.events.at(-1).action.tiltDeg,4);
assert.equal(act(sample,'preload',{hole:1,tool:'hex',lateralMm:'0.4'}).code,'invalid');
assert.equal(sample.holes[0],'empty');
for (const hole of [3,2,5,1,6]) succeeds(sample,'preload',{hole,tool:'hex'});
assert.equal(act(sample,'tighten',{hole:3}).ok,false);
assert.equal(act(sample,'align').ok,false);
assert.equal(act(sample,'preload',{hole:1,tool:'hex'}).ok,false);
succeeds(sample,'preload',{hole:4,tool:'hex'});
succeeds(sample,'align');
for (const hole of [2,5,4,1,6,3]) succeeds(sample,'tighten',{hole});
inspect(sample);
assert.deepEqual(scoreAttempt(sample), {kit:15,seat:20,fasten:27,inspection:25,total:87,passed:true});
assert.equal(scoreAttempt(restoreAttempt(sample)).total,87);

const undone = createAttempt();
assert.equal(act(undone,'kit',kit('R')).ok,false);
prepare(undone);
succeeds(undone,'preload',{hole:5,tool:'hex'});
const copied = restoreAttempt(JSON.stringify(undone));
succeeds(copied,'undo');
assert.equal(copied.holes[4],'empty');
succeeds(copied,'undo');
assert.equal(copied.stage,'seat');
assert.equal(scoreAttempt(copied).kit,15,'undo should retain first-attempt evidence');
assert.equal(JSON.stringify(restoreAttempt(copied)),JSON.stringify(copied));
assert.equal(scoreAttempt(restoreAttempt({...sample,stage:'kit',score:0,submittedAt:null})).total,87);
assert.equal(restoreAttempt({...sample,version:'future'}),null);
assert.equal(restoreAttempt({...sample,events:[{...sample.events[0],ok:true}]}),null);
assert.equal(restoreAttempt({...sample,events:[{...sample.events[0],at:'2000-01-01T00:00:00.000Z'}]}),null);
assert.equal(restoreAttempt('invalid'),null);

const diagonal = createAttempt();
prepare(diagonal);
for (const hole of allHoles) succeeds(diagonal,'preload',{hole,tool:'hex'});
succeeds(diagonal,'align');
assert.equal(act(diagonal,'tighten',{hole:3,tool:'phillips'}).code,'tool');
assert.equal(diagonal.holes[2],'preloaded');
succeeds(diagonal,'tighten',{hole:3});
assert.equal(act(diagonal,'tighten',{hole:4}).code,'order');
assert.equal(diagonal.pendingOpposite,6);
for (const hole of [6,4,1,2,5]) succeeds(diagonal,'tighten',{hole});
assert.equal(scoreAttempt(diagonal).fasten,30,'wrong second hole affects exactly one pair');
for (const hole of allHoles) assert.equal(oppositeHole(oppositeHole(hole)),hole);

console.log('PASS · 左前/右前工单、正常/缺钉/预装件、六孔对角、87 分复算、撤销重放、重复提交及损坏记录');
