# 使用指南

[返回首页](../README.md) · [兼容与验证范围](compatibility.md)

## 登录与创作

统一客户端0.2.0-beta.1。让 Agent 使用 `$promptplaza-basic` 完成图片/视频提示词、逐问、多案例二创和指定镜头修订。完整协议见 [SKILL.md](../SKILL.md)；私有核心在服务器，生成媒体另行操作。

请在自己的终端运行 `node /absolute/path/scripts/plaza-basic.mjs login`，使用网站账号，密码输入隐藏。密码不保存，会话单独保存在 `~/.local/state/promptplaza/session.json`（目录0700/文件0600）；不要发送密码或token到聊天。`logout` 删除本机会话并报告服务端撤销结果。

免费账号每天创作10次、搜索50次，上海时间零点恢复。会员暂不开收费，功能相同。网页匿名浏览保持原样。`usage` 查看当前额度，`status REQUEST_ID` 查询自己的任务；PENDING/UNKNOWN 不换键重试。

## 检索参考

```bash
node .agents/skills/promptplaza-basic/scripts/plaza-basic.mjs search "产品广告" --kind image --limit 3
```

一次返回一页，`--limit` 为 1–20。可用过滤项包括 `--kind`、`--model`、`--category`、`--aspect`、`--style`、`--author`、`--duration`；使用真实目录值。返回的 `case_url` 是官网详情链接，`source_url` 是外部来源，二者用途不同。

按作者查询时可省略主题，也可组合主题、类型和时长：

```bash
node .agents/skills/promptplaza-basic/scripts/plaza-basic.mjs search --author ACTUAL_RETURNED_HANDLE --limit 3
node .agents/skills/promptplaza-basic/scripts/plaza-basic.mjs search "product" --kind video --author ACTUAL_RETURNED_HANDLE --duration 16-30 --limit 3
```

把 `ACTUAL_RETURNED_HANDLE` 换成搜索结果中的真实 `author_handle`。时长使用结果中 `search_tags.duration` 的分类 ID；`16-30` 是示例，不是任意秒数表达式。缺失作者、时长、参考素材需求时保持未知。作者相同不表示属于同一系列；模型标签不表示本 Skill 或 Plaza 已复现该效果。

## 读取与保存原文

把 `CASE_ID` 换成搜索结果中的实际 ID：

```bash
node .agents/skills/promptplaza-basic/scripts/plaza-basic.mjs get CASE_ID
node .agents/skills/promptplaza-basic/scripts/plaza-basic.mjs download CASE_ID --output /absolute/private/new-prompt.txt
```

下载前选好一个已存在的私有目录和一个尚不存在的绝对文件路径。目标必须位于**当前工作目录及其子目录之外，同时位于 Skill 安装目录之外**。`/absolute/private/new-prompt.txt` 是路径占位示例，须换成你自己的位置。CLI 不自动创建目录、不覆盖现有文件；成功创建的文本文件权限为 0600。

完整原文来自 `/v1/cases/:id/prompt`，需要匹配的案例 ID、完整状态、复制许可、SHA-256 和 UTF-8 字节数。校验只验证返回内容的完整性，不证明作者身份或再发布权利。原文保持原有字节，不加入草稿标记。

本版客户端的搜索和二创使用网站账号，官网匿名浏览保持原样。已有合法宿主会话可通过执行环境中的 `PROMPTPLAZA_TOKEN` 使用；会话不保证原文可访问。不要把 token 直接写入命令历史、文档、Issue 或聊天，不要从浏览器提取会话。默认 API 为 `https://www.promptplaza.cn`，不要把凭据转发到其他服务。

远程 API 仅接受 `https://www.promptplaza.cn` 和 `https://promptplaza.cn`，匿名请求也遵守此限制；其他主机和非标准端口会在发请求前拒绝。Loopback 地址仅用于你明确配置的本地调试，不是官方来源或生产接口的验证证据。

## 识别交付状态

| 输出 | 如何理解 |
| --- | --- |
| 搜索摘要 | 用于选择参考，不是完整原文 |
| 授权原文 | 当前接口允许读取/复制的原始文本，作品权利另行判断 |
| 新写或改写稿 | Agent 写出的新文字，正文外带 `DRAFT_NOT_RUN` |
| `DRAFT_NOT_RUN` | 尚未生成图片或视频，也未验证视觉效果 |

如果原文受限、缺失或只有节选，Agent 应说明限制并提供真实官网链接。你可以提供自己的文本，或让它根据你的创作需求另写草稿；另写稿不归属于未读取的案例作者。

## 常见问题与恢复

| 情况 | 下一步 |
| --- | --- |
| Codex 找不到 Skill | 检查 `SKILL.md` 是否直接位于 `.agents/skills/promptplaza-basic/`，重开会话并显式调用；这不等于自然触发已获保证 |
| Node 版本不足或找不到 `node` | 安装 Node.js 22+，重开终端并运行 `node --version`；自己的文字原稿仍可直接交给 Agent |
| 搜索为空 | 放宽一个条件或换一个主题；不要自动连续翻页采集 |
| `API_SEARCH_CONTRACT_INVALID` | 服务返回格式异常，不能当成没有匹配；保留搜索条件，稍后手动重试 |
| `UNTRUSTED_API_ORIGIN` | 移除非官方 API 配置，恢复官方 HTTPS 地址；不会向被拒绝主机发请求 |
| 401 / 403、原文不可用 | 检查已有合法会话，或打开官网案例、使用自己的文本；不要绕过访问限制 |
| 404 | 案例或接口暂不可用，可换案例或用自己的原稿；旧元数据接口不能解锁原文 |
| 429 | 稍后由你手动重试，不循环请求 |
| 超时、连接或 5xx 错误 | 保留原需求，稍后手动重试，或先用自己的需求完成文字稿 |
| 下载路径被拒绝 | 选择当前工作目录、其子目录和安装目录之外的新文件；父目录必须存在 |
| 目标文件已存在 | 换新文件名；原文件保持不变 |

CLI 成功退出码为 0；失败为 2，并在标准错误输出保留机器错误码、`message`、`next_step` 和 `retryable`。不要把失败当作自动切换收费服务、补写受限原文或上传素材的授权。

需要反馈时，请提供版本、Node/宿主信息、脱敏后的触发步骤和错误码。参见[贡献指南](../CONTRIBUTING.md)；安全问题使用[私密报告入口](../SECURITY.md)。

新搜索使用计量接口；用返回的 `next_cursor` 翻页，最多5页/1小时，不再扣搜索次数。非零offset已不支持。查询条件改变时使用新的请求键。
