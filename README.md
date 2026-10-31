# dsh-dfy-bqb · 大肥鱼表情包插件

让大肥鱼在抖音网页端的**私信**和**评论区**回复时，不再只发文字，而是读懂对方消息/评论的内容，按情绪自主选择表情包回复，支持 **纯文字 / 纯表情 / 文字+表情** 三种形态，更像真人聊天。

## 核心能力

- **内容情绪识别**：对每条消息/评论判定主情绪（开心 / 难过 / 愤怒 / 害羞 / 疑惑 / 日常）与场景意图（问候 / 祝贺 / 安慰 / 道歉 / 夸奖 / 投诉 / 调侃 / 提问 / 感谢 / 告别）
- **情绪一致性硬闸**：先定情绪再选表情，发送前强制校验，错配一票否决并降级纯文字——不会出现高兴发悲伤、安慰发愤怒的情况
- **语义匹配**：按关键词、意图标签、使用历史给表情打分，替代随机挑选，避免老发同一张
- **自进化表情库**：四种来源持续扩充，所有新图先审核（`pending`），只有 `approved` 才能发出去
- **拟人风控**：回复前随机延迟、每日贴纸上限、同对象上限、广告/恶意/刷屏内容不回

## 四种表情来源

| 来源 | 模块 | 默认状态 |
|---|---|---|
| ① 网上自主搜寻（公开图片搜索） | `sources/web-search.mjs` | pending 待审核 |
| ② 基于库中表情二创（Pillow 加字幕） | `sources/derive.mjs` | pending 待审核 |
| ③ 调豆包 app 原创生图（Windows UI 自动化） | `sources/doubao-driver.mjs` | pending 待审核 |
| ④ 主人单独投放（文件夹） | `sources/owner-drop.mjs` | approved |

## 处理链路

```
新消息/评论
 → 去重 + 安全判断（广告/恶意/刷屏拦截）
 → 情绪分析（规则引擎基线，LLM 可修正）
 → 形态决策（纯文字/纯表情/文字+表情，先查风控上限）
 → 语义匹配表情（情绪一致的候选里打分挑选）
 → 情绪闸二次校验（不一致则降级纯文字）
 → 拟人延迟 → 经底座 MCP 发送 → 回读 → 计数标记
```

## 与底座的关系

本插件不重复造浏览器轮子，通过 stdio MCP 连接底座 [`dsh-douyin-scroll`](https://github.com/hhc2939526265-sudo/dsh-douyin-scroll)，复用其登录态、私信/评论发送与贴纸收集能力。底座路径在设置页配置，留空则自动发现；找不到底座或开启 `offline` 时使用内置 Fake 通道，插件仍可独立加载、自检与演示。

## 安装

```bash
# 在 DSH 中添加本插件（按 cordis.patch.yml 激活）
dsh plugin add dsh-dfy-bqb
```

安装后在设置页配置底座路径、各场景开关、概率与风控参数，或直接编辑 `cordis.patch.yml`。

## 自检

```bash
npm run selfcheck   # 全量语法检查 + 全部单元/集成测试
npm run check       # 仅语法检查
npm run test        # 仅测试
```

## 目录结构

```
dsh-DFY-bqb/
├── package.json            # 工程声明（dsh.bundle.patch）
├── cordis.patch.yml        # 插件激活与默认配置
├── index.js                # Cordis 入口：工具注册、MCP 生命周期、轮询
├── client.js               # 设置页
├── selfcheck.mjs           # 自检入口
├── lib/
│   ├── config.mjs          # 默认配置与合并
│   ├── bqb-store.mjs       # 表情库（状态机 + 计数 + 去重）
│   ├── emotion.mjs         # 内容情绪识别
│   ├── emotion-gate.mjs    # 情绪一致性硬闸
│   ├── matcher.mjs         # 语义匹配
│   ├── decision.mjs        # 形态决策
│   ├── ratelimit.mjs       # 安全判断与拟人延迟
│   ├── engine.mjs          # 编排引擎
│   ├── mcp-client.mjs      # 底座 MCP 客户端 + Fake 通道
│   └── util.mjs            # 公共工具
├── sources/
│   ├── web-search.mjs      # 来源①
│   ├── derive.mjs          # 来源②
│   ├── caption_helper.py   # 二创加字（Pillow）
│   ├── doubao-driver.mjs   # 来源③
│   └── owner-drop.mjs      # 来源④
└── tests/                  # node:test 用例
```

## 已知限制（需真机配合）

1. **豆包原创生图需先登录**：豆包桌面版无官方本地 API，走 Windows UI 自动化，`doubao-driver.mjs` 中标注 `CALIBRATE` 的元素定位需在登录后的真实界面校准
2. **视觉审核**：当前内置名称黑名单，图片内容级审核需外部能力或人工在设置页处理
3. 无真机登录态时，发送动作以 dry-run 验证，真机效果需上线后核对

## License

MIT
