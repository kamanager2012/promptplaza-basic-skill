# 参与改进

欢迎报告安装问题、提供可复现的客户端缺陷，或改进文档和交互说明。此仓库是免费 Basic 的公开发行与反馈入口，维护者会将审查通过的变更回纳作者源，再导出一致的公开文件。

## 提交问题

先查看[使用指南](docs/usage.md)和已有 Issue，再通过 [Issue 模板](https://github.com/kamanager2012/promptplaza-basic-skill/issues/new/choose)填写版本、宿主/Node 信息、最少触发步骤、预期结果和实际错误码。

用自己编写的合成文本复现。不要提交 token、密码、邮箱验证码、个人会话、未获授权的案例正文或媒体。安全漏洞请使用[私密报告方式](SECURITY.md)，不要在公开 Issue 中展示可利用细节。

## 提交代码或文档

1. 从当前 `main` 建立独立分支，一次处理一个明确问题。
2. 保持 `SKILL.md` 和 CLI 的安装路径兼容；注明对现有用户的影响。
3. 说明改动原因、触发步骤和实际验证结果，标明没有运行的检查。
4. 通过 PR 提交。维护者完成审查与作者源同步后再合入，不直接更改已发布 tag 或 ZIP。

只贡献你有权授权的原创代码、合成示例与说明；贡献按仓库 Apache-2.0 许可提供。不要复制私有实现、真实案例提示词、作者作品或外部媒体。第三方数据与素材不属于本仓库软件许可。

## 本地检查

需要 Node.js 22+、Python 3.10+。在仓库根目录运行：

```bash
python3 tools/check-repository.py
python3 tools/check-repository.py --smoke
```

第一条核对文件边界、链接和元数据；第二条串行运行合成客户端回归，再从九文件干净安装中执行 `help`。检查无 npm 依赖，不访问 Plaza、模型或媒体服务。Linux 下要求至少 1536MiB 可用内存，单个子命令最多 45 秒，Node heap128MiB；临时文件只在检查器自有 `.runtime/` 子目录中生成并清理。

不要运行压力、批量采集、真实模型生成或付费测试来证明一个小改动。合成检查通过不等于线上权限、宿主行为或媒体效果通过。

## 目录与发行规则

九文件安装包为 `LICENSE`、`NOTICE`、`README.md`、`SKILL.md`、`THIRD-PARTY.md`、`PACKAGE.json`、`package.json`、`scripts/plaza-basic.mjs`、`tests/basic.test.mjs`。仓库文档、维护工具和 CI 独立维护，不进入安装 ZIP。

`package.json` 保留 `private: true`，避免误发 npm。维护者发布新版本前会核对软件许可、文件清单、安装与限定回归；涉及新的宿主行为时另行验证。文档更新不会改写已经公开的版本历史，也不能将历史证据升级成当前版本的保证。
