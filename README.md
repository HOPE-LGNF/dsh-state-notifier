# dsh-state-notifier

为 DeepSeek Harness 提供五类提醒：任务完成、等待审批、等待回答、任务受阻、任务出错。

这是 `0.1.0` 本地开发版本。目标是准确判定事件，并保持代码容易接手。兼容基线为 npm `@deepseek-ai/dsh@0.2.0-rc.2` 和官方 Git `5badb15`（`0.2.1-alpha.1`）。实际验证范围见 [验证记录](docs/STATUS.md)。不要把这两个固定基线理解为支持以后所有 `latest`。

## 功能

- 完成提醒要求回合正常结束，并有最终文本回答。取消、空回合、仅调用工具的回合和子代理不会误报完成。
- 审批、提问、受阻和错误分别提醒。它们不受完成耗时门槛影响。
- 浏览器播放五种合成提示音。无需下载声音素材，也不启动外部播放器。
- 浏览器获准后发送系统通知。通知可出现在 Windows 通知中心。点击通知可回到对应会话。
- 两个同源标签页通过 Web Locks 和有界回执协调发送。设置修改立即生效，并同步到其他同源标签页。
- 通信复用官方 Connection RPC。后台页面持续订阅。相同宿主实例的断线可补发最近 256 条通知。
- 默认只显示分类与会话短标识。不会把任务正文、工具参数或错误堆栈发送到系统通知。
- 没有就绪浏览器时，`auto` 使用终端 BEL。终端不能响铃时给出诊断，仍记录通知日志。

## 本地安装

需要 Node.js 22.19 或更高的 22.x，或 Node.js 24 及更高版本。此范围与上游仓库一致。建议使用 Node.js 24。先安装依赖并构建：

```bash
npm ci
npm run check
npm pack
```

再用你使用的 dsh 版本安装生成的本地包。以下命令使用固定的已测版本；请将包路径替换成实际绝对路径：

```bash
npx @deepseek-ai/dsh@0.2.0-rc.2 plugin --profile web add /absolute/path/dsh-state-notifier-0.1.0.tgz
npx @deepseek-ai/dsh@0.2.0-rc.2 web
```

需要跟随最新发行版时，把版本替换为 `latest`。升级后先检查 [兼容验证步骤](docs/HANDOFF.md)，再用于日常任务。卸载使用 `dsh plugin --profile web remove dsh-state-notifier`。

## 启用浏览器提醒

1. 打开 dsh 页面。进入设置中的“常规”，或打开会话顶部的铃铛。
2. 勾选“播放声音”。首次需要点一次“点击解锁声音”，浏览器要求用户操作才能解锁音频。
3. 勾选“显示桌面通知”，并按提示点一次“点击授权桌面通知”，在浏览器提示中允许本站通知。
4. 展开“权限及运行信息”查看声音、权限、连接与主机策略。

其余设置按需展开：“声音方案与试听”可为每个事件类别选择合成音并试听；“通知外观”可换铃铛图标、上传本机图标，以及选择通知里显示会话短标识还是会话标题。上传的图标只写入本机 `localStorage`，不会发送到宿主。

声音授权与通知授权是两件事。刷新页面后，可能需要再次解锁声音。若通知权限已经被拒绝，请到浏览器站点设置中修改。

Windows 通知由 **Windows 上打开 dsh 页面的浏览器**发送。dsh 宿主可以运行在 WSL。远程 HTTP 地址通常不能使用系统通知；使用 HTTPS。`localhost` 和回环地址通常是安全上下文。网页关闭、休眠或被浏览器冻结后，本插件不能保证提醒到达。它没有 Web Push 后台服务。

## 配置

全局策略只保存在 Cordis 配置中。可以在 dsh 的插件设置中修改本插件的 Config，也可以编辑 profile 的 `cordis.patch.yml`：

```yaml
- id: state-notifier
  config:
    enabled: true
    playback: auto
    minDuration: 10
    events:
      complete: true
      approval: true
      question: true
      block: true
      error: true
```

| 项目 | 含义 |
| --- | --- |
| `enabled` | 总开关；关闭后不产生新通知 |
| `playback: auto` | 有就绪浏览器时由浏览器输出；否则使用 BEL |
| `playback: browser` | 只由浏览器输出；仍保留终端日志 |
| `playback: terminal` | 只用终端 BEL；仍保留终端日志 |
| `playback: none` | 只记录日志 |
| `minDuration` | 完成通知最短耗时，单位为秒；默认 10 |
| `events` | 五类通知的独立开关 |

浏览器面板的开关、音量和前台静音保存在该浏览器的 `localStorage` 中。它们不会覆盖全局策略。关闭此浏览器提醒后，`auto` 仍可能使用终端 BEL；需要全部静音时关闭宿主总开关。前台静音针对整个 dsh 窗口；它不是“仅当前会话静音”。

## 行为边界

通知使用有界内存记录。宿主重启、插件重载或断线超过保留范围时，面板会提示记录重置。首次打开页面只接收新通知，不补播旧任务。已被禁用、前台静音或未授权的输出不会在以后授权时集中重放。

发送回执表示浏览器接受了 API 调用，不表示用户已经看到或听到提醒。浏览器崩溃、存储失败和操作系统免打扰仍可能造成重复或遗漏。没有 Web Locks 时，面板提示仅在一个标签页启用。不能承诺严格恰好一次投递。

本项目参考 bell 的五类事件和控制功能，重新实现了传输与播放。第一版使用浏览器合成音和终端 BEL，未移植旧的 WAV 目录、PowerShell/Linux 播放器、逐事件音色映射及中英文切换。也未移植 ding 的声音上传、周期提醒和注册表协议。这些差异列在 [状态与后续工作](docs/STATUS.md)，不会被当作已完成。

## 开发和交接

- [架构](docs/ARCHITECTURE.md)：模块职责、配置与投递边界。
- [调研](docs/RESEARCH.md)：官方接口、需求依据和参考项目缺陷。
- [交接](docs/HANDOFF.md)：恢复完整 Git 历史、验证、打包和发布。
- [状态](docs/STATUS.md)：已完成项、验证证据和后续验收。
- [变更记录](CHANGELOG.md)：只记录对用户重要的变化。

## 致谢

- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)：宿主、插件接口、官方文档与测试契约。
- [ZYar-er/dsh-notify-bell](https://github.com/ZYar-er/dsh-notify-bell)：五类通知、严格完成判定、终端响铃及铃铛入口的功能基准。
- [CAOGGL/dsh-ding](https://github.com/CAOGGL/dsh-ding)：Windows 系统通知、点击返回会话及静音体验的参考。
- [Cordis 论文](https://arxiv.org/abs/2608.25512)：可撤销副作用和响应式依赖的设计依据。
- [esbuild](https://github.com/evanw/esbuild)：把唯一一份浏览器源码构建为 dsh 客户端模块。

用户提供的第三方报告和对比评审用于设计回归用例。未复制上述通知插件的代码或音频资源。
