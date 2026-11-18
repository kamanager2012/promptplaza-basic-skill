# PromptPlaza Skill

把你的想法、已有提示词和授权参考，整理成完整的图片或视频提示词，继续做多案例二创、系列设计、逐问补全和指定镜头修订。搜索用于寻找参考，二创是核心。

开源客户端 **0.2.0-beta.4**；核心二创算法在 PromptPlaza 私有服务运行。无需 npm 依赖，需要 Node.js22+。

## 安装与登录

需要 Node.js 22+。本版 beta.4 的安装命令固定到版本 tag；旧版 beta.3 / beta.2 / beta.1 的 tag 和 ZIP 保留。升级请安装到新目录，确认成功后再替换旧安装。

Linux / macOS（macOS 原生验收尚未完成）：

```bash
skill_path="$HOME/.agents/skills/promptplaza-basic"
git clone --branch v0.2.0-beta.4 --depth 1 https://github.com/kamanager2012/promptplaza-basic-skill.git "$skill_path"
node "$skill_path/scripts/plaza-basic.mjs" help
node "$skill_path/scripts/plaza-basic.mjs" login
```

Windows PowerShell：

```powershell
$skillPath = Join-Path $env:USERPROFILE '.agents\skills\promptplaza-basic'
git clone --branch v0.2.0-beta.4 --depth 1 https://github.com/kamanager2012/promptplaza-basic-skill.git $skillPath
node "$skillPath\scripts\plaza-basic.mjs" help
node "$skillPath\scripts\plaza-basic.mjs" login
```

若目录已存在，先保留本地改动，再按宿主的升级方式操作；不要覆盖安装。最后一条请在自己的终端执行。使用网站账号，密码输入隐藏，只发送到官方登录接口，不保存。不要把密码或会话发给聊天助手。会话位于 `~/.local/state/promptplaza/session.json`：Linux/macOS 使用目录0700、文件0600；原生 Windows 使用系统自带 Windows PowerShell 的 DPAPI CurrentUser 加密后保存，无法加密就拒绝保存，不回退到明文。登录可能轮换网站会话，浏览器需要时重新登录。首次注册请使用网站正常入口。

将 `SKILL.md` 所在目录安装到宿主支持的 Skill 目录；见[使用指南](https://github.com/kamanager2012/promptplaza-basic-skill/blob/main/docs/usage.md)。也可下载 GitHub Release 的九文件 ZIP。旧版 [beta.8](https://github.com/kamanager2012/promptplaza-basic-skill/releases/tag/v0.1.0-beta.8) 保留，仅有原搜索、原文、下载命令。

## 功能

| 能力 | 操作 |
| --- | --- |
| 图片提示词、商品/角色系列、海报 | `creative compile` |
| 视频完整稿、镜头时间与保持条件 | `creative compile`，视频 pack |
| 多来源二创、保持/替换/融合 | `creative remix` |
| 指定镜头修改，保留其余内容 | `creative revise` / `remix-revise` |
| 逐问确认，保留已确认内容 | 三个 `interview-*` 操作 |
| 当前允许提供的本站二创方向 | `creative case-ideas` |
| 原创配方与变化路线 | `recipe-catalog` / `recipe-compile` |
| 案例搜索、原文校验、保存文本 | `search` / `get` / `download` |
| 额度、预占、请求恢复 | `usage` / `status` |

交付是文字草稿，不生成图片或视频，也不证明效果已复现。`capabilities` 返回服务的实际能力；失败不会伪装成已完成。`SKILL.md` 包含输入协议，宿主把自然语言整理为请求。

## 额度与恢复

免费首发：**每账号每天创作10次、搜索50次**，上海时间零点重置。免费和会员功能相同；会员额度预留，当前不收费、不出售。网页匿名浏览保持原样。

成功编译、修订、二创或配方编译计一次创作。逐问步骤、方向读取、配方目录、额度/状态查询不扣创作次数。新的有效搜索计一次，空结果也计次。提交前必须显式提供并保留 `--request-id`；重试原命令和翻页沿用原键，不自动生成新的扣次键。每次搜索最多5页，每页最多20条，1小时内通过返回游标翻页，不重复扣搜索次数。切换条件是新搜索。

确定失败释放预占；PENDING/UNKNOWN 保留原键与输入，先查状态，不自动重派、不自行换键。若运营完成中断恢复，状态会明确标记预占已释放；原键仍为失败，只有用户明确选择后才新建任务。

```bash
node scripts/plaza-basic.mjs capabilities
node scripts/plaza-basic.mjs usage
node scripts/plaza-basic.mjs search "product poster" --kind image --limit 3 --request-id search-product-00000001
node scripts/plaza-basic.mjs search --cursor RETURNED_CURSOR --request-id search-product-00000001
node scripts/plaza-basic.mjs get RETURNED_CASE_ID
node scripts/plaza-basic.mjs creative compile --input - --request-id task-user-draft-0001 < /private/input.json
node scripts/plaza-basic.mjs status task-user-draft-0001
node scripts/plaza-basic.mjs logout
```

`download CASE_ID --output /absolute/private/new-file.txt` 只写新文件，拒绝覆盖和写入当前项目/Skill。POSIX 新文件权限0600；Windows 文件继承父目录 ACL，请选择自己的私有目录。原文必须来自当前公开复制接口，通过 UTF-8字节数与SHA-256校验；节选、翻译和标签不会冒充原文。`NOASSERTION` 表示许可未确认，收录、复制、转载、商用需要分别判断。

软件采用 [Apache-2.0](LICENSE)，署名见 [NOTICE](NOTICE)，内容边界见 [THIRD-PARTY.md](THIRD-PARTY.md)。私有核心、来源提示词、媒体和密钥不在开源包中。
