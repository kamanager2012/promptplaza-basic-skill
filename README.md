# PromptPlaza Basic Skill

**在你的 Agent 中寻找图片与视频参考，写出完整提示词。**

免费的开源 Skill，连接 [PromptPlaza 案例库](https://www.promptplaza.cn/)，支持参考检索、授权原文取用、逐问澄清和单案例基础改写。文字创作由你现有的 Agent 完成。

[开始安装](#快速开始) · [使用指南](https://github.com/kamanager2012/promptplaza-basic-skill/blob/main/docs/usage.md) · [兼容与验证范围](https://github.com/kamanager2012/promptplaza-basic-skill/blob/main/docs/compatibility.md) · [版本记录](https://github.com/kamanager2012/promptplaza-basic-skill/blob/main/CHANGELOG.md)

当前免费预览版：[**0.1.0-beta.7**](https://github.com/kamanager2012/promptplaza-basic-skill/releases/tag/v0.1.0-beta.7) · **Apache-2.0** · CLI 需要 **Node.js 22+** · **无 npm 依赖**

## 你可以用它做什么

| 你的任务 | Basic 的交付 |
| --- | --- |
| 找图片或视频创作参考 | 案例摘要、真实官网链接，以及可用的作者、时长等信息 |
| 取用一条案例提示词 | 当前允许复制的完整原文；也可明确要求保存为新的本地文本文件 |
| 把模糊想法写清楚 | 使用已知信息，必要时一次问一个关键问题，再给出完整提示词 |
| 把一个案例改成自己的需求 | 使用你提供的原稿或一条授权案例，说明保留与修改内容，交付完整改写稿 |

公开检索无需注册。完整原文是否可用，取决于该案例的发布、复制权限和服务规则。原文不可用时，Skill 会说明原因、给出官网链接，或根据你自己的需求另写草稿。

**费用与范围**：Skill 免费；你的 Agent 订阅或模型用量另计。Basic 交付文字，不包含图片/视频生成额度。高级服务端二创、多案例融合和批量任务尚未开放。

## 快速开始

### 1. 安装到 Codex 项目

在项目根目录执行。目标目录已经存在时，先阅读下方升级说明，不要覆盖个人改动。

```bash
git clone --depth 1 --branch v0.1.0-beta.7 https://github.com/kamanager2012/promptplaza-basic-skill.git .agents/skills/promptplaza-basic
```

也可下载 [beta.7 发行 ZIP](https://github.com/kamanager2012/promptplaza-basic-skill/releases/download/v0.1.0-beta.7/promptplaza-basic-0.1.0-beta.7.zip)，把其中九个文件解压到 `.agents/skills/promptplaza-basic/`，确保 `SKILL.md` 直接位于该目录。

### 2. 检查安装

使用案例检索、读取和下载命令时，先确认 Node.js 为 22 或更新版本，再运行无需联网的自检：

```bash
node --version
node .agents/skills/promptplaza-basic/scripts/plaza-basic.mjs help
```

成功时输出 JSON，列出 `search`、`get`、`download`，并显示 `generation_calls: 0`。不需要执行 `npm install`，也不需要模型供应商密钥。只用自己的原稿进行文字创作时无需 Node。

### 3. 完成第一次创作

重新打开一个 Codex 会话，显式调用：

```text
请使用 $promptplaza-basic，为蓝色陶瓷杯写一条10秒产品视频提示词。
杯子保持静止，光线从左向右掠过，镜头缓慢推近后停稳。
不要文字和商标。只交付完整文字提示词，不生成视频。
```

期望得到一份可复制的完整提示词；如有必要，只补问影响结果的信息。新写或改写稿会在正文外标注 `DRAFT_NOT_RUN`，说明尚未生成媒体或验证效果。这个示例是使用方法，不是当前版本的新一轮模型验收。

Claude Code 的项目布局为 `.claude/skills/promptplaza-basic/`；目前仅检查过文件布局，尚未验证 Claude 执行。beta.7 已验证 Codex 安装与元数据发现；当前版本的模型行为、自然触发和其他宿主仍有未验证项，详见[兼容与验证范围](https://github.com/kamanager2012/promptplaza-basic-skill/blob/main/docs/compatibility.md)。

## 三种常用方式

以下均为合成使用示例，不包含第三方案例正文，也不表示媒体效果已复现。

**寻找参考**

```text
使用 $promptplaza-basic，找3条极简产品海报参考。
给我官网链接和可借鉴的构图特点，先不要改写。
```

**从自己的需求开始**

```text
使用 $promptplaza-basic，为一款白色无标识运动鞋写一条图片提示词。
米灰背景，侧面构图，柔和接触阴影，不加文字。直接给我完整稿。
```

**只修改指定内容**

```text
使用 $promptplaza-basic，改写我下面提供的完整提示词。
保持主体、构图和色彩，只把室内背景改成阴天户外。不要增加人物。
先给完整改写稿，再简要说明保留与修改了什么。
[在这里粘贴你有权使用的原稿]
```

Agent 完成逐问和改写；CLI 提供 `search`、`get`、`download` 三个命令。命令参数、原文下载与常见错误见[使用指南](https://github.com/kamanager2012/promptplaza-basic-skill/blob/main/docs/usage.md)。

## 数据与许可

- 文字创作在你的 Agent 宿主完成；案例查询通过 HTTPS 请求 PromptPlaza。CLI 不上传素材，不调用生成模型或私有二创引擎。
- 下载只保存当前允许复制的完整原文；片段、翻译、受限或缺失内容不会被补写成“原文”。已有文件不会被覆盖。
- 原文和作品保留各自权利。可读取、可复制不等于获得商用或再发布许可；`NOASSERTION` 表示许可未确认。
- 合法会话只通过已有宿主的执行环境使用。不要在聊天、Issue、截图或仓库中粘贴 token，也不要提取浏览器凭据。

Apache-2.0 覆盖本仓库软件与说明，见 [LICENSE](LICENSE)、[NOTICE](NOTICE) 和 [THIRD-PARTY.md](THIRD-PARTY.md)；不覆盖 API 数据、第三方原文或媒体。

## 升级与移除

先查看[版本记录](https://github.com/kamanager2012/promptplaza-basic-skill/blob/main/CHANGELOG.md)，保留本地改动，再用新发行包完整替换安装目录。Git 安装可在确认工作树无改动后 fetch 并切换到目标 tag。重新打开宿主会话。不要把案例原文或个人文件放进安装目录。

移除时仅处理你安装的 `.agents/skills/promptplaza-basic/`（或对应 Claude 目录），先备份其中的个人改动，再删除该目录并重开会话。独立下载的文件需另行管理。

版本安装固定到 tag。仓库 `main` 可更新文档和维护工具；已发布的 tag 与 ZIP 保持不变。

## 仓库结构与参与

```text
SKILL.md                  Agent 使用入口
scripts/plaza-basic.mjs    无依赖、只读案例 CLI
tests/basic.test.mjs       合成客户端回归
docs/                     使用指南与兼容证据
.github/                  持续检查、Issue 与 PR 模板
tools/                    仓库及安装文件检查
```

安装 ZIP 只包含九个运行、测试及许可说明文件；仓库维护文档和 CI 不进入 ZIP。`package.json` 的 `private: true` 用来防止误发 npm 包，不代表这个 GitHub 仓库私有。

[报告问题](https://github.com/kamanager2012/promptplaza-basic-skill/issues/new/choose) · [贡献指南](https://github.com/kamanager2012/promptplaza-basic-skill/blob/main/CONTRIBUTING.md) · [安全报告](https://github.com/kamanager2012/promptplaza-basic-skill/blob/main/SECURITY.md)
