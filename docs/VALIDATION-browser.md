# 浏览器提醒验证

运行生命周期与故障单元检查：

```bash
npm test                      # 全部测试；Node 22 用 --experimental-test-isolation=none
node --test --test-isolation=none test/browser.test.js   # Node 24 单跑该文件
```

运行真实 Chromium 夹具（需要机器已有 Playwright 与 Chrome，无需给插件增加开发依赖）：

```bash
PLAYWRIGHT_MODULE="$HOME/path/to/playwright/index.js" node scripts/browser-smoke.mjs
```

在批准 `node --test` 的受限执行环境中，也可使用同一脚本的测试入口。注意 Node 22 的隔离选项名是 `--experimental-test-isolation=none`：

```bash
PLAYWRIGHT_MODULE="$HOME/path/to/playwright/index.js" node --test --experimental-test-isolation=none scripts/browser-smoke.mjs
```

如项目外的 Node 环境能直接解析 `playwright`，可省略变量。`PLAYWRIGHT_CHANNEL` 默认为 `chrome`，也可以设为已安装的 `msedge`。

脚本使用全新临时浏览器上下文和 `src/browser.js`，通过 Playwright 请求拦截在内存中提供 localhost 夹具，无需监听端口，结束后关闭浏览器。它验证实际点击后 AudioContext 解锁、五类提醒均有正例、原生 Notification 构造、两个标签页通过 Web Locks 去重、storage 事件同步设置、重新启用和卸载行为。单元检查另外覆盖发送失败不记成功、异步通知错误撤销记录、迟到权限与音频 Promise、通知与记录数量上限、串行长轮询和立即取消。

2026-10-03 本地 Linux Headless Chrome 151.0.7922.173 已通过该脚本，五类均产生声音节点和原生通知构造，两个标签页的同事件仅构造一次通知，最终成功记录 7 条。该次使用 `node --test --test-isolation=none` 入口和临时环境加载模块指定已安装的 Playwright。普通 Node 入口在该受限环境中被 Chromium socket 权限拦截；这属于执行环境限制。

通知权限由测试上下文显式授予；脚本不会自动确认真实权限弹窗。该检查证明浏览器 API 接受输出，不能证明 Windows 系统实际显示通知或扬声器可听。Windows 接收端仍需手动点击启用声音与允许桌面通知，检查五类提醒、通知点击会话切换和窗口前后台行为。

## 完整 dsh Web 验收

连接一个已安装本插件的真实 dsh Web 实例，检查官方插槽、认证边界与真实宿主事件的投递：

```bash
DSH_ACCEPT_TURN=1 \
DSH_WEB_URL="http://127.0.0.1:7712/?token=…" \
DSH_ACCEPT_WORKSPACE="$HOME/.dsh-notifier-acceptance/acceptance-workspace" \
PLAYWRIGHT_MODULE="$HOME/path/to/playwright/index.js" \
node scripts/web-acceptance.mjs
```

准备步骤与通过标准见 [状态与验收](STATUS.md) 的“复现完整 Web 验收”。脚本用官方 Connection 的未认证/跨站请求检查边界，再通过设置页解锁声音、选择工作区、打开会话，并断言真实事件到达浏览器输出。不设置 `DSH_ACCEPT_TURN=1` 时不会发送提示词。

2026-10-03 在一次隔离 `DSH_HOME` 的 rc.2 完整 Web 运行中通过：未认证 401、跨站 Origin 403、未声明方法 404；设置“常规”面板与会话头部铃铛都出现；真实 `agent/error` 到达浏览器并播放错误音（`soundDelta` 3）。该实例没有模型凭据，因此那次事件来自失败的回合，不能代替“正常回答 → 任务完成提醒”。

两点官方行为会被这些步骤暴露：

- 会话头部在空白状态只渲染 corner 槽，铃铛要等会话非空后才出现。先产生一次真实回合。
- 无头 Chromium 报告 `Notification.permission = denied`，桌面通知路径会被正确跳过。要验证系统横幅必须在真实桌面浏览器上手工确认。
