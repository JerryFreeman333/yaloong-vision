import {createProcedures} from './procedures.js';

// Each lesson names both the physical datum and the observation used for handover.
const point = (label, good, bad, repair) => ({label, good, bad, repair});
const stepPlan = (kit, method, first, second) => ({kit, method, points:[first,second]});

function partPlan(step, leg, chapter) {
  const tag = leg?.id, side = leg?.side, label = leg?.label;
  const wrongSide = side === 'L' ? 'R' : 'L';
  const end = leg?.direction;
  switch (step.role) {
    case 'bottomRail':
      return stepPlan(['2 根 320 mm 躯干长梁','2 根躯干短梁','4 件底部缓冲垫'],
        ['两根长梁平行放在底框工位','两根梁首尾串接','将两根梁交叉叠放'],
        point('长梁选料','底层两根均为长梁','混入一根横向短梁','更换为底部长梁'),
        point('底框布局','两根长梁平行、端部齐平','一根长梁纵向错位','调齐两根长梁端部'));
    case 'shortBeam':
      return stepPlan(['2 根底框短梁','2 根上部长梁','2 件躯干抱箍'],
        ['在底框两端各放一根短梁，与长梁端部对孔','将两根短梁装到同一端','用短梁沿长梁方向叠接'],
        point('横梁位置','两端各有一根短梁','两根短梁位于同端','将一根短梁移到另一端'),
        point('端部对孔','两根短梁端孔与长梁孔对齐','一端安装孔错位','重新定位短梁端孔'));
    case 'controlBody':
      return stepPlan(['电控盒组件','锂电池组件','躯干缓冲垫'],
        ['将电控盒沿底框卡槽放入，再安装上梁','先将上梁紧固封住，再横压入盒体','用螺钉将倾斜的盒体拉入卡槽'],
        point('入槽基准','盒体落入框架底部卡槽','盒体边缘搭在卡槽外','提起盒体并沿底部卡槽重新入座'),
        point('盒体姿态','盒体两侧均到位','一侧抬起，盒体倾斜','退出并调整盒体姿态'));
    case 'topRail':
      return stepPlan(['2 根上部长梁','2 根底框短梁','2 件脚垫'],
        ['在电控盒两侧放上梁，对齐梁与盒体的孔位','把上梁先放到电控盒底面','把两根上梁放在同侧'],
        point('上梁位置','盒体两侧各有一根上梁','一侧缺上梁','在缺件一侧装上长梁'),
        point('侧孔对齐','上梁和盒体固定孔同轴','上梁相对盒体孔位错开','沿梁方向调整至安装孔对齐'));
    case 'frameSupport':
      return stepPlan(['2 件躯干固定件','4 件缓冲垫','2 件提手'],
        ['将两个固定件分别贴合躯干前后端部','将两个固定件叠装在前端','先把固定件装在电池把手上'],
        point('安装端位','框架前后端各一件','框架一端缺少固定件','补装缺件一端的固定件'),
        point('支撑件贴合','安装面与框架齐平','固定件斜坐在梁端','重新摆正固定件安装面'));
    case 'cushion':
      return stepPlan(['4 件底部缓冲垫','2 件提手轴套','4 件躯干抱箍'],
        ['在框架底部四处对孔放入缓冲垫','将缓冲垫装到上梁表面','把两个缓冲垫叠装在同一位置'],
        point('四处分布','四个底部位置均有缓冲垫','一处底部安装位空缺','将缺少的缓冲垫补入底部'),
        point('缓冲垫孔位','各件固定孔与底框重合','其中一件固定孔错位','调整缓冲垫后重新对孔'));
    case 'kneeMotor':
      return stepPlan(['KNEE 通用膝电机与 '+side+' 钢印腿件','HIPY 髋电机与 '+side+' 钢印腿件','KNEE 膝电机与 '+wrongSide+' 钢印腿件'],
        ['将电机箭头标记侧对准大腿下端安装槽后入座','把电机装入大腿上端轴孔','让箭头标记面背向安装槽'],
        point('钢印与铭牌',label+'使用 '+side+' 钢印腿件和 KNEE 电机','当前腿件为 '+wrongSide+' 侧钢印','更换为 '+side+' 钢印腿件'),
        point('箭头与槽口','箭头标记侧已进入大腿下端槽','箭头标记侧朝外','退出电机、翻面并重新入槽'));
    case 'thighClamp':
      return stepPlan(['内侧钢印 '+side+' 的大腿抱箍','内侧钢印 '+wrongSide+' 的大腿抱箍','躯干抱箍'],
        ['对准大腿根部扣合抱箍，固定膝电机','将抱箍扣在侧摆输出端','将抱箍倒置压在电机线束上'],
        point('抱箍侧别','抱箍内侧钢印为 '+side,'抱箍内侧钢印为 '+wrongSide,'更换为 '+side+' 侧大腿抱箍'),
        point('抱箍落座','抱箍与大腿根部贴合','抱箍一端翘起','松开工装并重新扣合抱箍'));
    case 'hipMotor':
      return stepPlan([leg.hip,'KNEE',leg.roll],
        ['核对髋电机位置码，再与已安装的膝电机对接','将髋电机接到躯干提手','将髋电机直接装入电控盒导槽'],
        point('髋电机标签','铭牌中间编码为 '+leg.hip,'髋电机位置码与 '+tag+' 不符','更换位置码为 '+leg.hip+' 的电机'),
        point('髋膝连接面','两台电机的连接面已对接','连接面偏斜，抱箍无法就位','将髋电机重新对正膝电机'));
    case 'motorClamp':
      return stepPlan(['2 件髋膝关节抱箍','1 件大腿抱箍','2 件躯干固定件'],
        ['用两件抱箍合围髋膝连接面并对孔','将两件抱箍重叠在同一侧','将抱箍装在侧摆电机输出轴端'],
        point('抱箍件数','连接面两侧抱箍齐全','连接面缺少半件抱箍','补装对应半件髋膝抱箍'),
        point('连接面位置','两件抱箍均跨在髋膝连接面上','抱箍偏向单侧电机壳','移动抱箍至髋膝连接面'));
    case 'rollMotor':
      return stepPlan([leg.roll,leg.roll==='HIPXLFRR'?'HIPXLRRF':'HIPXLFRR',leg.hip],
        ['标签向上，输出轴朝'+end+'，与髋电机孔位对齐','标签向下，先固定再转动校正','输出轴朝'+(end==='前'?'后':'前')+'，以线长决定方向'],
        point('侧摆位置码','编码 '+leg.roll+' 适配 '+tag,'侧摆电机子分类编码与腿位不符','换用 '+leg.roll+' 侧摆电机'),
        point('输出轴朝向',label+'输出轴朝'+end+'且标签向上','输出轴与机身规定方向相反','退出侧摆电机并按机身前向校准朝向'));
    case 'leg':
      return stepPlan([label+'整腿 · '+tag,'电控盒组件','相反腿位的整腿'],
        ['按机身前后标记，将整腿装入 '+tag+' 并核对输出轴朝'+end,'先扣躯干抱箍再塞入整腿','按屏幕左右将整腿装到最近空位'],
        point('整腿安装位',label+'整腿与 '+tag+' 机位相符','整腿与机身腿位标记不一致','退出整腿并转到 '+tag+' 机位'),
        point('上机方向','侧摆输出轴朝机身'+end+'方','侧摆输出轴方向与腿位相反','核对腿位和侧摆方向后重新入位'));
    case 'bodyClamp':
      return stepPlan([tag+' 位置的躯干抱箍','髋膝关节抱箍','大腿抱箍'],
        ['在 '+tag+' 机位围住侧摆关节，将抱箍对准框架孔','把躯干抱箍扣在膝电机端盖上','靠螺钉强拉斜置抱箍到位'],
        point('抱箍安装位','抱箍扣合在 '+tag+' 侧摆关节','抱箍偏离对应腿位','将躯干抱箍移至 '+tag+' 机位'),
        point('抱箍贴合','抱箍固定孔与框架对齐','两孔错开，抱箍一端翘起','重新扣合并检查两端孔位'));
    case 'sleeve':
      return stepPlan(['4 件提手轴套','2 件提手轴套','4 件缓冲垫'],
        ['两个提手各有两个圆孔，每孔嵌入一件轴套','四件轴套叠入同一提手','先装提手螺钉再从外侧压轴套'],
        point('轴套数量','两个提手的四个圆孔都有轴套','一只圆孔中缺少轴套','补装该孔的轴套'),
        point('轴套入孔','各轴套沿圆孔同轴就位','轴套入口斜卡在孔边','取出倾斜轴套并同轴重装'));
    case 'handle':
      return stepPlan(['2 件已装入轴套的提手','2 件未装轴套的提手','2 件躯干抱箍'],
        ['将提手按图装入躯干前后安装位，并对齐端部孔位','把两个提手连在同一端','先用螺钉顶出提手轴套'],
        point('提手安装位','前后安装位各有一件提手','躯干一端缺少提手','将提手装入缺件一端的安装位'),
        point('孔位与轴套','提手定位孔对正，轴套在位','提手错位，轴套顶住框架','退出提手，校正轴套和安装孔'));
    case 'battery':
      return stepPlan(['锂电池组和电控盒导槽','前端躯干提手','髋膝关节抱箍'],
        ['让电池沿导槽平直进入电控盒并推到底','在导槽入口斜压电池侧面','在电池尚未入座时压下把手'],
        point('导入方向','电池沿电控盒导槽平直进入','电池一侧在导槽入口卡住','退回电池并调整导向后再推入'),
        point('终点位置','电池已沿导槽推到底','电池仍停在导槽中途','沿导槽将电池推至终点'));
    case 'batteryHandle': {
      const opening=step.effect.handleOpen;
      return stepPlan(['电池自身的折叠把手','躯干前端提手','躯干后端提手'],
        opening?['在右前腿让位后翻起电池把手','先扣下把手再推电池','移动机身提手带动电池把手']:['电池到底后向下扣合把手','电池未到底时强压把手','向上翻起并作为锁止状态交付'],
        point('活动把手','动作对象为电池的铰接把手','选中了机身提手','切换至电池的折叠把手'),
        opening?point('开启姿态','把手已翻起，便于导入','把手仍扣在电池端面','沿铰链翻起电池把手'):point('锁合姿态','电池把手已向下扣合','电池到底但把手仍翻起','确认电池到底后向下扣合把手'));
    }
  }
  if (step.id === 'battery-01' || step.id === 'battery-02') {
    const crouch=step.id==='battery-01';
    return stepPlan(crouch?['已装完四腿的机身','拆下腿的空框架','仅一条单腿']:['右前腿 RF','左前腿 LF','右后腿 RR'],
      crouch?['先将机身摆至趴下姿态','先把电池倒扣在工作台上','先站立并翻转电控盒']:['机身趴下后抬起右前腿，为电池入口让位','抬起右后腿并从后端推进','保持四足站姿直接推入电池'],
      crouch?point('机身姿态','机身已趴下','机身仍保持站姿','将机身调整为趴下姿态'):point('让位腿位','抬起的是 RF 右前腿','抬起了另一条腿','放回错位腿，抬起右前腿'),
      crouch?point('工序先后','电池仍在外部，等待抬起右前腿','尚未准备姿态便将电池送至入口','将电池退回待装位再准备机身'):point('电池入口','右前腿已让开电池入口','入口仍被右前腿遮挡','按图调整右前腿的让位姿态'));
  }
  if (step.kind!=='confirm') throw new Error('工艺卡缺少工序定义 '+step.id);
  let source, target, distractor;
  if (chapter==='mount') [source,target,distractor]=['电控盒线束','侧摆电机接口','膝电机接口'];
  else if (step.wireFastening) [source,target,distractor]=['侧摆电机线束','髋电机接口','电控盒接口'];
  else [source,target,distractor]=['髋电机线束','膝电机接口','侧摆电机接口'];
  return stepPlan([label+source,'另一腿位的'+source,'躯干抱箍紧固件'],
    ['将'+source+'插入'+target+'，检查接头到位','将'+source+'插入'+distractor,'先用线扣压住悬空插头'],
    point('接线去向',source+'接至'+target,'插头指向'+distractor,'将'+source+'改接到'+target),
    point('插头入座','插头对正并进入对应接口','插头留在插座外，尚未插到位','沿接口方向将插头重新插到位'));
}

