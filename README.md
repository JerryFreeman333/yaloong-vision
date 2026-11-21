# yaloong-vision · BPX Studio

[在线功能图库](https://jerryfreeman333.github.io/yaloong-vision/) · [从零组装机器狗](https://jerryfreeman333.github.io/yaloong-vision/assembly.html)

首次从源码运行时，使用 Node.js 24，在项目目录执行 `npm ci` 和 `npm run build`。向 `main` 推送更新后，GitHub Actions 会重新构建并发布到 GitHub Pages。

BLACK PANTHER X 四足机器人 Three.js 虚拟装配与机构运动仿真。macOS 用户双击 **启动仿真.command**，即可用浏览器打开本机发行版。首页是 React 功能图库，分为装配教学、结构拆解、运动控制和质量交检。12 段 GIF 支持放大预览，可从卡片或预览进入对应课程或三维工位。点击「返回图库」会恢复筛选、滚动位置和原来的操作入口。图库使用本地图片，进入三维仿真时才加载 CAD 模型。启动本机服务需要 Python 3，三维仿真需要支持 WebGL 2 的浏览器。开启浏览器图形加速可获得完整金属纹理、面积光和动态阴影。软件渲染器会降低分辨率并简化光照和螺纹显示。启动后从本机读取模型、材质和求解器。

## 仿真操作

- **部件** 支持按名称、编号搜索或直接拾取。选择「显示碰撞体」可核对当前零件的求解外形，「近看零件」可对准小螺钉，「定位待拆件」会选中装配依赖。拆件由夹具托持，可放入托盘、松夹、取回并装回原位。拆卸承重件时，维修支架先顶升至机身承重面。拆足端时先退出两侧固定件，待维修支架承重且足垫有足够退出空间，再移出足垫。
- **运动** 可点动四条腿的侧摆、髋和膝关节，切换站立、趴下和支架辅助抬右前腿。维修时，支架托住机身，为电池的抽出和推入留出空间。「前进速度」滑杆以厘米/秒设定目标速度，支持在起步前和行走中调节。「向前行走」沿机身前向迈步，显示相对出发朝向的角度与距起点的水平距离。行走时还可查看当前支撑足数和「平衡余量」，即压力中心到支撑足围成区域边界的最短距离。「停稳」让摆动足落地，四足承重后可从当前位置继续行走。工作台长 5.4 米，接近台边时会自动收步。「左转」和「右转」每次踏步转向 30°。「倒退回原点」沿去程分段倒退，在转弯处先转回上一段的朝向，四足依次回到出发时的落点。可在返程中途点「停稳」。「原地跳跃」依次执行下蹲、蹬地、腾空、触地缓冲和恢复站姿。「高跳左转」和「高跳右转」以起跳时的地面反力产生旋转，腾空后转向约 45°。向前行走中点转向动作会先收步，站稳后沿新方向继续；可点「停稳」取消续行。「接触与承重」显示当前附着质量、支撑合力和接触部位。拆下零件后，质量和支撑会随配置变化。
- **爆炸** 使用滑杆展开或合拢整机。进入时保存当前姿态和已拆件的位置，退出时恢复。爆炸距离仅用于结构展示。
- **装配** 按说明书分为躯干框架、四腿拼装、腿部上机和电池四章。选中目标后执行操作。在螺钉或电池步骤可改变横向偏移与倾角，观察干涉。受阻时用「退回起点」撤回，再用「回到导向轴」对正重试。「上一步」可撤销已提交的操作。

## 整机装配实训

从图库的「进入整机装配台」或仿真页的「从零组装机器狗」进入 `/assembly.html`。新工单从底框第一根 320 mm 长梁开工。拖动「拿取零件」标记，对照绿色轮廓放到定位处；也可依次点选工件和安装位。也可从侧栏选择同一件零件。右上角可查当前工序的原厂工艺图，旋转视角可观察配合面和导槽。

课程依次完成躯干与电控盒（10 道）、四腿关节拼装（48 道）、四腿上机与提手（23 道）、电池导入与锁合（5 道）。零件入位、紧固、插接和姿态动作完成后记录进度。后章按装配顺序开放，刷新后可继续，整机装完可下载个人装配记录。`/whole.html` 使用同一工单，并可接续原连续装配的进度。

需要单独练一个部位时，从装配台底部的「单项工位」进入 `/stations.html`，按章节或腿位查找工序。引导练习直接进入三维操作，可查备料和工艺提示；「独立考核」单列在学习模式中。专项接线以 CAD 线束与真实部件的连接关系校验，机身至侧摆线路使用电控盒作出线基准。扭矩值需以实物工艺依据考核。

## 膝关节专项练习

从整机课程首页进入「膝关节专项练习与考核」，或访问 `/knee.html`。左前腿工单提供查图、提示与撤销，右前腿工单独立评分。学生完成电机入座、六孔预装、对角终紧和返修后提交成绩。专项工单独立保存，可恢复先前的练习。

学生可从领取工单页观看分步演示，交卷后查看分项成绩、下载个人工单。图纸和几何随发行版提供，训练不需要访问外网。

## 几何、表面和受力依据

OpenCascade XDE 提取 303 个 CAD 几何实例。按孔位和规格补建 108 颗内六角螺钉，依据说明书和安装空间补形 1 个电池盒体，共 412 个几何实例。装配坐标使用毫米，Y 轴向上，动力学和场景照明使用米。原始三角化保存在 `public/assets/bpx.glb`，浏览器读取压缩的 `bpx-runtime.glb`。

- **材质与光照** 沿型材挤出方向、车削圆周方向和铣削面生成毫米尺度的表面纹理，不同表面有各自的高光、粗糙度和微表面法线。机身上方的有限面积顶灯提供直接光，其位置也用于计算阴影。金属同时反射受该灯照亮的工作间，车间摄影全景作为虚化背景。车间图像来自 [Poly Haven · Machine Shop 02](https://polyhaven.com/a/machine_shop_02)，采用 [CC0](https://polyhaven.com/license)。
- **逐件碰撞** 412 个实物零件各自具有实体碰撞体。板件、型材和壳体从 CAD 网格的内部占据区域生成体素，足垫使用外轮廓凸体，补建的螺钉分别描述头部和杆部。拆下进入托盘的部件继续使用相同体积。关节点动、步态和拆装路径会额外对 CAD 障碍面做扫掠，检查运动途中的干涉。把手按铰链圆弧检查，电池沿导槽检查，紧固时校验孔位和轴线。
- **机构与行走** 机身与四腿组成 21 个刚体。每条腿的侧摆、髋和膝有独立驱动，曲柄及连杆按 CAD 铰点闭环连接。点动与顶升由 Rapier 以 240 Hz 固定步长求解。工作台慢行采用逐足四拍步态。起步先由四足承重，机身沿行进方向前移，再依次抬脚。支撑足锚定在台面，换脚时依据质心与落脚位置沿前后方向交接负载。平地行走根据各刚体质心的合成加速度计算所需压力中心，并将地面反力分配到各足垫实际接触台面的区域，逐次校验支撑边界、可用摩擦、驱动力矩与 CAD 干涉。摆动足落下后才交接支撑。跳跃采用质心弹道模型，蹬地和着地按四足接触求解反力，腾空时支撑力为零。步态频率、跳跃行程及摩擦使用仿真设定。
- **步态参考** Spot SDK 定义了逐足慢行和对角小跑。ETH 的 ANYmal 控制示例将支撑足速度、摆动足接触力和足底摩擦约束分别处理。BPX 的平整台面工况采用低速爬行，控制参数按自身 CAD 与接触模型设定。[Spot SDK 步态定义](https://github.com/boston-dynamics/spot-sdk/blob/master/protos/bosdyn/api/spot/robot_command.proto) · [ETH OCS2 四足示例](https://leggedrobotics.github.io/ocs2/robotic_examples.html#legged-robot)
- **配合基准** 运行时按配合孔轴调整了三个实例，即一个底部缓冲垫和右前、右后两处髋膝抱箍的上半件。每个膝电机以及每条整腿的章内导入从夹具已经对齐的位置开始，只模拟最后的入座行程。依据文件为 `src/service-datums.js` 和 `public/assets/approaches.json`。
- **标定范围** 关节轴和连杆长度来自 CAD。质量按几何体积与估算密度计算，缺少实体的壳体和电芯使用近似值。表面处理、摩擦、关节行程及驱动上限为教学设定。柔性线束以固定外形表示。工程载荷、公差或外观验收需要实测数据。

## 开发与复测

执行 `npm ci` 和 `npm run dev` 启动开发服务。`npm run build` 更新 `dist/` 发行目录。碰撞、动力学及实际交互可独立复测。浏览器脚本使用本机 Chrome。

```sh
node tools/check_process_catalog.mjs
node tools/check_process_attempt.mjs
node tools/check_whole_state.mjs
node tools/check_knee_rules.mjs
node tools/check_part_solids.mjs
node tools/check_collision.mjs
node tools/check_dynamics.mjs
node tools/check_walk.mjs
node tools/check_walk_speed.mjs
node tools/check_walk_balance.mjs
node tools/check_turn.mjs --cad
node tools/check_return.mjs
node tools/check_jump.mjs --cad
node tools/check_articulation.mjs --walk
python3 tools/serve.py --no-browser
# 在另一个终端运行浏览器回归
node tools/check_process_lab.mjs http://127.0.0.1:5318/
node tools/check_whole_lab.mjs http://127.0.0.1:5318/
node tools/check_knee_lab.mjs http://127.0.0.1:5318/
node tools/check_gallery.mjs http://127.0.0.1:5318/
node tools/check_viewer.mjs http://127.0.0.1:5318/simulator.html
node tools/check_foot_service.mjs http://127.0.0.1:5318/simulator.html
```

重建 CAD 数据需要带 cadquery-ocp-novtk 7.9 和 numpy 的 Python 环境。更换模型后需复核装配依赖、运动轴、工装和配合基准。

```sh
python tools/export_cad.py /path/to/BPX.step public/assets
node tools/optimize_glb.mjs
python tools/export_collision.py
node tools/build_part_solids.mjs
python tools/build_inertials.py /path/to/BPX.step
```
