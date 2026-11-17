# 变更日志

## [0.2.0-beta.3] — 2026-11-17

- 明确显示运营已恢复中断请求、预占已释放的状态；原请求保持终态，不自动换键或重跑。
- 保留beta.2的搜索恢复键、严格结果与额度校验、Windows会话保护。
- 恢复工具、数据库及核心算法继续私有；功能和免费10/50额度保持。

## [0.2.0-beta.2] — 2026-11-17

- 原生 Windows 会话改用 DPAPI CurrentUser 加密，保持 POSIX 权限校验；无明文回退。
- 发行清单改名 SKILL-MANIFEST.json，消除与 package.json 在大小写不敏感文件系统上的覆盖。
- 计量搜索必须显式保留稳定请求ID，翻页与回执绑定原键；额度拒绝 used+reserved 超限。
- 十操作按业务结构、文本摘要及引用关系校验返回值；畸形结果不再报告成功。
- 本版不增加能力，核心继续私有；宿主行为和媒体质量不由客户端回归代替。
- CI 从同一提交生成九文件 ZIP，读回逐字核对、干净安装复验，并保留 SHA256SUMS 与 build.json；构建记录不是加密签名或完整生产级验收。



## [0.2.0-beta.1] — 2026-11-17

- Unified full creative client, existing-account terminal login/logout and private session storage.
- Free account10creative/50search daily; same features, membership reserved.
- Metered search with bounded free continuation and request recovery. Proprietary core remains server-side; no media generation included.

## [0.1.0-beta.8](https://github.com/kamanager2012/promptplaza-basic-skill/releases/tag/v0.1.0-beta.8) — 2026-11-14

- 匿名远程请求也固定到官方 HTTPS API，拒绝第三方自报原文及非标准端口；本地调试仍可显式使用 loopback。
- 缺失或非数组的搜索结果字段返回明确协议错误，保留检索条件，不再误报为正常空结果。
- 增加两项离线回归，合计 45 项；更新使用指引及 beta.7 正式匿名检索/原文/下载的证据边界。
- 创作指令、免费范围与原文权限不变；保留旧 beta.7 tag/ZIP。当前宿主模型行为与媒体仍未验。

## 仓库文档更新 — 2026-11-14

- 重整首页定位、固定版本安装、自检和三类使用示例。
- 补齐使用/错误恢复、按版本区分的兼容证据、贡献与私密安全报告入口。
- 增加公开仓库离线检查、Issue/PR 模板和显式仓库文件清单。
- 根据真实 GitHub 页面复验，修正费用段落的 Markdown 强调显示。
- beta.7 运行代码与 Skill 指令不变；未创建新版本、重写旧 tag 或替换发行 ZIP。

## [0.1.0-beta.7](https://github.com/kamanager2012/promptplaza-basic-skill/releases/tag/v0.1.0-beta.7) — 2026-11-13

下载路径失败后的恢复提示同时说明当前工作目录（含子目录）与 Skill 安装目录的限制。路径保护、原文权限和请求行为不变。

## [0.1.0-beta.6](https://github.com/kamanager2012/promptplaza-basic-skill/releases/tag/v0.1.0-beta.6) — 2026-11-13

增加可用作者、时长和模型证据信息，以及 `--author`、`--duration` 筛选。缺失信息保持未知，不推断系列或模型效果。

## [0.1.0-beta.5](https://github.com/kamanager2012/promptplaza-basic-skill/releases/tag/v0.1.0-beta.5) — 2026-11-13

首次在独立公开仓库发行免费 Basic。支持案例检索、授权原文读取/下载、宿主逐问与基础单案例改写；新写或改写稿在正文之外标注 `DRAFT_NOT_RUN`。

不同版本的实际验证范围见[兼容说明](docs/compatibility.md)。软件/说明许可不授予第三方案例和媒体的使用权。