const screwSites = {
  frameBase:'底框长短梁连接处',controlBox:'长梁与电控盒固定孔',frameBracket:'前后躯干固定件',buffer:'底部缓冲垫',
  kneeMotor:'膝电机输出端',thighClamp:'大腿抱箍',hipKneeClamp:'髋膝抱箍',hipRoll:'髋与侧摆关节连接处',
  legClamp:'躯干与侧摆关节的抱箍',handle:'前后提手',bodyWire:'电控盒至侧摆电机的线扣',hipWire:'侧摆至髋电机的线扣'
};

// A ring can have small head-seat height offsets. Pair projected bore axes, never
// positions across separate hosts. A named six-hole output flange is the only
// ring on which the training manual and the CAD pattern agree on this rule.
function kneeOpposites(rows) {
  if (rows.length!==6 || rows.some(r=>r.role!=='kneeMotor'||r.hostId!==rows[0].hostId)) return null;
  const dot=(a,b)=>a.reduce((sum,n,i)=>sum+n*b[i],0);
  const axis=rows[0].axis;
  if (Math.abs(dot(axis,axis)-1)>.001 || rows.some(r=>Math.abs(dot(r.axis,axis)-1)>.001)) return null;
  const center=[0,1,2].map(i=>rows.reduce((sum,r)=>sum+r.seat[i],0)/rows.length);
  const offsets=rows.map(r=>{
    const d=r.seat.map((n,i)=>n-center[i]), axial=dot(d,axis);
    return d.map((n,i)=>n-axial*axis[i]);
  });
  const radii=offsets.map(d=>Math.hypot(...d));
  if (Math.min(...radii)<1 || Math.max(...radii)-Math.min(...radii)>.1) return null;
  const pairs=[];
  for (let i=0;i<offsets.length;i++) {
    const opposite=offsets.map((d,j)=>({index:j,error:Math.hypot(...d.map((n,k)=>n+offsets[i][k]))})).filter(p=>p.error<.1);
    if (opposite.length!==1) return null;
    if (opposite[0].index>i) pairs.push([i,opposite[0].index]);
  }
  return pairs.length===3?pairs:null;
}

