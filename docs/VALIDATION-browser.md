# 浏览器提醒验证

运行生命周期与故障单元检查：

```bash
node --test --test-isolation=none test/browser.test.js
```

运行真实 Chromium 夹具（需要机器已有 Playwright 与 Chrome，无需给插件增加开发依赖）：

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.js node scripts/browser-smoke.mjs
```

在批准 `node --test` 的受限执行环境中，也可使用同一脚本的测试入口：

```bash
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.js node --test --test-isolation=none scripts/browser-smoke.mjs
```

如项目外的 Node 环境能直接解析 `playwright`，可省略变量。`PLAYWRIGHT_CHANNEL` 默认为 `chrome`，也可以设为已安装的 `msedge`。

脚本使用全新临时浏览器上下文和 `src/browser.js`，通过 Playwright 请求拦截在内存中提供 localhost 夹具，无需监听端口，结束后关闭浏览器。它验证实际点击后 AudioContext 解锁、五类提醒均有正例、原生 Notification 构造、两个标签页通过 Web Locks 去重、storage 事件同步设置、重新启用和卸载行为。单元检查另外覆盖发送失败不记成功、异步通知错误撤销记录、迟到权限与音频 Promise、通知与记录数量上限、串行长轮询和立即取消。

2026-10-03 本地 Linux Headless Chrome 151.0.7922.173 已通过该脚本，五类均产生声音节点和原生通知构造，两个标签页的同事件仅构造一次通知，最终成功记录 7 条。该次使用 `node --test --test-isolation=none` 入口和临时环境加载模块指定已安装的 Playwright。普通 Node 入口在该受限环境中被 Chromium socket 权限拦截；这属于执行环境限制。

通知权限由测试上下文显式授予；脚本不会自动确认真实权限弹窗。该检查证明浏览器 API 接受输出，不能证明 Windows 系统实际显示通知或扬声器可听。Windows 接收端仍需手动点击启用声音与允许桌面通知，检查五类提醒、通知点击会话切换和窗口前后台行为。真实 Harness 插槽与 host RPC 验证另行记录。
