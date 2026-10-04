# 维护交接

## 先做什么

先读 README、ARCHITECTURE、STATUS 和 RESEARCH。当前目标是维护五类可靠提醒。不要先扩展声音上传、通知中心或系统托盘。

主要实现只有五个源码文件。`core.js` 不接触 I/O。修改兼容接口时，优先限制在 `index.js` 和 `client.js`。

## 恢复完整仓库

公开仓库是主要来源：

```bash
git clone https://github.com/HOPE-LGNF/dsh-state-notifier.git
cd dsh-state-notifier
git log --oneline --decorate
npm ci
npm run check
```

需要离线交接包时，在干净工作树运行 `node scripts/export.mjs`。它生成 `artifacts/dsh-state-notifier-<版本>.bundle` 与同名 `.sha256`，并克隆恢复比对 HEAD。先校验 SHA-256，再恢复：

```bash
git clone artifacts/dsh-state-notifier-0.3.0.bundle dsh-state-notifier
cd dsh-state-notifier
git fsck --full
npm ci
npm run check
```

仓库自带的 `LICENSE` 是 MIT。`v0.3.0` 由维护者 `HOPE-LGNF` 创建；公开远端、名称、许可与署名由该维护者确认。

## 日常验证

```bash
npm ci
npm run check
npm pack --dry-run
```

检查使用 Node 内置测试框架。`npm test` 走 `scripts/test.mjs`，按当前 Node 支持的拼写选择隔离选项：Node 24 是 `--test-isolation=none`，Node 22 是 `--experimental-test-isolation=none`，两者都没有时退回默认隔离。该选项让受管环境直接报告全部子用例，避免只报告文件级成功。测试不读取真实会话，也不调用模型。手动单跑某个文件时，请用上面列出的旧拼写前先确认自己的 Node 版本。

检查官方新 Git 快照：

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git /path/to/deepseek-harness
git -C /path/to/deepseek-harness rev-parse HEAD
node scripts/check-upstream.mjs /path/to/deepseek-harness
```

该命令构建并替换上游 Session 实现。其他依赖仍来自本项目锁文件。它验证真实事件提交和插件监听；它不是完整上游应用测试。还要核对 `connection.fetch.register`、`connection.rpc.call`、两个 UI 插槽和 `uiWorkspace.openSession` 的契约。`connection.rpc.handle` 对晚加载的插件不可用，原因见 [调研](RESEARCH.md)。

浏览器检查见 [VALIDATION-browser.md](VALIDATION-browser.md)。脚本使用已安装的 Playwright。它不增加插件运行依赖。完整 Web 验收用 `scripts/web-acceptance.mjs`，准备步骤见 [状态与验收](STATUS.md)。

## 完整 dsh 验收

使用隔离的 `DSH_HOME`。不要借用日常 profile、凭据或历史会话。

1. 运行 `npm pack`。
2. 用目标 dsh 的 `plugin --profile web add` 安装本地 tgz。
3. 启动 `dsh web --no-open`，打开输出的本机 URL。
4. 确认“常规”设置和会话头部铃铛都出现。
5. 解锁声音，授权系统通知，分别触发五类事件。
6. 取消一个回合，再运行一个空回合。两者都不得显示“任务完成”。
7. 打开第二个标签页。同一事件只应由同源浏览器输出一次。
8. 关闭开关，再重新打开。下一条新事件必须恢复输出。
9. 断开连接后重连，检查同实例补发。重启宿主，检查重置提示。
10. 卸载并重新安装插件。检查没有多余请求、重复监听或继续播放。

Windows 人工验收还要检查通知中心、系统免打扰和实际声音。浏览器构造 Notification 成功不能代替这些步骤。

## 版本与发布

版本号只在 `package.json` 维护，并与锁文件同步。不要把版本写进 patch 注释或多处源码常量。

- 提交对应一个清楚的意图，使用 Conventional Commits 前缀。
- 用户可感知变化进入 CHANGELOG 的“未发布”。不要抄整份 Git log。
- `0.x` 阶段，兼容修复升 PATCH；新增功能或有意改变配置升 MINOR，并说明迁移。
- 发布前检查 diff、运行验证、确定 SemVer，再更新 CHANGELOG。
- tag 为 `vX.Y.Z`。使用 annotated tag。已发布 tag 永不移动。
- GitHub Release 使用同一个 tag，正文取自 CHANGELOG 对应版本。
- 当前状态：`main`、annotated tag `v0.3.0` 与 GitHub Release `v0.3.0` 已推送到公开仓库；npm 发布见其 Release 说明。`v0.1.0` 只存在于本地，未推送：它指向的交接快照仍在用已修复的 `connection.rpc.handle`。

后续发布示例：

```bash
npm version 0.2.1 --no-git-tag-version
# 编辑 CHANGELOG，运行检查并检查差异。
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore(release): v0.2.1"
git tag -a v0.2.1 -m "v0.2.1"
git push
git push origin v0.2.1
```

推送、npm 发布和 GitHub Release 由维护者明确执行。当前无需 semantic-release 或 Changesets。

## 再次导出

在正常 Git 工作树中提交全部改动，然后运行：

```bash
node scripts/export.mjs
```

脚本生成 bundle 和校验文件，再克隆恢复并比对 HEAD。它不会发布到网络。
