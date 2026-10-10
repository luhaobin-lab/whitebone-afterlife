# 公开发布验证记录

发布版本：`0.1.0`。当前界面使用“拉杆 → 查看并领取招魂结果 → 整理军团 → 进攻”的流程。代码中保留了即时出生相关领域API，但发布界面未启用该交互，也未将其作为已发布功能验收。

本文区分本次发布检查和此前构建的历史证据。原始JSON、截图和日志路径表示本地证据位置，不代表仓库附带这些文件；历史`artifacts/`目录不随公开仓库发布。下方命令可以在本地生成新的报告。

## 本次发布检查

| 检查 | 结果与范围 |
|---|---|
| 规则测试 | `npm test`：90/90通过，包括50项经营、33项战斗、7项轮盘测试；轮盘测试包含全部262144种四族盘面穷举 |
| 构建 | `npm run build`通过，包含TypeScript检查与Vite生产构建 |
| 渲染兼容 | 现有领取界面与渲染器接口兼容复验通过 |
| 领域兼容 | 均衡、毒疗、骑兵三策略各使用`campaign-v1-001`完成36波；每局完整经营与战斗记录和此前构建的对应种子逐字段一致 |
| 离线入口 | Chromium无头模式、1440×900、禁用网络，直接通过`file://`打开单文件HTML；领取、部署、战斗、保存重载和继续下一波通过 |

领域兼容检查只覆盖上述三局，不是本次版本的90局重测。本地记录为`artifacts/balance/auto-birth-legacy-replay-3.json`与`auto-birth-legacy-verification.json`；记录同时注明源码版本不同、运行中源码未变化。

本次离线检查于`2026-10-10T03:14:20.199Z`完成。本地报告`artifacts/offline/github/report.json`明确记录`uiFlow = claim-dialog`，即实际使用领取结果界面。固定种子`offline-birth-1`自然产生一名R2新兵，通过领取按钮补入第4阵位；战斗第3秒保存重载，首波10.55秒获胜，随后进入第2波。全过程使用可见控件和正常帧推进，未调用加速时间接口或注入游戏状态。外部请求、页面错误和控制台错误均为0。

离线入口为`releases/Whitebone/白骨开张.html`，大小2,178,073字节，SHA-256：

```text
cf21978b8361ae7f8fc64fe3c1a5dc63628317c4ff923dfb4a47496264ecd36f
```

包内`version-manifest.json`记录构建输入、输出校验值和验证摘要，并确认打包期间输入未变化。打包脚本只读取已完成的`dist`，不会自行构建。单文件包含运行所需脚本、样式、程序绘制图形与合成音效；说明和第三方许可一并保留。

发布压缩包`Whitebone_Prototype_v0.1.0.zip`大小689,216字节，7项文件均通过CRC与解压后字节比对。SHA-256为`2701d6ee52f054a9a007c8645f6a60ca9facd10e3c46d9c116bb42b5ecd70db1`。

## 此前构建的完整验证

以下结果来自此前构建，作为历史基线保留。它们不代表本次发布重新执行了相同规模的验证。

| 历史检查 | 已记录结果 |
|---|---|
| 90局真实远征 | 三种合法经营策略各30个固定种子；均衡30/30、毒疗30/30、骑兵29/30完成全部36波，零策略/API错误 |
| 三种军团的浏览器整局 | 均衡/召唤、毒疗、骑兵分别通过真实DOM点击、输入和选择完成36波及21节点，零浏览器错误；战斗使用公开时间推进接口加速 |
| 保存与恢复 | 90局累计6967次阶段重载、3216次战斗中途快照恢复；另有三局关闭重载的对照，经营和战斗记录相同 |
| 地图 | 1000种子全部57节点可达，零非法连接；后段遭遇变体均有覆盖 |
| 职业与专精 | 受控战斗场景观察到36主技、36被动执行，72专精产生可测行为变化 |
| 界面边界 | 记录过导入/导出、战中查看属性、合法弱队失败、同种子重开、取消导入、拒绝损坏存档、全屏和满编操作区检查 |

历史远征报告生成于`2026-10-09T20:01:37.083Z`，其统计摘要与限制见`docs/BALANCE_REPORT.md`。当时记录的战斗源码SHA-256为`3c41a7aa855d564d5a001c1d3bb3b8ca7befffe4fde535e9140a820620575997`。原始证据曾保存在本地`artifacts/balance/shipping-30.json`、`artifacts/ui/campaign-*/report.json`及`artifacts/combat/profession-audit.json`等位置，公开仓库不附带这些历史原始文件。

职业机制审计使用专门构造的受控场景，部分经营状态测试使用战果夹具；这些检查分别证明规则执行和状态转移。真实远征结论来自实际战斗仿真，浏览器整局结论来自控件操作，二者均不等同于真人体验验收。

## 在本地复现

安装依赖、运行测试与构建：

```sh
npm ci
npx playwright install chromium
npm test
npm run build
```

生成当前检出版本的离线包及本地短流程报告：

```sh
node scripts/package-game.mjs --status final --verify --evidence artifacts/offline/local
```

脚本会根据实际界面选择验证路径；当前发布界面应记录为`claim-dialog`。报告和截图生成在指定的本地目录，入口及校验摘要生成在`releases/Whitebone`。此检查只覆盖首波流程，不是整局通关测试。

生成三策略各一局或各30局的真实远征数据：

```sh
npm run balance -- --roundtrip --seeds 1 --offset 1 --strategy all --out artifacts/balance/local-three.json
npm run balance -- --roundtrip --seeds 30 --strategy all --out artifacts/balance/local-90.json
```

新报告对应运行时的源码版本，并包含源码哈希。它们不会恢复未随仓库发布的历史报告；历史逐字段比较需要保存相应旧版报告作为基线。

浏览器整局检查先在另一个终端运行`npm run preview`，再执行：

```sh
npx tsx scripts/ui-campaign.ts --starter plague --seed campaign-v1-001 --url "http://127.0.0.1:4173/?test" --out artifacts/ui/local-plague
```

将`plague`替换为`legion`或`cavalry`可检查其他起手。渲染器场景检查则先运行`npm run dev`，再执行`node tests/render-audit.mjs`，在本地`tests/render-evidence/audit`生成报告与截图。

## 验收边界

- 尚无真人从零学习到通关的30分钟计时验收。此前自动策略平均纯战斗时间约6.62–10.92分钟，不包含阅读、经营、拖放和决策；脚本墙钟耗时也不能代替真人游玩时长。
- 熟练自动策略胜率较高，部分成型阵容后期变化较少；长期重复游玩的乐趣、教学理解度和决策价值仍需真人试玩。
- 本次离线结果仅覆盖被测Chromium配置。没有据此宣称Windows、Safari、手机或低性能设备均已通过；本地文件存储和音频行为也可能受浏览器设置影响。
- 程序运行与截图检查不等于主观音效体验、长期操作舒适度或完整无障碍验收。
