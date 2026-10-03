# 功能与接口调研

调研日期：2026-10-03。兼容目标包括当天 npm `latest` 指向的 `@deepseek-ai/dsh@0.2.0-rc.2`，以及官方 Git master `5badb15`。以下结论来自源码、发布包和浏览器官方资料。实现与验收状态另见项目状态文档。

## 结论

需求成立。官方已经提供会话事件、审批、提问、目标状态、插件设置、客户端插槽和远程流。这些接口足以支持通知插件。本次在官方 master 和 `0.2.0-rc.2` 的客户端发布代码中，未找到覆盖完成、审批、提问、受阻、错误的声音或浏览器系统通知实现。

官方 master 的 Electron 桌面应用会用系统通知提示强制更新。这是应用更新功能，不是任务通知。官方页面内提示、SDK 通知帧和远程事件也是不同概念。不能因源码中出现 `notification` 一词，就认为任务通知已经实现。[桌面更新提醒源码](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/apps/desktop/src/update-attention.ts)、[官方架构](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/docs/architecture.md)

可以由 Windows 上的浏览器发出 Windows 通知。DSH 后端即使运行在 WSL，也可以把语义事件发送到 Windows 浏览器，再由浏览器调用 Notifications API。第一版无需安装 PowerShell 通知脚本、注册应用协议或改写 Windows 注册表。[Microsoft Edge 官方说明](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/notifications-badges)

## 版本与证据边界

| 对象 | 本次读取的版本 | 用途 |
| --- | --- | --- |
| npm DSH 发布物 | `0.2.0-rc.2` | 当前兼容目标；读取已安装包的生产代码和类型声明 |
| 官方 master | `5badb15`；CLI 声明 `0.2.1-alpha.1` | 了解最新设计；不能代替发布物兼容验证 |
| dsh-notify-bell | `6889435`；`0.12.0` | 五类事件、声音、控制面功能基准 |
| dsh-ding | `92a862a`；`1.0.2` | 系统通知、点击回到会话、查看时免打扰的参考 |
| 本地第三方分析报告 | 分析 bell `6889435`；验证 DSH `0.1.7-rc.1` | 缺陷清单；其旧版本验证结果不能直接归到 rc.2 |

