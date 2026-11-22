# 星野计划 · 微信小程序版

同一套计算逻辑（`lib/`）跑在**微信云开发云函数**里，小程序端只做表单、列表、便签、地图选点。
网页版不受影响；以后改评分规则只改 `lib/`，两端同时生效。

## 目录

```
project.config.json   微信开发者工具工程配置（miniprogramRoot=miniprogram/，cloudfunctionRoot=cloud/）
cloud/astroPlan/
  index.js           云函数入口（CommonJS，动态 import 加载 ESM 运行时）
  package.json       云函数依赖声明（无第三方依赖）
  runtime/           构建产物：lib/ 全量 + astronomy-engine + data + app.mjs（约 1.3 MB）
miniprogram/
  app.js / app.json / app.wxss
  pages/search       查询条件（类型 / 日期 / 地区三级联动 / 出发地 / 高度角 / 波特尔）
  pages/results      结果卡片列表 + 分页 + 便签弹层
  pages/map          原生地图选点（173 站点标注、点击取经纬度、角分秒输入）
  components/note-sheet  便签半屏弹层（分区 + 推荐理由）
  utils/             api（云函数调用）/ coord（经纬度解析）/ format（展示格式化）
```

## 一次性准备（需要你的账号）

1. **注册小程序**：<https://mp.weixin.qq.com> → 立即注册 → 小程序。类目选「工具 → 信息查询」。
2. **开通云开发**：微信开发者工具 → 云开发 → 开通 → 记下**环境 ID**。
3. **两个占位符已填好**：
   - `miniprogram/app.js` → `cloudEnv: 'astroplan-d5gg67qu6533ce03c'`
   - `miniprogram/project.config.json` → `appid: 'wx4b10ca10c39f00ab'`
4. **构建云函数运行时**（首次或改过 `lib/` 后）：
   ```bash
   node tools/build-miniprogram.mjs          # 生成 cloud/astroPlan/runtime
   ```
5. **导入工程**：微信开发者工具 → 导入项目 → 目录选**仓库根**（含 `project.config.json` 的那一层），
   工具会按 `miniprogramRoot: miniprogram/` 与 `cloudfunctionRoot: cloud/` 自动识别。
6. **上传云函数**：资源管理器里展开 `cloud/astroPlan` → 右键「上传并部署：云端安装依赖（不上传 node_modules）」。
7. **把云函数超时时间改到 60 秒（必须）**：云函数默认只有 **3 秒**，星野计划的一次全国 7 夜查询要 5–15 秒，不改会直接报
   `-504003 FUNCTIONS_TIME_LIMIT_EXCEEDED（Invoking task timed out after 3 seconds）`。
   云开发控制台 → 云函数 → `astroPlan` → 配置 → **超时时间 60 秒** → 保存。
   （`cloud/astroPlan/config.json` 里也写了 `timeout: 60`，但以控制台为准。）
8. **编译预览**：查询页应显示「173 个站点」；点查询进入结果页。真机预览点「预览」扫码。

## 界面与交互

- **开屏**：`pages/splash/index` 是首个页面，全屏星空图 + 「欢迎使用星野计划」，1 秒后 `redirectTo` 查询页（点一下可跳过）。换图只需替换 `miniprogram/assets/splash.jpg`（建议 ≤200 KB）。
- **标题**：全局与各页导航栏标题为「星野计划 by Sirius YANG」（结果页/地图页带后缀）。
- **筛选条件**：按网页版分三组卡片——**拍摄日期**（开始/结束）、**目的地及出发地**（地区/省份/地点/地图选点/出发地）、**拍摄目标**（类型/高度角/波特尔上限），底部查询 + 重置。
- **便签弹层**：右列允许收缩与换行（`grid-template-columns: 180rpx minmax(0,1fr)` + `overflow-wrap:anywhere`），长文本不会顶出屏幕。
- **3D 天球**：便签打开时按需调用云函数 `action:'sim'`（单结果，26–60 KB），用 `miniprogram/utils/skyrender.js`（由 `lib/skyview.js` 的 RENDER_SRC 生成）绘制；支持拖动转视角、双指缩放、播放/暂停、地平/赤道坐标切换。星表取 `meta.sky`（首次进入结果页时缓存）。

## 架构说明

- **不连你的电脑**：小程序的网络请求必须走已备案域名或云开发，因此把计算整体搬到云函数。
- **云函数复用插件代码**：`runtime/` 是 `lib/` 原样拷贝（ESM），入口 `index.js` 用动态 `import()` 加载；Node 16 没有全局 `fetch`，`app.mjs` 里补了一个基于 `node:https` 的 GET 实现（天气、彗星库要用）。
- **不受小程序域名白名单限制**：云函数出网请求 Open-Meteo / MPC 不需要备案域名。
- **地图用原生 `<map>`**：自带底图与缩放，点击事件直接返回经纬度，不搬网页版的 Esri 瓦片代理。
- **便签是半屏弹层**：承载目标 / 时间与月相 / 地点 / 方位与构图 / 拍摄参数 / 天气 / 推荐度明细 + 推荐理由。

## 与网页版的差异（当前版本）

| 项 | 网页版 | 小程序版 |
|---|---|---|
| 结果呈现 | 8 列表格 | 卡片列表 |
| 便签 | 浮窗（含 3D 天球、逐帧模拟） | 半屏弹层（文字分区，**暂无 3D 天球**） |
| 地图 | 自建瓦片 + 离线省界 | 微信原生 `<map>`，无离线省界 |
| 天气 | Open-Meteo（云端抓取） | 同（云函数抓取，Node 16 用 https 兜底） |
| 数据 | 插件内置 | 云函数内置（运行时打包） |

3D 天球（`RENDER_SRC`）是纯 canvas 2d 绘制，可以复用；需要把 `wx.canvas 2d` 的尺寸/DPR 与触摸手势接起来，属于下一步工作。

## 云函数接口

| action | 参数 | 返回 |
|---|---|---|
| `meta` | — | 站点 / 目标 / 事件类型 / 天气窗口 / 城市 |
| `search` | `opts`（与网页版一致，默认 `withSim:false`） | 与网页版 `search()` 相同结构 |
| `night` | `site` 或 `siteLat/siteLon` + `date` | 单夜时间轴 |
| `bortle` | `lat`、`lon` | 城市光晕模型估算的波特尔 |
| `sim` | `opts` + `siteId` 或 `siteLat/siteLon` + `date` + `targetId` | 单结果 3D 画面模拟数据（懒加载） |

## 合规与审核

- **不收集个人信息**：没有账号系统，不落库，不采集设备信息；如后续加收藏/云存储，需要在「用户隐私保护指引」里声明。
- **类目**：工具 → 信息查询（摄影/天文类内容不涉及新闻、不涉及交易）。
- **网络请求**：全部走云函数，无需在小程序后台配置 request 合法域名。
- 测试号（touristappid）只能本地调，真机预览与发布需要正式 AppID。

## 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 页面提示「云开发环境未配置」 | `app.js` 的 `cloudEnv` 还是占位符 |
| 调用报 `-501000` / 找不到函数 | 云函数没上传，或函数名不是 `astroPlan` |
| 查询很慢（1–3 秒） | 云函数冷启动；连续调用会热起来 |
| `-504003` / `Invoking task timed out after 3 seconds` | 云函数超时时间还是默认 3 秒：控制台改为 60 秒 |
| `-501000` | 云函数不存在或未上传 |
| 天气一直是「不可用」 | 云函数出网被限或 Open-Meteo 抖动；稍后重试，不影响到天文结果 |
| 地图上没有站点标注 | `meta` 没加载成功，检查云函数是否可用 |
