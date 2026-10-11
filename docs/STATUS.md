# 项目状态

更新日期：2026-10-12。以下是已有源码检查与兼容检查的最近结果，不代表对 `0.3.1` 发布包的重新验证。兼容基线见 [README](../README.md#本地安装)，运行方法见[开发说明](../README.md#开发)和[浏览器检查](VALIDATION-browser.md)。

## 已有检查结果

| 检查 | 最近结果 | 范围 |
| --- | --- | --- |
| 构建与测试 | 本地 Node 24.21.0 通过 112 项；CI 四组矩阵通过 | `npm run check` 与 [GitHub Actions](https://github.com/HOPE-LGNF/dsh-state-notifier/actions) |
| Session 集成 | npm rc.2 与 Git 基线各 6 组通过 | Git 基线替换 Session 源码，其他依赖来自锁定 npm 包；不代表完整 Git 基线应用 |
| 浏览器夹具 | Chromium 153.0.8010.12 通过 | 五类输出、双标签去重、排队锁取消与卸载；不证明系统弹窗或声音可听 |
| 完整 rc.2 Web | Chromium 153.0.8010.12 通过 | 两个 UI 入口、连接、声音解锁、指定工作区、401/403/404 边界与真实错误音投递 |
| npm `0.2.1-alpha.1` | 本机重跑通过：当时 106 项测试（现为 112 项）与完整 Web 检查 | 测试用 dsh-session/dsh-scope `0.2.1-alpha.1` 加 cordis `4.0.5-alpha.1`；Web 覆盖认证、入口、连接与声音解锁 |
| 插件安装版本门 | 拒绝 `0.1.7-rc.1`，接受 rc.2 与 alpha.1 | 用真实插件包逐向验证；范围同时声明在 `package.json` 的 `engines.dsh` 与 `peerDependencies` |
| 打包 | 通过 | 包含宿主源码、浏览器产物、patch 与许可证；不含文档，文档只在仓库中维护 |
| 真实浏览器（维护者提供截图） | 设置面板完整渲染：四类开关、五种事件的声音方案与试听、六种图标、自定义图标与两个内容开关 | 安装在日常 profile（按 Release 附件安装，产物哈希与仓库构建一致）；非无头环境。不证明系统横幅、点击回会话或免打扰 |

rc.2 完整 Web 检查使用隔离环境和无凭据回合。系统通知权限为 `denied`，因此只确认声音输出的 API 调用。远端 CI 结果见 [GitHub Actions](https://github.com/HOPE-LGNF/dsh-state-notifier/actions)。

## 待完成

| 编号 | 待完成事项 |
| --- | --- |
| N-08 | 在配置模型的环境确认“正常回答 → 任务完成提醒”；在 Git 兼容基线上完成完整 Web 检查 |
| N-09 | 在 Windows Edge 或 Chrome 确认五类弹窗、实际声音、点击返回会话及系统免打扰行为。维护者提供的截图已显示四类横幅（受阻、出错、回答、批准），点击回会话、实际声音与免打扰仍待确认 |
