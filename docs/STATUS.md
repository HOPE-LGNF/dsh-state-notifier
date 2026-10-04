# 状态与验收

日期：2026-10-04。版本：`0.2.0`。源码公开在 [GitHub](https://github.com/HOPE-LGNF/dsh-state-notifier)，annotated tag `v0.2.0` 已推送；**npm 未发布**，未创建 GitHub Release。

## 已完成

| 编号 | 结果 | 验收依据 |
| --- | --- | --- |
| N-01 | 需求真实；固定两条兼容基线 | npm `0.2.0-rc.2`、Git `5badb15` 源码与发布物核对 |
| N-02 | 五类事件、主会话过滤、严格完成标准 | 纯逻辑测试与真实 Session 集成 |
| N-03 | 官方认证通道、长轮询、256 条记录、实例游标 | 宿主服务夹具和 journal 测试 |
| N-04 | 浏览器声音、系统通知、同源标签协调 | 单元测试及 Chrome 151 真实 API 检查 |
| N-05 | 单一全局配置、本机浏览器偏好 | Config 与 storage 同步测试 |
| N-06 | 卸载清理与输出故障隔离 | 取消、卸载、迟到 Promise、BEL 与日志故障测试 |
| N-07 | 中文文档、AGENTS、CI 配置、打包与历史导出 | 本地构建、npm 包检查；CI 已在 GitHub 实跑通过 |
| N-08 | 完整 rc.2 Web 应用启动、两个 UI 入口、真实事件投递、认证边界 | 隔离 `DSH_HOME` 实机运行，见下 |

## 实际验证范围

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| `npm run check` | 106 项通过 | Node 24.21.0 与 Node 22.23.3 本机各跑一次 |
| GitHub Actions | 四个 job 全部通过 | run 37191883594：Node 22/24 × ubuntu/windows，push 触发 |
| 干净依赖安装和构建测试 | 通过 | 使用锁文件与官方包缓存 |
| npm rc.2 的真实 Cordis + SessionStore | 6 组通过 | 真实事件提交、观察器和卸载；无模型调用 |
| master `5badb15` 的真实 Session 源码 | 相同 6 组通过 | 外部依赖仍使用锁定 npm 包；不是完整 master 应用 |
| npm rc.2 完整 Web 应用 | 通过 | 隔离 `DSH_HOME` 与本机回环端口；未使用日常 profile |
| npm `0.2.1-alpha.1` 完整 Web 应用 | 通过 | 同一套 `scripts/web-acceptance.mjs`：认证边界、两个入口、订阅连接、声音解锁 |
| npm `0.2.1-alpha.1` 的测试套件 | 106 项通过 | 临时副本装 dsh-session/dsh-scope `0.2.1-alpha.1` + cordis `4.0.5-alpha.1` |
| 插件管理器的版本门 | 生效且为硬拦截 | 见下“版本门的实测结论” |
| 两个 UI 入口 | 通过 | 设置“常规”面板与会话头部铃铛都出现 |
| 真实宿主事件到浏览器 | 通过 | 缺凭据回合触发真实 `agent/error`；浏览器播放错误音（`soundDelta` 3） |
| 认证与跨站边界 | 通过 | 未认证 401、跨站 Origin 403、未声明方法 404、非法信封 400 |
| master 的 Fetch 路由契约 | 源码核对通过 | 只读取 `rpc-host.ts` 与 `rpc.ts`，未在 master 上运行完整应用 |
| alpha 上的旧 `connection.rpc.handle` 路径 | 仍为 405 | 证明改用 Fetch 路由对 alpha 也是必需的 |
| Chrome 153 无头浏览器夹具 | 通过 | 实际 AudioContext、Notification、Web Locks 和 storage |
| 完整 Windows 通知中心验收 | 未完成 | 见 N-09 |
| `npm pack` | 通过 | 包含宿主源码、浏览器产物、patch 和许可证 |

测试使用虚构会话。没有消费用户的 API 额度。验收使用的隔离目录是工作区外的 `~/.dsh-n08-acceptance`（rc.2）与 `~/.dsh-alpha`（alpha），可随时删除。

### 版本门的实测结论

`@deepseek-ai/dsh-app-boot` 的 `evaluatePluginCompatibility` 会检查插件 `peerDependencies` 里名字为 `@deepseek-ai/dsh` 或以 `@deepseek-ai/dsh-` 开头的项，用 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })` 比对。A/B 实测（rc.2 运行时）：

| 探针 | peer 范围 | 结果 |
| --- | --- | --- |
| `dsh-gate-probe-bad` | `0.0.1` | 安装被拒并回滚（`restored package.json, pnpm-lock.yaml, and node_modules`），给出 `plugin allow-version` 豁免命令 |
| `dsh-gate-probe-good` | `^0.2.0-rc.2` | 正常安装 |

两点边界：**Cordis 不在检查范围内**（过滤器只认 `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`），而 alpha 已把 Cordis 提到 `~4.0.5-alpha.1`，本插件声明的 `~4.0.4` 不会被拦也不会被警告；版本门只挡安装，不校验运行期行为，所以仍需真机验收。

## 本次确认的上游缺陷

1. `connection.rpc.handle` 对晚加载的插件不可用。rc.2 与 master 都用调用方 Context 读取 `webServer` 登记前缀路由；Cordis 4 的服务属性读取沿 shadow 起点回溯到提供 `connection` 的 fiber，插件因此抛 `cannot get property "webServer" without inject`。错误只进入静默日志，通道不会注册，浏览器长轮询只能收到 405。修订前该缺陷使浏览器提醒在真实应用里完全不工作。
2. 会话头部在空白状态只渲染 `conversation.session.header.corner`。`conversation.session.header.utilities` 要等会话非空后才渲染。这是官方行为，不是插件缺陷；验收必须先产生一次真实回合。

## 必须由接手环境补做

| 编号 | 下一步 | 通过标准 |
| --- | --- | --- |
| N-08 剩余 | 在已配置模型凭据的环境跑完“模型回答 → 任务完成提醒” | 正常结束的回合在浏览器出声并显示桌面通知；`minDuration` 门槛按需调低 |
| N-08 剩余 | 在两条基线上重复同一套 Web 验收 | rc.2 与 master 都出现两个 UI 入口、都能投递真实事件、都拒绝跨站请求 |
| N-09 | Windows Edge 或 Chrome 人工验收 | 五类通知可见且音效可听；点击返回正确会话；系统免打扰行为被记录 |
| N-10 | 首次公开发布前检查 | 维护者确认名称、许可和署名；验证 CI；确定公开远端；人工创建 Release |

N-09 无法由 Linux 无头浏览器结果代替：本机已确认浏览器声音输出与 API 调用，但没有确认 Windows 横幅、通知中心和点击回会话。无头 Chromium 报告 `Notification.permission = denied`，所以本次桌面通知路径是被正确跳过的，不能算通过。

### 复现完整 Web 验收

```bash
cd "$HOME/projects/dsh-state-notifier"          # 换成你本机真实的仓库路径
npm pack
export DSH_HOME="$HOME/.dsh-notifier-acceptance"  # 必须是有写权限的真实目录
npx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add "$PWD/dsh-state-notifier-0.2.0.tgz"
npx @deepseek-ai/dsh@0.2.0-rc.2 web --no-open --host 127.0.0.1 --port 7712
# 用上面打印的 URL 与 token：
DSH_ACCEPT_TURN=1 \
DSH_WEB_URL="http://127.0.0.1:7712/?token=…" \
DSH_ACCEPT_WORKSPACE="$DSH_HOME/acceptance-workspace" \
PLAYWRIGHT_MODULE="$HOME/path/to/playwright/index.js" \
node scripts/web-acceptance.mjs
```

上面的路径都是示例。`DSH_HOME` 必须指向真实且可写的目录；照抄占位符会让 dsh 尝试创建不存在的根目录并以 `EACCES` 失败。

`DSH_ACCEPT_TURN=1` 会真实发送提示词。在已配置凭据的 profile 上会产生模型调用；很快返回的完成回合可能被 `minDuration` 门槛过滤。不加该变量时脚本只检查认证边界、两个入口和订阅连接。

## 与参考项目的差异

第一版没有自定义 WAV 文件、服务端外部播放器、逐事件音色映射、英文界面、长任务周期提醒、声音上传或 Windows 注册表协议。声音使用浏览器合成音与终端 BEL。没有复制参考项目的第三方声音资产。

这些是范围差异，不是已经实现的功能。若维护者需要恢复 WAV 能力，先定义播放设备和文件来源，再添加单独输出模块。不要把任意宿主文件路径暴露给浏览器读取。

## 已知投递限制

- 日志与去重均有固定上限。超出窗口后，旧事件可能再次被通知。
- 首次打开、宿主重启和超出补发窗口不会补播全部历史。
- 浏览器突然退出时，就绪租约最多延迟 35 秒过期。这期间 `auto` 可能未使用 BEL。
- 按前台策略静音、关闭浏览器输出或未取得权限时，旧通知不会在重新启用后集中播放。
- API 调用成功不证明人已看见或听见提醒。系统免打扰、浏览器冻结和设备故障仍可能影响投递。