function screwPlan(rows) {
  const {role,spec}=rows[0];
  const site=screwSites[role], count=rows.length;
  if (!site || rows.some(row=>row.role!==role || row.spec!==spec)) throw new Error('不能组合不同规格或用途的紧固件');
  const other = spec==='M6×16'?'M6×22':'M6×16';
  const alternateCount=count===1?2:count-1;
  const kitItem=count+' 颗 '+spec+' 内六角螺钉';
  const kit=[kitItem, count+' 颗 '+other+' 内六角螺钉',alternateCount+' 颗 '+spec+' 内六角螺钉'];
  const tool='与螺钉头匹配的内六角工具';
  const opposites=kneeOpposites(rows);
  let method;
  if (count===1) {
    method=['确认插头就位，将线扣对孔，用内六角工具紧固','先拧紧线扣再把插头塞入','用十字刀头斜压内六角孔'];
  } else {
    method=['用内六角工具逐孔预装，确认对齐，再按图逐孔终紧','先把第一颗拧到底，再靠其余螺钉拉齐','先终紧邻孔，再核对剩余零件'];
    if (opposites) method[0]='六孔先全部预装，确认对齐，再用内六角工具逐对对角紧固';
  }
  const holeChecks=rows.map((row,i)=>{
    const hole='孔 '+(i+1);
    const missing=i%2===0;
    return {
      label:site+' · '+hole,
      good:spec+' 已装入，终紧记录齐全',
      bad:missing?'空孔，缺少 '+spec+' 螺钉':'有预装签记，尚未终紧',
      repair:missing?'补装 '+spec+' 螺钉并完成终紧':'复核该孔对齐后补做终紧',
      visual:missing?'missing':'loose',targetId:row.id
    };
  });
  if(count===1) {
    holeChecks.push({...point('线束走位','线束平顺并位于线扣内','线束被夹在固定面边缘','松开线扣，理顺线束后重新固定'),visual:'none'});
  }
  const plan={kit,method,points:holeChecks};
  plan.screw={spec,count,tool,opposites};
  return plan;
}

