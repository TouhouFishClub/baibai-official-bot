# 数据库功能迁移清单

主服务不直接连接数据库。老服务器 `legacy-data-bridge/` 仅提供加密、白名单化的只读查询；下列写入和采集能力仍待迁移。

## 洛奇电视：`mbtv`、`mbcd`

- 原实现：`baibaibot/ai/mabinogi/Television/`
- 原数据：`cl_mbtv_*`、`cl_mbcd_*`、`cl_mabinogi_user_server`
- 已完成：通过加密桥接查询 `cl_mbtv_*`、`cl_mbcd_*`，新服务器本地筛选展示；支持读取原用户选服记录。
- 待完成：桥接为只读，显式服务器前缀不会写回用户偏好；实时采集仍由旧 bot 负责。
- 验收待办：迁移 mabiPusher 写入、服务器偏好更新、保留期和数据源可信度审计。

## 日历与菜单

- 原实现：`baibaibot/ai/calendar.js`、`baibaibot/ai/menu.js`
- 原数据：`cl_calendar*`、`cl_menu`
- 后续方案：先定义权限和 schema，再迁入本地数据库；禁止把管理写操作暴露给普通用户。
- 验收：查询、添加、修改、删除、并发更新及权限测试全部通过。

## 抽卡与蛋池

- 原实现：`baibaibot/ai/mabinogi/gacha/`
- 原数据：`cl_mabinogi_gacha_info`、`cl_mabinogi_gacha`
- 后续方案：将只读蛋池快照与个人记录分离；移除页面脚本 `eval`，为数据源做签名或 schema 校验。
- 验收：固定随机种子测试、池更新回滚、用户记录隔离及数据源异常降级。

## 走私

- 原实现：`baibaibot/ai/mabinogi/smuggler/`
- 原数据：`cl_mabinogi_smuggler`
- 已完成：只读桥接返回国服观测和已有韩服预测，新服务器本地生成展示。
- 待完成：韩服拉取调度器仍由旧 bot 运行；迁移时必须改为显式启动任务。
- 验收待办：任务可启停、去重、过期清理及外部超时测试。

## DPS / mblogs

- 原实现：`baibaibot/ai/mabinogi/logs/`
- 原数据：`cl_mabinogi_dps_*` 集合及 `mabidata/logs` 文件目录。
- 已完成：mblogs 公开排行通过只读桥接查询；老服务器在返回前强制应用公开/匿名同意并脱敏。
- 待完成：DPS 上传、单场详情、技能占比、AI 分析、文件保留、删除请求和备份恢复仍由旧系统负责。
- 验收待办：上传限流、签名、防重放、备份恢复和删除请求。

## mabiPusher

- 原实现：`baibaibot/ai/mabinogi/mabiPusher.js`
- 原数据：`cl_mabinogi_pusher` 及电视/走私动态集合。
- 当前状态：本次桥接明确不接管写入，旧 bot 继续采集电视和走私数据。
- 后续方案：定义独立受认证事件格式，不复用只读查询接口。
- 验收：鉴权、幂等、重放保护、失败重试和审计记录。

## 释放卷国服出处

- 原实现：`baibaibot/ai/mabinogi/tools/optionsetWhere.js`
- 原数据：`cl_mabinogi_optionset`
- 已完成：单卷国服出处和 `optw` 反向查询通过只读加密桥接提供。
- 待完成：管理员维护仍禁用；后续优先实现经过审计和可回滚的只读快照。
- 验收待办：管理员维护权限、快照版本和回滚。

所有后续实现必须继续满足：无硬编码凭证、无模块加载副作用、可在数据库不可用时启动。
