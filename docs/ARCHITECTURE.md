# 架构

## 目标

把“何时需要提醒”与“在哪台设备提醒”分开。插件不改变 Agent 的执行、审批或提问流程。

```text
官方 Session / Goal / Agent 事件
              ↓
          core.js 判定
              ↓
          index.js 分发 ──→ 终端日志 / BEL
              ↓
        journal.js 有界记录
              ↓
     官方 Connection RPC 长轮询
              ↓
       browser.js 浏览器输出
              ↑
        client.js 官方插槽
```

## 模块职责

| 文件 | 负责 | 不负责 |
| --- | --- | --- |
| `src/core.js` | 回合状态、五类分类、主会话过滤、有界去重 | 网络、声音、持久化 |
| `src/journal.js` | 实例标识、序号、256 条记录、等待与取消、浏览器就绪租约 | 判断任务是否完成 |
| `src/index.js` | Config、Cordis 监听、官方 RPC 注册、终端输出、卸载 | 浏览器权限、用户正文 |
| `src/browser.js` | 浏览器偏好、声音、系统通知、跨标签回执、串行长轮询 | 重新解释 Session 事件 |
| `src/client.js` | React 控件、设置与会话头部插槽 | 复制播放器实现 |

`scripts/build.mjs` 只生成 dsh 的 ModuleLoader 包装与浏览器 bundle。React 由宿主共享。产物不提交到 Git，但必须包含在 npm 包中。

## 生命周期

Cordis 注册的监听和依赖由框架回收。手工定时器、等待请求、AudioContext、通知对象和浏览器事件监听由 `ctx.effect` 统一释放。关闭浏览器输出时，中止正在等待的 RPC。插件卸载后，迟到的权限请求或音频 Promise 不得重新激活输出。

这个约束来自 Cordis 的可撤销副作用模型。`unref()` 只控制进程退出；它不能代替资源释放。

## 传输协议

公开路由是共享 `/api` 通道上的精确 Fetch 路由 `/api/state-notifier`，请求方法为 POST。客户端调用 `ctx.connection.rpc.call('/api', 'state-notifier', request, signal)`。宿主使用 `ctx.connection.fetch.register({ path, methods: ['POST'], requestBody: 'buffered', fetch })`。官方 Connection 负责 Host/Origin 检查、浏览器认证、请求关联与取消。插件不注册裸 HTTP 写接口。

不使用 `connection.rpc.handle`。rc.2 与 master 的实现都用调用方 Context 读取 `webServer` 登记前缀路由。Cordis 4 的服务属性读取会沿 shadow 起点回溯到提供 `connection` 的 fiber；晚于 `connection` 加载的插件因此抛 `cannot get property "webServer" without inject`。该错误只进入静默日志，通道不会注册，客户端只能收到 405。

请求含 `clientId`、`browserReady`、`cursor`。游标为空时只取得当前基线。后续游标为 `{ epoch, seq }`。响应含 `epoch`、`cursor`、`reset`、`notices` 和 `playback`。

- 有新通知时立即返回。
- 无新通知时最多等待 25 秒。
- 同一客户端一次只有一个在途请求。
- 宿主保留最多 256 条通知和 32 个近期客户端。
- 同实例重试相同游标可读到相同记录。客户端按通知身份去重。
- 实例改变、游标超前或记录被淘汰时返回 `reset`，并建立新基线。

新实例使用随机 `epoch`。所以宿主重启后序号从 1 开始，不会被旧浏览器游标永久忽略。

通知身份是宿主实例与序号的组合。core 负责当前实例内的语义去重。传输重试不会改变身份。跨宿主重启不追溯、不持久补发。

## 浏览器与终端的选择

客户端每次订阅更新一次就绪状态。就绪表示至少一种输出当前可用：声音已解锁，或系统通知已获准。宿主的租约有效期为 35 秒。`auto` 在没有有效就绪租约时使用 BEL。

租约不是确认协议。页面突然退出后，最多可能有 35 秒仍被认为就绪。页面隐藏后的计时器节流或冻结也可能延迟接收。当前实现不增加确认重试或后台 Push 服务。后续若需要可靠到达，应先定义时效、重试和隐私要求。

## 配置与隐私

宿主 Config 是全局策略的唯一来源。浏览器 `localStorage` 只保存浏览器偏好和最多 256 条成功通道回执。没有第二份宿主 JSON 设置文件。

通知不携带任务正文、工具参数、审批理由或错误堆栈。日志也只输出事件分类。原生通知仅含分类和会话短标识。点击动作通过宿主的 `uiWorkspace.openSession` 完成。

## 兼容策略

先使用两条基线都有的公开 Connection 接口。当前不使用私有字段、手写 Typert manifest 或基于函数参数名的弱解析。

未来若官方提供稳定的通知服务或外部插件的完整 Remote 生成工具，先确认迁移能减少代码，再替换传输层。不要让迁移改变 core 的事件语义。
