# PromptPlaza Basic Skill

免费的图片、视频提示词助手，当前版本 `0.1.0-beta.5`。用你现有的 Agent 检索参考、读取有权复制的原文，或写出一份完整提示词。软件采用 Apache-2.0 许可。

免费功能：

- 检索 PromptPlaza 案例，返回真实官网链接和独立的外部来源链接。
- 读取、下载当前公开且允许复制的完整原文；缺失、片段、翻译或受限内容不会补写成原文。
- 根据你的要求逐问澄清，一次只问一个关键问题，已有信息不重复询问。
- 使用自己的原稿或一条授权案例做基础改写，交付完整提示词。

文字创作由你的 Agent 完成，其订阅或模型额度与本 Skill 分开。此包不包含图片/视频生成额度，不调用私有二创引擎；高级二创、批量任务和多案例融合尚未开放。

## 安装到 Codex 项目

在项目根目录执行；目标目录已存在时先按下方升级说明处理：

```bash
git clone --depth 1 --branch v0.1.0-beta.5 https://github.com/kamanager2012/promptplaza-basic-skill.git .agents/skills/promptplaza-basic
```

也可把发行ZIP内的九个文件解压到 `.agents/skills/promptplaza-basic/`，确保 `SKILL.md` 直接位于该目录。重新打开一个 Codex 会话后，用 `$promptplaza-basic` 显式调用。

示例：`请使用 $promptplaza-basic，为我的蓝色陶瓷杯写一条10秒产品视频提示词，光线从左向右掠过，镜头缓慢推近后停稳。只写文字，不生成视频。`

直接提供原稿或创作需求时无需 Node。使用案例检索、读取和下载命令需要 Node.js 22 或更新版本，没有 npm 依赖，无需安装模型 SDK 或配置供应商密钥。

基础改写与逐问由 Agent 完成，CLI 没有 `rewrite` 或 `grillme` 子命令，也不能直接访问私有 Recipe 算法。

Claude Code 的项目目录为 `.claude/skills/promptplaza-basic/`。本版本仅核对该布局的文件身份，未实际验证 Claude 引擎；已验证范围是 Codex 的显式调用。自然触发、其他宿主和云端会话不作通用支持保证。

## 已安装命令

以下命令路径从项目根目录书写；在其他位置使用脚本的绝对路径，保持当前工作目录：

```bash
node .agents/skills/promptplaza-basic/scripts/plaza-basic.mjs search "产品广告" --kind image --limit 3
node .agents/skills/promptplaza-basic/scripts/plaza-basic.mjs get CASE_ID
node .agents/skills/promptplaza-basic/scripts/plaza-basic.mjs download CASE_ID --output /absolute/private/new-prompt.txt
```

下载目录须已存在，目标文件须是新文件，位于当前工作目录及安装目录之外。已有文件会被拒绝，不会覆盖。下载只保存原文，不保存任何生成图片或视频。`CASE_ID` 使用实际搜索结果，不是示例占位值。

公开检索无需注册。完整原文取决于当前发布状态、复制许可与服务规则；请求限制仍适用。已有合法宿主会话可通过执行环境的 `PROMPTPLAZA_TOKEN` 使用，不要向聊天、issue或截图粘贴token，也不要提取浏览器凭据。

## 原文、草稿与错误恢复

新写或改写的图片/视频提示词会在可复制文本之外标注 `DRAFT_NOT_RUN`，说明它只是文字草稿，尚未生成或验证效果。取回和下载的原文保持原有字节，不会加入这个状态或改称 Agent 原创。

有权读取或复制不等于有权再发布。原文、作者作品和媒体保留各自权利；`NOASSERTION` 表示没有确认再发布或商用许可。不要自动提交或转载下载的案例正文。

找不到结果时可放宽一个条件；原文缺失或受限时打开返回的官网链接，或提供自己有权使用的文本。会话失效、限流、超时和服务错误会给出下一步，重试由你决定，不会自动反复请求或调用收费功能。

## 升级与移除

升级前保留自己的改动，检查版本差异，再用新发行包完整替换这个 Skill 目录；不要把案例原文或个人文件放进安装目录。重新打开宿主会话。Git安装可先fetch新tag，确认本地无改动后切换到该tag。

移除时仅删除你安装的 `.agents/skills/promptplaza-basic/`（或对应Claude目录），再重开会话。不会删除独立下载的原文文件，也不需要退出网站账号。备份或处理安装目录中的个人改动后再移除。

## 验证范围与许可

本版已验证九文件导出、客户端38项合成回归、实际Codex发现、指定视频任务和两轮逐问文字交付。原文接口的匿名读取/下载曾用字节相同的beta.4 CLI做过单案例现场验证；不能据此保证每个案例都可复制。真实会话新端点、自然触发、Claude执行及媒体质量仍未验证。

在此目录运行 `npm test` 可执行离线客户端测试。测试使用合成数据，不生成媒体。

Apache-2.0仅覆盖本仓库软件和说明，见 [LICENSE](LICENSE)、[NOTICE](NOTICE) 与 [THIRD-PARTY.md](THIRD-PARTY.md)。API数据、原文和作品不包含在此授权中。
