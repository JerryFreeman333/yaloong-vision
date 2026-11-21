// Procedure targets are installation occurrences. A reused motor definition can belong
// to four different installation sites, so resolve its ID through the leg's ancestry.
export function createProcedures(assembly, manual) {
  const nodes = assembly.nodes;
  const byId = new Map(nodes.map(node => [node.id, node]));
  const children = new Map();
  for (const node of nodes) {
    if (!children.has(node.parent)) children.set(node.parent, []);
    children.get(node.parent).push(node.id);
  }

  function lineage(id) {
    const path = [];
    for (let node = byId.get(id); node; node = byId.get(node.parent)) path.push(node.id);
    return path;
  }
  const ancestorIds = new Map(nodes.map(node => [node.id, lineage(node.id)]));
  const leafCache = new Map();
  function leaves(id) {
    if (leafCache.has(id)) return leafCache.get(id);
    const childIds = children.get(id);
    const node = byId.get(id);
    const ownMesh = node && (node.geometry === true || (!childIds && node.geometry !== false));
    const leafIds = ownMesh ? [id] : [];
    if (childIds) leafIds.push(...childIds.flatMap(leaves));
    leafCache.set(id, leafIds);
    return leafIds;
  }
  function below(id, root) { return ancestorIds.get(id)?.includes(root) ?? false; }
  function outermost(ids) {
    const candidates = new Set(ids);
    return ids.filter(id => !ancestorIds.get(id).slice(1).some(parent => candidates.has(parent)));
  }
  const fasteners = nodes.filter(node => node.fastener && node.supplemental);
  const screwsByHost = new Map();
  for (const screw of fasteners) {
    const host = screw.hostId ?? screw.parent;
    if (!screwsByHost.has(host)) screwsByHost.set(host, []);
    screwsByHost.get(host).push(screw.id);
  }
  const roles = Object.fromEntries(Object.entries(manual.selectors).map(([key, fragment]) => [
    key, outermost(nodes.filter(node => node.name.includes(fragment)).map(node => node.id)),
  ]));
  const legRoots = new Map();
  for (const leg of manual.legs) {
    const id = nodes.find(node => node.name.includes(leg.label + '腿组件'))?.id;
    if (id != null) legRoots.set(leg.id, id);
  }
  const rails = [...roles.longBeam].sort((a,b) => byId.get(a).center[1] - byId.get(b).center[1]);
  roles.bottomRail = rails.slice(0, 2);
  roles.topRail = rails.slice(2);

  // Each body clamp lives in the frame branch. Match it to the closest side-swing
  // motor using measured centers, independently of STEP sibling ordering.
  const clampByLeg = new Map();
  for (const [tag, legRoot] of legRoots) {
    const motorId = roles.rollMotor.find(id => below(id, legRoot));
    if (motorId == null || !roles.bodyClamp.length) continue;
    const motorCenter = byId.get(motorId).center;
    const distance = id => byId.get(id).center.reduce((sum, x, axis) => sum + (x - motorCenter[axis]) ** 2, 0);
    clampByLeg.set(tag, [...roles.bodyClamp].sort((a,b) => distance(a) - distance(b))[0]);
  }
  function rootsFor(role, tag) {
    if (!role) return [];
    if (role === 'leg') return legRoots.has(tag) ? [legRoots.get(tag)] : [];
    if (role === 'bodyClamp' && tag) return clampByLeg.has(tag) ? [clampByLeg.get(tag)] : [];
    const matches = roles[role] || [];
    return tag ? matches.filter(id => below(id, legRoots.get(tag))) : matches;
  }
  function prepareStep(step) {
    const targets = rootsFor(step.role, step.leg);
    const base = {...step, roots:targets};
    const rule = step.fastening || step.afterFastening;
    if (!rule) return [base];
    const targetsForLeg = (screw, leg) => {
      if (!leg) return true;
      if (screw.leg) return screw.leg === leg;
      const host = screw.hostId ?? screw.parent;
      return below(host,legRoots.get(leg)) || host === clampByLeg.get(leg);
    };
    function fastenerStep(binding) {
      const matched = fasteners.filter(screw => binding.roles.includes(screw.role) && targetsForLeg(screw,step.leg));
      if (!matched.length) return null;
      return {...base,id:step.id + '-' + binding.roles[0],kind:'part',role:'screw',roots:matched.map(screw => screw.id),
        stage:true,uiLabel:'拧紧所选螺丝',title:binding.title || step.title,
        detail:matched.length === 1 ? '选取线扣上的 ' + matched[0].spec + ' 螺丝并紧固。' :
          '依次选择 ' + matched.length + ' 颗 ' + matched[0].spec + ' 螺丝并紧固。多颗螺丝先对齐孔位，再按对角顺序拧紧。'};
    }
    const fastening = fastenerStep(rule);
    if (!fastening) return [base];
    if (step.afterFastening) return [base,fastening];
    const wire = step.wireFastening && fastenerStep(step.wireFastening);
    if (wire) return [fastening,{...base,title:step.title.split(' · ')[0] + ' · 接入线束',detail:rule.remaining.split('。')[0] + '。'},wire];
    if (rule.remaining || rule.count !== fastening.roots.length)
      return [fastening,{...base,detail:rule.remaining || '核对本步骤剩余紧固件的规格和数量，并确认完成。'}];
    return [fastening];
  }
  const chapters = manual.chapters.map(chapter => ({ ...chapter, steps:chapter.steps.flatMap(prepareStep) }));

  // STEP places the harnesses and motor adapters beside the motors in the
  // assembly tree. In the kit these accessories arrive with the motor they
  // serve; include them when staging that motor, before connecting its cable.
  const stagedAccessories = new Map();
  for(const [tag,root] of legRoots){
    const items=nodes.filter(n=>n.parent===root);
    for(const [role,pattern] of [
      ['hipMotor',/髋膝连接件|髋膝连接线|转子线扣/],
      ['rollMotor',/侧摆到髋连接件|侧摆到髋连接线/]
    ]) {
      const motor=rootsFor(role,tag)[0];
      if(motor)stagedAccessories.set(motor,items.filter(n=>pattern.test(n.name)).map(n=>n.id));
    }
  }

  let chapter = chapters[0];
  let index = 0;
  let accepted = new Set();
  const history = [];

  function visualState() {
    const visual = {pose:'stand', handleOpen:false, batteryOut:chapter.id === 'battery', stagedIds:[], stagedRootIds:[]};
    for (const step of chapter.steps.slice(0, index)) Object.assign(visual, step.effect);
    const stage = new Set();
    for (let i = index; i < chapter.steps.length; i++) {
      const step = chapter.steps[i];
      if (!step.stage) continue;
      for (const id of step.roots) if (i !== index || !accepted.has(id)) { stage.add(id);for(const extra of stagedAccessories.get(id)||[])stage.add(extra); }
    }
    visual.stagedRootIds = outermost([...stage]);
    visual.stagedIds = visual.stagedRootIds.flatMap(leaves);
    return visual;
  }
  function snapshot() {
    const step = chapter.steps[index] || null;
    const targetRootIds = step?.roots.filter(id => !accepted.has(id)) || [];
    return {
      chapter, index, count:chapter.steps.length, complete:step === null, step,
      targetRootIds, targetIds:targetRootIds.flatMap(leaves),
      uiLabel:step?.uiLabel || '安装所选零件',
      acceptedCount:accepted.size, requiredCount:step?.roots.length || 0,
      visual:visualState(),
    };
  }
  function start(chapterId = chapters[0].id) {
    const chosen = chapters.find(item => item.id === chapterId);
    if (!chosen) throw new Error('未知装配章节 ' + chapterId);
    chapter = chosen;
    index = 0;
    accepted = new Set();
    history.length = 0;
    return snapshot();
  }
  function advance({selectedId, confirmed=false} = {}, includeSnapshot=true) {
    const step = chapter.steps[index];
    const result = (ok,message) => ({ok,message,state:includeSnapshot?snapshot():null});
    if (!step) return result(false,'本章已完成。');
    let selectedRoot;
    if (step.kind === 'part') {
      const selectedScrew = byId.get(selectedId)?.fastener;
      selectedRoot = step.roots.find(root => below(selectedId,root) && (!selectedScrew || root === selectedId));
      if (selectedRoot == null) return result(false,'请先选择本步骤指定的零件及安装位置。');
      if (accepted.has(selectedRoot)) return result(false,'此安装位已经完成，请选择下一件。');
    } else if (!confirmed) {
      return result(false,'请执行并确认当前操作。');
    }
    history.push({index,accepted:new Set(accepted),target:selectedRoot ?? null});
    if (selectedRoot != null) accepted.add(selectedRoot);
    if (step.kind !== 'part' || accepted.size === step.roots.length) {
      index++;
      accepted = new Set();
    }
    return result(true, index === chapter.steps.length ? '本章装配完成。' : '操作已完成。');
  }
  // Read the next state without committing the operation. The caller commits only
  // after the tool, contact sweep and joint drive reach the requested end pose.
  function preview(direction, input) {
    const savedIndex=index, savedAccepted=new Set(accepted), savedHistory=history.slice();
    try {
      if (direction==='prev') return {ok:history.length>0,state:previous()};
      return advance(input);
    } finally {
      index=savedIndex; accepted=savedAccepted;
      history.splice(0,history.length,...savedHistory);
    }
  }
  function previous() {
    const prior = history.pop();
    if (prior) { index = prior.index; accepted = prior.accepted; }
    return snapshot();
  }

  // Restore the exact accepted occurrences, including a partially completed
  // multi-fastener step. Validation must leave the prior live workpiece intact.
  function restoreGuide(chapterId, selections) {
    const nextChapter = chapters.find(item => item.id === chapterId);
    if (!nextChapter || !Array.isArray(selections)) return false;
    const limit = nextChapter.steps.reduce((sum, s) => sum + (s.kind === 'part' ? s.roots.length : 1), 0);
    if (selections.length > limit) return false;
    const saved = {chapter,index,accepted,history:history.slice()};
    start(chapterId);
    for (const id of selections) {
      const step = chapter.steps[index];
      const valid = step && (step.kind === 'part' ? typeof id === 'string' && step.roots.includes(id) : id === null);
      if (valid && advance({selectedId:id,confirmed:true},false).ok) continue;
      chapter = saved.chapter;
      index = saved.index;
      accepted = saved.accepted;
      history.splice(0,history.length,...saved.history);
      return false;
    }
    return true;
  }

  function wireTargets(chapterId,step) {
    if(step.kind!=='confirm'||!step.leg)return null;
    const sourceRole=chapterId==='mount'?'controlBody':step.wireFastening?'rollCable':'hipCable';
    const targetRole=chapterId==='mount'?'rollMotor':step.wireFastening?'hipMotor':'kneeMotor';
    const sourceIds=sourceRole==='controlBody'?roles.controlBody:rootsFor(sourceRole,step.leg);
    const targetIds=rootsFor(targetRole,step.leg);
    if(!sourceIds.length||!targetIds.length)return null;
    const dedupe=ids=>[...new Set(ids)];
    const inLeg=role=>rootsFor(role,step.leg);
    // Harness IDs refer to complete original CAD occurrences. The trunk-side
    // cable has no separate mesh, so identify the control-box source housing.
    return {
      sourceId:sourceIds[0],targetId:targetIds[0],
      sourceIds:dedupe([...inLeg('hipCable'),...roles.controlBody,...inLeg('rollCable')]),
      targetIds:dedupe([...inLeg('hipMotor'),...inLeg('rollMotor'),...inLeg('kneeMotor')])
    };
  }

  // Dependencies describe removable assemblies exposed in the instruction manual.
  // Internal components that the manual does not service remain inspectable in
  // isolation; they do not acquire guessed maintenance instructions.
  const dependencies = new Map();
  const serviceNotes = new Map();
  function requireParts(id, blockers, note) {
    if (id == null) return;
    const prerequisiteIds = [...new Set(blockers.filter(item => item !== id))];
    dependencies.set(id, prerequisiteIds);
    if (note) serviceNotes.set(id, note);
  }
  for (const [tag, root] of legRoots) {
    const scoped = key => rootsFor(key,tag);
    const retainers=nodes.filter(n=>n.parent===root && /C2-2-0-09[23] /.test(n.name));
    for(const id of scoped('foot'))requireParts(id,retainers.map(r=>r.id),'两侧固定件已经退出，维修架承重后沿足垫槽口移出。');
    const siteScrews = role => fasteners.filter(screw => screw.role === role && screw.leg === tag).map(screw => screw.id);
    requireParts(root, [...scoped('bodyClamp'),...siteScrews('bodyWire')], '确认侧摆电机与电控盒线束已解除固定并断开。');
    for (const id of scoped('rollCable')) requireParts(id,siteScrews('hipWire'),'确认两端接口均已拔出。');
    for (const id of scoped('kneeMotor')) requireParts(id,
      [...scoped('thighClamp'),...scoped('motorClamp'),...scoped('hipCable'),...siteScrews('kneeMotor')],
      '确认膝电机的安装螺丝已松开。');
    for (const id of scoped('hipMotor')) requireParts(id,
      [...scoped('motorClamp'),...scoped('hipCable'),...scoped('rollCable'),...siteScrews('hipRoll')],
      '确认与侧摆电机相连的 2 颗 M6×16 已解除。');
    for (const id of scoped('rollMotor')) requireParts(id,
      [...scoped('bodyClamp'),...scoped('rollCable'),...siteScrews('hipRoll')],
      '确认固定螺丝及电控盒线束均已解除。');
  }
  for (const id of roles.motorClamp) serviceNotes.set(id,'确认该抱箍上的 M3×8 紧固件已松开。');
  for (const id of roles.bodyClamp) serviceNotes.set(id,'确认该躯干抱箍的 2 颗 M6×16 已松开。');
  for (const id of roles.handle) serviceNotes.set(id,'确认把手的 M6×16 紧固件已松开。');
  for (const id of roles.cushion) serviceNotes.set(id,'确认底部缓冲垫的 M6×16 已松开。');
  for (const id of roles.rollCable) serviceNotes.set(id,'确认线扣螺丝已解除，线束两端插头均已拔出。');
  for (const id of roles.hipCable) serviceNotes.set(id,'确认髋膝接口已拔出。');
  for (const id of roles.battery) serviceNotes.set(id,'确认已趴下、抬起右前腿并翻起电池把手。');

  const detached = new Set();
  function ownerOf(id) { return ancestorIds.get(id)?.find(parent => detached.has(parent)); }
  function free(id) {
    if (ownerOf(id) != null) return true;
    const partLeaves = leaves(id);
    return partLeaves.length > 0 && partLeaves.every(leaf => ownerOf(leaf) != null);
  }
  function directDependencies(id) {
    // Selecting a housing on the canvas must respect its motor assembly's
    // clamps. A complete leg's mount applies only when removing that whole leg.
    if (byId.get(id)?.fastener) return [];
    const scope = ancestorIds.get(id) || [];
    const enclosing = scope.find(parent => dependencies.has(parent) &&
      (parent === id || ![...legRoots.values()].includes(parent)));
    return [...new Set([...(enclosing ? dependencies.get(enclosing) : []), ...(screwsByHost.get(id) || [])])];
  }
  function removalInfo(id) {
    const node = byId.get(id);
    const removedBy = ownerOf(id);
    const removed = removedBy != null;
    const enclosingRemoval = removed ? ancestorIds.get(id).slice(1).find(parent => detached.has(parent)) : undefined;
    const leafIds = leaves(id);
    const blockedBy = directDependencies(id).filter(other => !free(other));
    let canRemove = false, canRestore = false, message = '';
    if (!node || node.parent == null || !leafIds.length) message = '请选择一个可拆零件。';
    else if (removed && (removedBy !== id || enclosingRemoval != null)) message = '请先装回所属的已拆组件。';
    else if (removed) {
      const dependents = [...detached].filter(other => other !== id &&
        (below(id,other) || directDependencies(other).some(prerequisite => below(id,prerequisite))));
      canRestore = dependents.length === 0;
      message = canRestore ? '可装回原安装位。' : '先装回 ' + byId.get(dependents[0]).name + '。';
    } else if (leafIds.some(leaf => !byId.get(leaf)?.fastener && ownerOf(leaf) != null)) {
      message = '请先复位此组件中已拆出的零件。';
    } else if (blockedBy.length) {
      const counts = new Map();
      for (const other of blockedBy) {
        const label = byId.get(other).name.replace(/^C[12]-[\d-]+\s*/, '');
        counts.set(label, (counts.get(label) || 0) + 1);
      }
      message = '先拆下 ' + [...counts].map(([label,n]) => n === 1 ? label : label + ' × ' + n).join('、') + '。';
    } else {
      canRemove = true;
      message = serviceNotes.get(id) || '可独立移出此零件。';
    }
    return {id,removed,removedBy,canRemove,canRestore,message,blockerIds:blockedBy,leafIds,
      needsConfirmation:canRemove && serviceNotes.has(id),confirmation:serviceNotes.get(id) || ''};
  }
  function detach(id,{confirmed=false} = {}) {
    const info = removalInfo(id);
    const ok = info.canRemove && (!info.needsConfirmation || confirmed);
    if (ok) detached.add(id);
    return {ok,message:ok ? '已拆下所选零件。' : info.message, state:removalInfo(id)};
  }
  function restore(id) {
    const info = removalInfo(id);
    if (info.canRestore) detached.delete(id);
    return {ok:info.canRestore,message:info.canRestore ? '已回到原安装位。' : info.message,state:removalInfo(id)};
  }
  function batteryMotion(id) {
    return {...manual.batteryMotion, pack:roles.battery.some(root => below(id,root)),
      handle:roles.batteryHandle.some(root => below(id,root))};
  }
  return {
    wireTargets,restoreGuide, get guideHistory() { return history.map(action => action.target); },
    chapters,stageLeaves:id=>[id,...(stagedAccessories.get(id)||[])].flatMap(leaves),start,snapshot,advance,previous,preview,removalInfo,detach,restore,batteryMotion,leaves,
    get detachedIds() { return [...detached]; },
    get detachedLeafIds() { return [...new Set([...detached].flatMap(leaves))]; },
    reset() { return start(chapter.id); },
    restoreAll() { detached.clear(); },
  };
}
