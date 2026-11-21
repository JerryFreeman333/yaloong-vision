export const categories = [
  { id:'all', label:'全部作品' },
  { id:'assembly', label:'装配教学' },
  { id:'structure', label:'结构拆解' },
  { id:'motion', label:'运动控制' },
  { id:'quality', label:'质量交检' },
];

export const features = [
  {
    id:'assembly-course', category:'assembly', title:'从零组装整机',
    summary:'从第一根长梁搭起底框，依次拼腿、上机接线，直到电池锁合。',
    detail:'先在三维工位拿起底框长梁，按安装位置放好两根长梁，再用短梁连接两端。后续工序沿用已经装好的部件，离开后可从上次完成的位置继续。',
    metric:'4 章 · 86 道工序', target:'./assembly.html', action:'进入整机装配台',
    alt:'学生在三维装配台拿取长梁、对准安装位，再连接短梁搭起底框',
  },
  {
    id:'explode', category:'structure', title:'整机爆炸拆解',
    summary:'展开机身、四腿和紧固件，看清电控盒与关节在整机中的位置。',
    detail:'拖动展开滑杆并旋转模型，可以沿装配层级观察内部零件。回到装配位置后，再进入部件浏览定位指定零件。',
    metric:'412 个零件实例', alt:'机器狗在工作台上分解展开，再收回装配位置',
  },
  {
    id:'walk', category:'motion', title:'步态与承重',
    summary:'观察四足交替支撑，调节行走速度，查看支撑足数和平衡余量。',
    detail:'慢行时每次抬起一足。可在行走中调速或请求停稳，查看行进距离，再沿去程分段倒退回原位。',
    metric:'四拍步态', alt:'机器狗在工作台上交替抬脚迈步',
  },
  {
    id:'fastening', category:'assembly', title:'六孔预装与对角终紧',
    summary:'逐孔预装、复核对齐，再成对终紧。少装一孔就能看到工序拦截。',
    detail:'膝电机输出端有六个固定孔。学生选择 M3×8 螺钉和内六角工具，系统把预装与终紧分别记入每一孔的记录。',
    metric:'6 个独立孔位', target:'./knee.html', action:'进入膝关节工位',
    alt:'膝关节工位展示输出端六个孔位与逐孔紧固的过程',
  },
  {
    id:'wire', category:'assembly', title:'线束错接与纠正',
    summary:'选定线束来源和目标接口。接错电机时，工位会拦截并允许重新对接。',
    detail:'演示选取左前髋膝线束，先误选侧摆电机，再改接膝电机接口。正确对接后进入本工序的质量交检。',
    metric:'来源与目标双端校验', target:'./stations.html#station/legs/legs-05', action:'体验线束对接',
    alt:'左前髋膝线束接到错误电机时被拒绝，换回正确接口后进入交检',
  },
  {
    id:'inspection', category:'quality', title:'逐项交检与返修',
    summary:'查紧固记录、定位故障，修复后再复检，形成可追溯的交接工单。',
    detail:'在待交接件上逐孔查验紧固记录，标出异常孔位并选择放行或返修。补紧后再复检，个人工单保留首次判断和返修结果。',
    metric:'缺陷定位与复检', target:'./knee.html', action:'进入交检训练',
    alt:'学生在待交接工件上查验记录、定位异常并完成返修复检',
  },
  {
    id:'battery', category:'assembly', title:'电池导向装配',
    summary:'调整机身姿态、翻起把手，将电池沿导槽推到底，再扣合锁止。',
    detail:'电池章节按五步推进。三维工位呈现抬右前腿让位、把手翻转、沿槽推入与锁合的连续动作。',
    metric:'五步锁合工艺', alt:'电池沿机身导槽推进，随后把手转动并锁合',
  },
  {
    id:'collision', category:'assembly', title:'装配干涉检测',
    summary:'把电池横向偏移 6 mm，观察导槽拦截，再退出、对轴和重试。',
    detail:'完成电池章节前三步后，在推进步骤调整偏移或倾角。接触时夹具停止，并显示阻挡部位，学生可以沿原路径退回。',
    metric:'CAD 路径检测', alt:'偏移的电池被导槽阻挡，退回对正后成功推入',
  },
  {
    id:'part', category:'structure', title:'单件拆卸与复装',
    summary:'近看螺钉退出安装孔，观察夹具取放和托盘转运，再装回原位。',
    detail:'从一颗 M6×16 框架螺钉进入部件浏览，可查看零件碰撞体，尝试拆卸并复装，检查装配依赖与操作空间。',
    metric:'夹具与零件托盘', alt:'夹具对准框架螺钉，将其退出安装孔后复装',
  },
  {
    id:'joint', category:'motion', title:'单关节点动',
    summary:'选择一条腿，分别调整侧摆、髋和膝关节，追踪连杆与足端轨迹。',
    detail:'进入工位会选中右前腿。改变关节目标角度，观察相邻机构的联动以及接触和承重读数。',
    metric:'12 个主动关节', alt:'右前腿膝关节点动，连杆和足端同步移动',
  },
  {
    id:'turn', category:'motion', title:'左右踏步转向',
    summary:'查看逐足转向，观察机身朝向如何变化，再沿新方向继续行走。',
    detail:'每次转向目标为 30°。行走中发起转向时，机器狗会先收步，调整朝向后续行。',
    metric:'单次转向 30°', alt:'机器狗通过逐足换位完成跨步转向',
  },
  {
    id:'jump', category:'motion', title:'高跳空中转向',
    summary:'拆看下蹲、蹬地、腾空与缓冲阶段，观察转体后的落足位置。',
    detail:'高跳转向的仿真目标约为 45°。切换转向方向，观察蹬地与落足，比较各阶段的支撑状态。',
    metric:'空中转向约 45°', alt:'四足机器狗蹬地腾空、转向并落地缓冲',
  },
];

export const categoryLabel = id => categories.find(c => c.id === id)?.label;
export const featureUrl = item => item.target || './simulator.html?feature=' + item.id;