// Some defects are visible as a missing part or an incomplete seating motion.
// A label or connection record alone cannot support an invented displacement.
const partVisuals={
  bottomRail:[null,'unseated'],shortBeam:[null,'unseated'],controlBody:['unseated','unseated'],
  topRail:['missing','unseated'],frameSupport:['missing','unseated'],cushion:['missing','unseated'],
  kneeMotor:[],thighClamp:[null,'unseated'],hipMotor:[null,'unseated'],motorClamp:['missing','unseated'],
  rollMotor:[],leg:[],bodyClamp:[null,'unseated'],sleeve:['missing','unseated'],handle:['missing','unseated'],
  battery:['unseated','unseated']
};
function observationPoints(step,plan){
  return plan.points.map((item,i)=>{
    if(item.visual)return item;
    const visual=partVisuals[step.role]?.[i];
    if(!visual||!step.roots.length)return {...item,visual:'none'};
    return {...item,visual,targetId:step.roots[Math.min(i,step.roots.length-1)]};
  });
}

function question(step, prompt, choices, feedback, seed) {
  // Deterministic option order also keeps stored answers stable on reload.
  const answer=[...step.id].reduce((sum,c)=>sum+c.charCodeAt(0),seed)%choices.length;
  const options=choices.slice(1);
  options.splice(answer,0,choices[0]);
  return {question:prompt,options,answer,feedback,page:step.page};
}

