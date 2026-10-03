# 开发约定

先读 `README.md`、`docs/ARCHITECTURE.md`、`docs/STATUS.md` 和 `docs/HANDOFF.md`。

- 文档使用中文。句子保持简短。每个步骤只说明一个动作。固定使用“会话”“回合”“通知”“宿主”“浏览器”等术语。
- 先维护已有模块。不要添加另一套设置、HTTP 鉴权、客户端加载器或事件分类器。
- 以 `docs/RESEARCH.md` 中的 npm 和 Git 快照作为兼容基线。更新基线时，记录版本与提交，再运行契约和集成检查。
- 通知失败不得阻止 Agent 工作。取消回合、空回合和子代理不得误报完成。
- 事件监听交给 Cordis。手工资源必须在 `ctx.effect` 中释放。检查卸载时仍在等待的 Promise。
- 不记录任务正文、工具参数、审批理由或错误堆栈。测试使用虚构内容。
- 修改通知判定、去重、游标或异步清理时，补充一个能复现缺陷的行为测试。
- 浏览器代码只修改 `src/`。运行 `npm run build` 生成 `dist/client.js`。
- 完成修改后运行 `npm run check`。用户可感知的变化写入 `CHANGELOG.md` 的“未发布”。
- 每个提交只表达一个意图。使用 `feat:`、`fix:`、`test:`、`docs:` 或 `chore:`。不要移动已发布的 tag。
- 本地开发与公开发布分开。没有明确请求时，不推送、不发布、不修改用户日常使用的 dsh 配置。
- 若任务足够大，可让子代理分别实现互不重叠的模块。主代理负责集成和验收。

## 开始一项改动

1. 检查 `git status --short`。保留已有的用户改动。
2. 在 `docs/STATUS.md` 找到相关编号。写清本次验收标准。
3. 先复现问题，再修改最小必要模块。不要只按参考项目的旧接口猜测。
4. 完成后更新状态、验证结果和下一步。区分源码核对、夹具检查、真实应用和系统人工验收。

## 模块边界

- `core.js` 是事件语义的唯一来源。不得在客户端再次判断任务是否完成。
- `journal.js` 负责补发与取消。保持记录、客户端和等待请求有界。
- `index.js` 复用官方 Connection。不得添加没有鉴权的裸 HTTP 接口。
- `browser.js` 是播放器与系统通知的唯一实现。发送失败不得提前留下成功回执。
- `client.js` 只装配 UI。使用官方插槽和主题 token，不查询或改写宿主私有 DOM。

## 必须保留的反例

取消、空回合、工具收尾、子代理、重复事件、日志写入失败、BEL 定时器失败、前台静音、两个标签页并发、断线重连、宿主重启和卸载中的迟到 Promise，都不能靠删除断言来“修好”。修改相关行为时，至少运行对应测试和 `npm run check`。

## 接手时的优先事项

`docs/STATUS.md` 的 N-08 和 N-09 仍需完整 dsh Web 与 Windows 接收端验收。Linux 无头浏览器接受 Notification 不等于 Windows 已显示弹窗。不要把 Session 源码替换检查写成整个 master 应用已跑通。CI 文件存在也不等于 GitHub Actions 已运行。

跟进上游时，记录 npm 精确版本和 Git 提交；运行 `node scripts/check-upstream.mjs /path/to/deepseek-harness`，再核对官方 Connection 与插槽契约。若上游已经提供同等通知能力，重新评估是否应缩小本插件。
