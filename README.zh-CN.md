<div align="center">

# Palette Extractor

[![Tests](https://github.com/Ian9657/palette_extractor/actions/workflows/test.yml/badge.svg)](https://github.com/Ian9657/palette_extractor/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) | **简体中文**

从一张图片提取 3–8 色的界面调色板，给每个颜色分配角色（`BASE`、`TEXT`、`PRIMARY` 等），修正文字色和主色的对比度，并导出 CSS、Tailwind 和 Figma 色值。

[palette.etarc.net](https://palette.etarc.net) · 纯静态 HTML/CSS/JS，无构建步骤，无运行时依赖 · 图片不离开浏览器

![Signal Edition](docs/screenshot.jpg)

</div>

## 流程

```text
图片 ─ 画布，长边 400 px
     ─ 显著性图 + 15 位直方图          页面线程
     ─ k-means，2k+4 个候选             Web Worker
     ─ 贪心挑选 k 个                    Web Worker
     ─ 角色搜索 · 对比度修正 · 补色     页面线程
     ─ CSS / Tailwind / Figma / PNG 导出
```

全部逻辑在 `js/color.js`，不依赖 DOM：页面以普通脚本加载它，k-means 部分转成字符串放进 Worker，Node 测试直接 `require`。

### 1. 直方图与显著性

图片画进长边不超过 400 px 的画布，丢弃 alpha < 128 的像素。其余像素放进 32,768 个桶（每通道 5 位）。每个桶记录其像素的平均 RGB，而不是桶中心，所以报出的颜色都在原图里真实存在。

显著性用 OKLab 下的频率调谐法（Achanta 等，2009）：每个通道做两次半径 `min(w, h) / 160` 的盒式模糊，像素的显著性为它到全图均值的距离。其中 `a`/`b` 乘以 2.5，让色度比亮度更有分量。结果按第 99 百分位归一化，每个桶带上其像素的平均显著性。

### 2. 候选：k-means

在 OKLab 中聚类：用带种子的伪随机数（mulberry32）做 k-means++ 初始化，权重为 `count × (1 + 3·显著性)`，最多 15 轮。Worker 每轮都把结果发回页面，页面以每帧 60 ms 回放，这就是扫描动画。

聚类数是 `2k + 4` 而不是 `k`。在最后两轮之前，距离小于 0.07 的两个中心会合并：较小的那个改放到 `到其余中心的距离 × min(色度权重, 3) × log(1 + 像素数)` 最大的桶上。最后每个中心吸附到本簇内最近的真实桶。

### 3. 挑选

从 `2k + 4` 个候选中贪心挑出 `k` 个，最大化

```text
F(S) = coverage(S) + λ · Σ distinct(j) · vivid(j) / max vivid      λ = 0.1
```

- **coverage**：设施选址覆盖。每个像素由最相近的已选颜色覆盖，`sim = max(0, 1 − d/τ)`，τ = 0.2（OKLab），按像素数加权。它是单调次模函数，所以贪心解在这一项上不低于最优的 `1 − 1/e`。
- **vivid(j)**：簇内 `显著性 × standOut` 的平均值，`standOut = max(min(1, C/0.15), 0.6 · min(1, |L − L̄| / 0.35))`。取平均而不取总和，面积只由 coverage 负责。占比不足 0.2 % 的簇记 0。
- **distinct(j)**：`min(1, d_最近 / 0.25)`，距离同样按色度 ×2.5 加权，防止几种相近的深色占满名额。

这三项来自 Lin & Hanrahan（CHI 2013）。实际效果是：占画面 1 % 的霓虹灯可以挤掉第四种近黑色。

### 4. 角色

每个 `k` 对应固定的角色表（`color.js` 里的 `ROLE_NAMES` / `ROLE_KEYS`；k = 5 时为 `BASE SECOND PRIMARY ACCENT TEXT`）。分配用穷举排列，最多 8! = 40,320 种。每个角色按 OKLCH 下的几个具名项打分，例如：

| 角色 | 打分项 |
| --- | --- |
| `bg` | `log(面积)` − 8C + 1.5·\|L − 0.5\| |
| `text` | 1.5·log(对 bg 的对比度) − 2C |
| `primary` | 8C + 0.2·log(面积) |
| `accent` | 2C + 3·与 primary 的色相距离 |

各项分开保存，`gallery.html` 可以显示某个颜色为什么得到某个角色。

### 5. 对比度修正与补色

`TEXT` 对 `BASE` 须达到 4.5:1，`PRIMARY` 须达到 3:1（WCAG 2 对比度）。不达标的颜色沿 OKLCH 亮度以 0.01 步长移动：先朝较近的一端、保持色相和色度，再试一次并让色度逐步降到 0。原色值会保留，色块标记 `ADJ`。

如果图里的不同颜色少于 `k` 个，缺的由主色和最鲜艳的颜色推导（文字用墨色、表面层级、补色、更亮和更暗的层级）。与已有颜色的 OKLab 距离小于 0.05 的候选跳过。这些颜色标记 `GEN`。

### 6. 检查与导出

- 所有颜色两两之间的 WCAG 对比度或 APCA（0.0.98G-4g）矩阵。
- 色觉缺陷模拟：Machado 等 2009，严重度 1.0，在线性 sRGB 中计算。`primary`/`accent`/`secondary`/`highlight` 之间的组合变得无法区分时给出警告。
- CSS 变量含浅色和深色两套（hex，加 `oklch()` 覆盖）；Tailwind 配置每个角色 11 级色阶（50–950：保持原色相，OKLCH L 从 0.97 到 0.24，远离 L 0.6 时色度渐减）。
- Figma token JSON、1200 × 1500 PNG 封面，以及按角色顺序写在网址里的分享链接 `#p=HEX-HEX-…`。

## 04 印刷打样

![EJECT PLATES](docs/proof-eject.webp)

打样只用调色板里的颜色，把照片重绘成赛璐璐动画画面，再拆成每色一块版加一块 K（线条）版。每个像素只属于一块版。

`js/proof.js`（页面端）按显著性图选取 16:9 画面并负责绘制。长边不足 480 px 的图整张显示，占 80 %。工作图宽度不超过 1024 px，每张图只发给 `js/proof-worker.js` 一次。Worker 按"图片 + 调色板"缓存分析结果，每块版返回一个 RGBA 缓冲区；过期的回复按任务编号丢弃。分析步骤：

| 步骤 | 方法 | 参数 |
| --- | --- | --- |
| 色块 | 对 L 做引导滤波（He 等，2010）两遍，再取最近的墨色；过小的块并入周围 | r = 5 px（以 960 宽为基准），ε = 0.0025，最小块 0.04 % |
| 阴影 | 向下一个更深的墨色硬切一级 | ΔL 0.07 |
| 网点 | 4 px 网格的半调网点，网点面积 = 向更浅墨色的提升量 | 面积 ≤ 0.5 |
| 线条 | 墨色不同的色块边界，加上只保留成笔画的 DoG 边缘 | ΔE > 0.08，DoG < −0.012，笔画 ≥ 30 px |
| 残影 | 最显著主体的 3 个偏移副本（主体超过画面宽度 45 % 时不画） | 间距 ≥ 14 px（以 960 宽为基准） |

版按面积叠放：面积最大的在最下面，K 版在最上面。EJECT 按钮、拖动或 ←/→ 键可以在 6 个位置之间拆开或装回。

## 确定性及其限制

同样的像素 + 同样的 `k` + 同样的种子 → 同样的调色板（测试覆盖 k = 3、5、8）。REROLL 把种子加一。

已知限制：缩到 400 px 这一步由浏览器的 `drawImage` 完成。Chromium 和 WebKit 的重采样方式不同，同一个文件得到的桶会略有差异。两个角色分数接近时，角色可能对调（例如 Chrome 里 `TEXT` 是白色，Safari 里是黄色）。这是下一步计划要修的问题。

## 存储

不上传任何东西。`localStorage` 键：`paletteHistory`（最近 8 条）、`starredPalettes`、`palette.thumbs`（240 px 原图缩略图，可在页面上清除）、`contrastModel`、`accessionCount`、`proofRevCount`。

## 测试与工具

```sh
npm test            # node --test：53 项，约 30 秒，无需安装依赖
```

`test/color.test.js` 覆盖色彩空间转换、已知颜色还原、种子确定性、角色、对比度修正、显著性挑选和补色。`test/proof.test.js` 在 `vm` 里加 `importScripts` 垫片运行 `proof-worker.js`。CI 在每次推送到 `main` 时运行 `npm test`。

浏览器工具（`npm install && npx playwright install chromium webkit`）：

| 命令 | 作用 |
| --- | --- |
| `npm run edge` | 10 种合成图片（1 × 1、40 × 3000、8000 × 6000、全透明等）在 Chromium 和 WebKit 中跑真实页面 |
| `npm run perf` | 冷启动、示例图 → 调色板、示例图 → 打样的耗时，分桌面速度和限速 CPU/网络 |
| `npm run shots -- dir/` | 桌面和 iPhone 截图，减少动态效果 + 固定时钟 |
| `npm run compare -- a/ b/` | 两组截图的像素差异 |

`gallery.html` 运行 `regression/` 里的 15 张图和若干合成用例，对每张图显示角色、打分项和平均 OKLab 还原误差，并与保存的基线对比。

## 本地运行

```sh
python3 -m http.server     # http://localhost:8000，/gallery.html
```

## 文件

```text
index.html  classic.html  gallery.html     页面（网址不变：/、/classic、/gallery）
icon.svg  apple-touch-icon.png  og-image.png  CNAME
css/        style.css、register.css、edition.css · style-classic.css（冻结）
js/         color.js        取色引擎与 Worker 启动
            main.js         页面状态、取色调用、历史、导出
            proof.js        04 打样取景与绘制
            proof-worker.js 04 像素计算（Worker）
            edition.js、register.js、pagefx.js、fx.js、follow.js   Signal Edition 版式与动效
            previews.js、samples.js、cover.js、gallery.js、ntc.js
            *-classic.js    冻结的经典版
fonts/      自托管 woff2 + fonts.css + OFL.txt
samples/    6 张示例图（1920 px）+ thumbs/（256 px）
regression/ 15 张回归图 + list.js
test/       node --test 测试
tools/      Playwright 工具（edge、perf、shots、compare）+ 静态服务器
docs/       DESIGN.md（颜色变量、网格、字体、动效规则）与 README 图片
```

## 许可

代码：MIT（[LICENSE](LICENSE)）。`ntc.js`（Name that Color，Chirag Mehta）为 CC BY 2.5；字体为 SIL OFL 1.1（[fonts/OFL.txt](fonts/OFL.txt)）；示例图和回归测试照片来自 Unsplash，适用 Unsplash License。详见 [NOTICE](NOTICE)。
