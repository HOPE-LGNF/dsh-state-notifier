# 项目状态

更新日期：2026-10-04。以下是已有源码检查与兼容检查的最近结果，不代表对 `0.3.0` 发布包的重新验证。兼容基线见[调研](RESEARCH.md)，运行方法见[开发说明](../README.md#开发)和[浏览器检查](VALIDATION-browser.md)。

## 已有检查结果

| 检查 | 最近结果 | 范围 |
| --- | --- | --- |
| 构建与测试 | Node 22.23.3、24.18.0 各 112 项通过 | 本地 `npm run check` |
| Session 集成 | npm rc.2 与 Git 基线各 6 组通过 | Git 基线替换 Session 源码，其他依赖来自锁定 npm 包；不代表完整 Git 基线应用 |
| 浏览器夹具 | Chrome 151.0.7922.173 通过 | 五类输出、双标签去重、排队锁取消与卸载；不证明系统弹窗或声音可听 |
| 完整 rc.2 Web | Chromium 149.0.7827.55 通过 | 两个 UI 入口、连接、声音解锁、指定工作区、401/403/404 边界与真实错误音投递 |
| npm `0.2.1-alpha.1` | 上游记录 106 项测试及 Web 检查通过 | Web 覆盖认证、入口、连接与声音解锁；结果来自上游版本，当前脚本尚未在 alpha 重跑；[来源](https://github.com/HOPE-LGNF/dsh-state-notifier/blob/fedaec8445eb0e709a1f9228ae7c208d5debe008/docs/STATUS.md) |
| 插件安装版本门 | 上游确认拒绝 `0.1.7-rc.1`，接受 rc.2 与 alpha.1 | 使用真实插件包检查；[来源](https://github.com/HOPE-LGNF/dsh-state-notifier/blob/c91dae5c7a82637d6a61497055df5699298be56f/docs/STATUS.md#版本门的实测结论) |
| 打包 | 通过 | 包含宿主源码、浏览器产物、patch 和许可证 |

rc.2 完整 Web 检查使用隔离环境和无凭据回合。系统通知权限为 `denied`，因此只确认声音输出的 API 调用。远端检查结果见[上游 GitHub Actions](https://github.com/HOPE-LGNF/dsh-state-notifier/actions)。

## 待完成

| 编号 | 待完成事项 |
| --- | --- |
| N-08 | 在配置模型的环境确认“正常回答 → 任务完成提醒”；在 Git 兼容基线上完成完整 Web 检查 |
| N-09 | 在 Windows Edge 或 Chrome 确认五类弹窗、实际声音、点击返回会话及系统免打扰行为 |