`latest` 会变化。维护者必须记录测试时解析出的具体版本。master 在本次调研时已经领先发布版。本文中的路径以仓库相对路径或 npm 包内相对路径表达。[官方 CLI 版本声明](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/apps/cli/package.json)、[bell 版本声明](https://github.com/ZYar-er/dsh-notify-bell/blob/6889435/package.json)、[ding 版本声明](https://github.com/CAOGGL/dsh-ding/blob/92a862a/package.json)

用户提供的两个 ChatGPT 链接本次无法读取。本项目不能声称已参考其中的具体观点。版本管理需依据明确的仓库规范制定。

## bell 功能基准

| 功能 | 参考项目行为 | 本项目设计要求 |
| --- | --- | --- |
| 完成 | 主会话以最终文本回答结束回合时通知 | 排除空回合、工具结束回合、取消、错误与子代理完成 |
| 审批 | `approval/asked` 通知；决定后不再通知 | 每个审批请求只通知一次 |
| 提问 | `tool/call` 的 `ask_user_question` 通知 | 解析工具参数；回答和工具结果不再通知 |
| 受阻 | `goal/changed` 的 `operation = block` 通知 | 以目标标识和修订去重 |
| 错误 | `agent/error` 通知 | 与普通 shell 非零退出码区分 |
| 独立声音 | `done`、`permission`、`question`、`block`、`error` | 语义类别与播放设备分开 |
| 播放设备 | browser、backend、none | 给出实际可用状态；不能静默丢弃 |
| 后端声音 | Windows/WSL SoundPlayer；Linux 本机播放器；失败可回退 BEL | 保留平台适配边界；记录失败和回退 |
| 静音 | Web 铃铛开关，立即生效 | 状态可见，设置可保存 |
| 时长过滤 | 完成通知低于 `minDuration` 时只记日志 | 审批和提问不受该阈值影响 |
| 单事件配置 | 每类事件有开关和声音选择 | 显式默认值也必须生效 |
| 声音包 | 内置 WAV；自定义 WAV 目录；BEL 配置 | 包内资源能直接使用；校验资源存在 |
| UI | 会话头部铃铛、主题适配、中文/英文 | 使用当前官方插槽；不要复制旧客户端加载代码 |
| 日志 | 分类结果、摘要和时长 | 对降级和错误给出可诊断信息 |
| 生命周期 | 会话销毁时回收状态 | 插件卸载时也关闭连接、定时器和播放器 |

基准来自 [bell README](https://github.com/ZYar-er/dsh-notify-bell/blob/6889435/README.zh.md)、[事件分类](https://github.com/ZYar-er/dsh-notify-bell/blob/6889435/src/events.js)、[完成判定](https://github.com/ZYar-er/dsh-notify-bell/blob/6889435/src/turns.js)。这些是功能参考，不是复制其架构的理由。

ding 还提供声音上传、长任务周期提醒、模板、配置导入导出、Windows 通知应用名和协议激活。用户要求融入的是系统通知思路。这些额外功能不应全部进入第一版。最有价值的补充是：通知点击回到对应会话，以及用户正在查看对应会话时减少打扰。[ding README](https://github.com/CAOGGL/dsh-ding/blob/92a862a/README.md)

## 当前官方接口

以下接口已同时核对 master 源码与 `0.2.0-rc.2` 发布包。发布包的 `lib/types/` 声明可用于后续兼容测试。

| 任务 | 接入点 | 主源码路径 |
| --- | --- | --- |
| 观察已提交事件 | `ctx.on('session/event', (session, event) => ...)` | `packages/core/session/src/types.ts` |
| 回合完成判定 | `turn/start`、`assistant/message`、`tool/call`、`turn/end` | 同上 |
| 审批 | 会话事件 `approval/asked` | `packages/interaction/user-approval/src/types.ts` |
| 提问 | 会话事件 `tool/call`；另有 `user-questions/request` waterfall | `packages/interaction/user-questions/src/types.ts` |
| 受阻 | `ctx.on('goal/changed', ({ agent, change }) => ...)` | `packages/goal/goal/src/domain.ts` |
| Agent 错误 | `ctx.on('agent/error', ({ agent, turn, step, error }) => ...)` | `packages/core/agent/src/runtime-types.ts` |
| 回收会话状态 | `session/disposed` | `packages/core/session/src/types.ts` |
| Host 远程服务 | `TypertRemoteService`、`Remote({ mode: 'stream' })` | `packages/typert/protocol/src/index.ts` |
| Host 流调度 | `ctx.typertGateway.stream(...)` | `packages/api/gateway/src/index.ts` |
| Client 流监督 | `ctx.remote.$stream({ name, open, ended })` | `packages/api/gateway/src/client/remote-stream.ts` |
| 官方设置 | `Config` schema；`ctx.settings`；`ctx.remote.settings` | `packages/settings/settings/src/index.ts`、`packages/api/settings-controller/src/index.ts` |
| 设置更新冲突 | `update(ns, patch, expectedRevision)` | 同上 |
| 会话头部 UI | `conversation.session.header.utilities` 或 `.actions` | `packages/client/ui-conversation/src/client/contract/slots.ts` |
| 返回会话 | `ctx.uiWorkspace.openSession(sessionId)` | 官方 Agent Teams 客户端示例 |

[会话事件定义](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/packages/core/session/src/types.ts)、[Remote 协议实现](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/packages/typert/protocol/src/index.ts)、[Gateway](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/packages/api/gateway/src/index.ts)、[官方 UI 示例](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/packages/experimental/client-ui-agent-team/src/client/mount.ts)

### 两条兼容基线

| 契约 | npm `0.2.0-rc.2` | master `5badb15` |
| --- | --- | --- |
| 五类通知所需 Host 事件 | 存在 | 存在 |
| 会话头部 `.utilities` 与 `.actions` 插槽 | 存在 | 存在 |
| Host `connection.rpc.handle(channel, handler)` | 存在 | 同签名 |
| handler 参数 | `(endpoint, payload, signal, peer)` | 同签名 |
| Client `connection.rpc.call(channel, endpoint, payload, signal?)` | 存在 | 同签名 |
| 独立 RPC channel 的 Host/Origin 检查与浏览器认证 | 存在 | 存在 |
| Loader Config 与官方设置页面 | 存在 | 存在 |
| 浏览器 Notifications API | 由浏览器提供 | 由浏览器提供 |
| 本项目完整运行验证 | 必须单独记录 | 必须单独记录 |

矩阵表示读取到的契约兼容。它不表示完整插件已在两条基线上运行通过。master 源码运行需要上游规定的构建环境。若只做接口检查，应将结果标记为“源码契约检查”。

证据：npm `@deepseek-ai/dsh-client-connection@0.2.0-rc.2` 的 `lib/types/rpc.d.ts`、`lib/types/rpc-host.d.ts`、`lib/types/client/rpc.d.ts`；[master Host RPC](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/packages/client/connection/src/rpc-host.ts)、[master Client RPC](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/packages/client/connection/src/client/rpc.ts)。

### 完成判定

`turn/end.reason.kind = completed` 只说明回合正常关闭。空输入与工具主动结束回合也可能满足此条件。严格完成通知还需满足：最后的 assistant 消息有非空文本、没有工具调用块、其后没有工具调用，且消息未标记 `interrupted`。回合发生错误、取消或被工具结束时，不能通知为成功。

时长使用事件时间，不使用收到事件时的本机时间。摘要只读取 `user/message.source.kind = user`。子代理信息可由会话头的 `delegationDepth` 与 `origin` 排除。必须在销毁时回收每个会话的跟踪状态。[会话类型](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/packages/core/session/src/types.ts)、[回合流程](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/docs/architecture.md#turn-flow)

当前 `assistant/message` 包含内嵌 `stream`。旧测试夹具用 `sourceEventSeqs` 表达其来源，已不符合接口。应使用当前 Session API 验证真实事件提交。

### 流与客户端

由 Host 分类事件，然后只向 Client 发送语义通知。本项目选择官方 Connection RPC 的长轮询作为传输。Host 使用 `ctx.connection.rpc.handle('/state-notifier', handler)`；Client 使用 `ctx.connection.rpc.call('/state-notifier', endpoint, payload, signal)`。每次请求最多等待 25 秒。事件日志使用有界缓存和游标。无需另建 SSE 服务或原生脚本协议。

该选择保留官方 Host/Origin 检查、浏览器认证、请求关联和取消信号。它也避免维护手写 Typert manifest，或依赖 SRC 方法参数名称解析。独立 channel 的请求先通过 `admit()`，然后由官方 HTTP bridge 调用插件 handler。Client caller 没有固定内部超时，插件负责自己的等待时间。[Host RPC 实现](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/packages/client/connection/src/rpc-host.ts)、[Client RPC 实现](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/packages/client/connection/src/client/rpc.ts)

长轮询需要四个约束：日志查询与等待器注册之间不能丢失唤醒；请求取消或插件卸载时必须结束等待；日志淘汰造成的游标缺口必须显式报告；插件重载或 Host 重启后必须通过实例标识识别游标重新计数。对这些条件应写竞态测试。该传输设计不提供持久离线通知保证。

`api-remotes` 的事件转发有固定 allowlist。它不包含自定义通知事件、`session/event`、`agent/error` 或 `goal/changed`。Gateway 只允许注册一个应用事件源。因此插件不能接管 `registerRemoteEvents()`，也不能假定自定义 `ctx.emit()` 会传到浏览器。[官方事件装配](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/packages/api/remotes/src/index.ts)、[allowlist](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/packages/api/remotes/src/remote-events.ts)

调研也确认了另一条可用路径：Host 通过 `TypertRemoteService` 和标准 `Remote` decorator 导出流方法。`0.2.0-rc.2` Gateway 有 SRC discovery：当没有生成的严格描述符时，它可以发现这些方法。该模式会读取方法参数名称；因此不能压缩参数名，取消参数必须是最后一个且名为 `signal`。严格生成描述符可以去除这项耦合，但会增加本插件的构建工作。第一版不采用 Typert stream。

`ctx.remote.$stream` 的 `open` 精确签名是 `(signal) => AsyncIterable<Item>`。它负责监督域流，不会自动生成自定义 RPC 方法。Client 仍需具有可调用的 Remote 描述符或公开连接适配器。第一项流帧应说明协议版本和当前基线。重连时不能把历史快照当作新通知播放。[Client 流接口](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/packages/api/gateway/src/client/remote-stream.ts)

### 设置

官方 SettingsForms 读取 Loader 中插件的 `Config` schema。它以 profile entry id 作为设置命名空间。`configure()` 设置页面策略，不负责注册任意设置命名空间。插件可以让官方设置服务保存配置，从而取消 bell 的第二份运行时 JSON 文件及其优先级猜测。

浏览器的通知权限属于浏览器 origin。它不应保存成 Host 的“已授权”开关。显示设置与实际权限是两个独立状态。官方设置更新可能触发 HMR，插件需完整释放旧实例副作用。[官方设置服务](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/packages/settings/settings/src/index.ts)、[设置控制器](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/packages/api/settings-controller/src/index.ts)

## 浏览器发出 Windows 通知

浏览器授权后，`new Notification(title, options)` 可显示系统通知；点击事件可触发页面导航。权限请求必须由用户操作触发。应先检测 `window.isSecureContext`、`Notification` 是否存在和权限状态。授权被拒绝后，UI 应指导用户在浏览器设置中修改权限。[Microsoft 官方示例](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/notifications-badges)

Notifications API 要求安全上下文。本机回环地址通常可作为可信来源；通过局域网 IP 的普通 HTTP 地址不能据此推断支持通知。端口变化也会改变 origin，原授权不能视为新 origin 的授权。[Notifications 标准](https://notifications.spec.whatwg.org/)、[Secure Contexts 标准](https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy)

网页通知和 Web Audio 是两种能力。通知授权不能解除声音的自动播放限制。必须在用户点击时解锁 AudioContext。系统通知支持 `silent` 偏好，插件可请求静音，再用自己的声音表达事件类别；实际行为仍由浏览器和系统决定。[Chrome 自动播放策略](https://developer.chrome.com/blog/autoplay/)、[Notifications 标准](https://notifications.spec.whatwg.org/)

普通网页通知依赖运行中的页面。关闭页面后，插件的连接和 JavaScript 不再接收新事件。Service Worker 的持久通知也不能自行获得 DSH 的新事件；若要求关闭页面后仍收到通知，还需要后台事件来源，例如 Push。第一版不应声称具备此能力。[Microsoft Service Worker 通知说明](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/notifications-badges)

后台标签页可能被浏览器冻结或丢弃。通知创建成功也不等于 Windows 已显示横幅：系统设置、勿扰状态和浏览器策略可能影响显示。Windows 横幅、通知中心和点击行为需要在真实 Windows 浏览器手工验收。Linux 浏览器自动化只能证明 API 调用与客户端逻辑。

多标签页不能各播放同一通知。应选择一个活动客户端负责发声，并在失去资格后停止处理。通知点击应使用官方会话导航。窗口回到前台不等于目标会话可用，需要对缺失会话提供反馈。

## 本地报告 F-1 至 F-9 的处理方向

本地报告是问题索引。以下是设计建议，不表示修复已经验收。报告中的复现环境是 `0.1.7-rc.1`。

| 编号 | 问题 | 建议 |
| --- | --- | --- |
| F-1 | 通过与默认值比较来猜测显式配置 | 使用官方设置；移除第二份配置事实源；测显式默认值 |
| F-2 | 无 Web 客户端时默认浏览器播放静音 | 明确有效播放设备和不可用原因；配置后端或给出可见诊断 |
| F-3 | WAV 缺失或播放器失败时静默 BEL 回退 | 默认资源随包分发；错误可见；单次失败只回退一次 |
| F-4 | 过时夹具与假阳性集成测试 | 锁定当前 DSH 测试版本；验证 Session 提交与正向通知都发生 |
| F-5 | 自建写端点无同源限制 | 复用官方认证 RPC；不新增裸 HTTP 写端点；测试连接边界 |
| F-6 | Node 版本未声明 | 与兼容目标对齐声明 engines；测最低支持版本 |
| F-7 | CI 不跑测试，版本注释人工同步 | CI 执行必要检查；版本只取 package.json；避免复制版本常量 |
| F-8 | 多份浏览器音频实现 | 单一 Client 源码；构建生成产物；浏览器测试使用真实产物 |
| F-9 | 包含演示目录，许可和测试粒度不足 | files 白名单；npm pack 检查；保留完整许可；逐行为命名测试 |

## Cordis 对骨架的约束

论文把组合问题分为两个维度：组件撤销时能还原副作用；依赖变化时能正确激活或停用组件。插件实现应把连接、事件、UI、定时器和播放器纳入所属 Context 的清理范围。依赖需要声明，不能通过全局变量寻找服务。无需把论文的形式系统重新实现成插件内部框架。使用 Cordis 已有 `inject`、`ctx.effect` 和事件注册即可。

来源：本地参考文件 `reference/2608.25512v1.pdf`，摘要与第 3 节；[论文](https://arxiv.org/abs/2608.25512)、[官方架构的 Cordis 说明](https://github.com/deepseek-ai/deepseek-harness/blob/5badb15/docs/architecture.md#cordis)。

## 用户提供的对比审计：本项目覆盖映射

用户补充的审计比较了 bell、task-notify、sound-notifier 和 ding。本节将其风险线索映射到当前设计。它不表示本次独立复核了 task-notify 或 sound-notifier 的全部代码。实现路径可由 `src/journal.js`、`src/browser.js` 和 `src/index.js` 检查，验收结果需另记。

| 审计线索 | 本项目对应措施 | 验证或限制 |
| --- | --- | --- |
| 连接时快照固定 enabled，修改后不生效 | 每次轮询报告当前 browserReady；就绪状态变化取消当前请求并重新订阅 | 测开启、关闭和音量归零后的行为 |
| 隐藏页面停止拉取，失去后台提醒 | 轮询不以页面隐藏为停止条件 | 浏览器冻结或丢弃页面仍是外部限制 |
| 短周期重叠轮询 | 前一次请求结束后才发下一次；每页只有一个循环 | 测重连和设置变化不会产生并行请求 |
| 重启后 seq 归零，旧游标吞通知 | 每个 Host 实例有 epoch；变化后重置游标 | 测旧 epoch、高游标和缓存缺口 |
| 首次订阅历史集中响铃 | 首次订阅只接收当前基线 | 历史不重放；同 epoch 断线可在缓存内补发 |
| 没有补发或将缓存缺口静默跳过 | 同 epoch 按游标补发；超出保留范围显示重置状态 | 有界内存日志不是持久消息队列 |
| 多标签页重复提醒 | Web Locks 按通知 ID 协调；同源回执记录有界 | 缺少 Web Locks 时要求只在一页启用提醒 |
| 发送前就写“已推送” | 各输出通道发送调用成功后才保存回执 | API 成功不证明系统横幅实际显示；崩溃窗口仍可能重复 |
| 去重 Set 无限增长 | Host 日志、客户端列表和浏览器回执设定边界 | 同时检查会话跟踪状态的回收 |
| 用 turn-stopping 或 idle 直接判完成 | 以已提交的 turn/end 与最终文本联合判定 | 真实 Session 测空回合、取消、工具和子代理 |
| 缺少用户手势解锁声音 | 按钮点击时创建并 resume AudioContext | 测未解锁状态与播放失败提示 |
| AudioContext、监听器和定时器残留 | Context 清理所属资源；关闭 AudioContext，取消轮询和定时器 | 测卸载重载后只保留一个观察器 |
| 浏览器逻辑复制与手写 manifest 负担 | 单一浏览器源码，经构建生成客户端；使用公开 Connection RPC | 测真实构建产物和两条官方接口基线 |
| PowerShell 路径插值和任意文件音效读取 | 第一版不执行 PowerShell，也不提供文件音效上传或读取 | 后续增加该能力时需独立设计与验证 |
| 全局节流吞重要审批，idle 定时器未取消 | 不以全局完成冷却抑制审批和提问；不使用 idle 防抖判定 | 不承诺 ding 的周期运行提醒功能 |

这些措施覆盖接口、生命周期与竞态风险。不能据此声称浏览器提供严格 exactly-once 通知：程序可能在创建通知后、写入回执前退出，且系统显示状态不受插件完全控制。

## 发布前必须补齐的证据

1. 在固定 `0.2.0-rc.2` 上安装包并加载 Host 与 Client。
2. 通过真实 Session API 覆盖五类事件、误报反例和子代理过滤。
3. 在两条基线上通过真实 Connection RPC 覆盖取消、卸载、游标缺口、重连和配置热更新。
4. 在浏览器验证授权、声音解锁、静音、点击回会话和多标签页。
5. 在 Windows 上验证系统横幅、通知中心和后台页面行为。
6. 检查 npm tarball、README 致谢、许可、Git 导出和接手说明。

每一项应记录“通过、失败、未验证”与具体运行环境。自动化命令退出成功不能替代 Windows 系统通知的验收。
