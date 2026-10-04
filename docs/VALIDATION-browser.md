# 浏览器检查

本页说明运行方法。已有结果与待完成事项见[项目状态](STATUS.md)。脚本需要已安装的 Playwright 和浏览器，不增加插件依赖。

## 浏览器夹具

在仓库根目录运行：

```bash
PLAYWRIGHT_MODULE="$HOME/path/to/playwright/index.js" node scripts/browser-smoke.mjs
```

将模块路径替换为本机路径。环境能直接解析 `playwright` 时，可省略该变量。`PLAYWRIGHT_CHANNEL` 默认为 `chrome`，也可设为已安装的 `msedge`。

脚本使用临时浏览器上下文，结束后关闭浏览器。具体检查项见 [browser-smoke.mjs](../scripts/browser-smoke.mjs)。上下文会显式授予通知权限；API 调用成功不证明系统弹窗可见或声音可听。

## 完整 dsh Web

在仓库根目录打包，并创建隔离目录：

```bash
npm pack
notifier_version="$(node -p 'require("./package.json").version')"
export DSH_HOME="$(mktemp -d)"
mkdir -p "$DSH_HOME/workspace"
printf '工作区：%s\n' "$DSH_HOME/workspace"
npx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add "$PWD/dsh-state-notifier-$notifier_version.tgz"
npx @deepseek-ai/dsh@0.2.0-rc.2 web --no-open --host 127.0.0.1 --port 7712
```

版本选择见[兼容基线](RESEARCH.md#版本与证据边界)。不要使用日常 profile、凭据或历史会话。

在另一个终端运行以下命令。将 URL 和 token 替换为宿主输出的值。将工作区路径替换为上一步创建的目录，将 Playwright 路径替换为本机路径。

```bash
DSH_ACCEPT_TURN=1 \
DSH_WEB_URL="http://127.0.0.1:7712/?token=…" \
DSH_ACCEPT_WORKSPACE="/tmp/上一步生成的目录/workspace" \
PLAYWRIGHT_MODULE="$HOME/path/to/playwright/index.js" \
node scripts/web-acceptance.mjs
```

`DSH_ACCEPT_TURN=1` 会发送一个回合。在配置模型的隔离环境中，这会调用模型。省略此变量时，不发送回合；缺少的铃铛和投递检查列为未验证。具体检查项见 [web-acceptance.mjs](../scripts/web-acceptance.mjs)。

会话非空后才显示铃铛。完成回合还需达到 `minDuration` 门槛。通知权限未获准时，脚本只能检查声音输出。

检查结束后，在宿主终端按 Ctrl+C 停止实例。

## Windows 人工检查

使用 Windows 上的 Edge 或 Chrome 打开隔离宿主。按 [README](../README.md#启用浏览器提醒) 启用声音与系统通知。

1. 分别触发五类通知，确认弹窗可见、声音可听。
2. 点击通知，确认打开对应会话。
3. 切换窗口前后台，检查前台静音策略。
4. 打开第二个同源标签页，检查重复通知。
5. 开启系统免打扰，检查横幅和通知中心的行为。