export function buildProcessCatalog(assembly,manual,fasteners) {
  const items=fasteners.items;
  const fastenerById=new Map(items.map(row=>[row.id,row]));
  // The teaching engine resolves selectors by occurrence through the assembly tree.
  // These semantic rows supply only the supplemental parts needed for that lookup.
  const nodes=assembly.nodes.slice();
  const present=new Set(nodes.map(n=>n.id));
  for (const item of items) {
    if (present.has(item.id)) continue;
    nodes.push({...item,parent:item.hostId,name:item.spec+' 内六角螺钉',center:item.seat,
      geometry:true,fastener:true,supplemental:true});
  }
  const pack=nodes.find(n=>n.name.startsWith(manual.selectors.battery));
  if (pack && !present.has(pack.id+'_manual_cassette')) {
    nodes.push({id:pack.id+'_manual_cassette',parent:pack.id,name:'电池盒体（说明书补形）',geometry:true,supplemental:true});
  }
  const procedures=createProcedures({...assembly,nodes},manual);
  const legs=new Map(manual.legs.map(leg=>[leg.id,leg]));
  return procedures.chapters.map(chapter=>({...chapter,steps:chapter.steps.map(step=>{
    const role=step.role,leg=legs.get(step.leg);
    const plan=role==='screw'?screwPlan(step.roots.map(id=>fastenerById.get(id))):partPlan(step,leg,chapter.id);
    const hint='对照第 '+step.page+' 页。'+step.detail;
    return {...step,role:role??(step.kind==='confirm'?'wire':'pose'),leg:step.leg??null,
      kit:question(step,'「'+step.title+'」应选哪组物料或操作对象？',plan.kit,plan.kit[0]+'。'+step.detail,0),
      method:question(step,'工件定位后，怎样执行「'+step.title+'」？',plan.method,plan.method[0]+'。',1),
      inspection:{points:observationPoints(step,plan)},hint,actionLabel:step.uiLabel||(step.kind==='part'?'装入所选零件':'确认已完成'),
      ...(plan.screw?{screw:plan.screw}:{})};
  })}));
}
