# 神经衰弱 Cloudflare 联机 V4.1

本版专门修复 V4 部署时 Cloudflare 错误 10064：
旧版 Durable Object 类名为 `GameRoom`，因此本版继续导出并绑定 `GameRoom`，不会把现有 DO 类改名为 `Room`。

包含：
- 游戏中房主随时结束本局，返回准备阶段
- 卡牌所属角色使用下拉栏
- 玩家自行选择颜色，颜色不可重复
- 一对牌计分：普通 +1；角色规则普通 0、他人 +1、自己 -2
- 浏览器保存个人名称、颜色和最近的设置
- 首页/准备页规则说明
- 6 人 WebSocket 联机
- Durable Object 持久化房间状态
- 保留 `GameRoom`，兼容已有 Durable Object

部署：
1. 将这些文件覆盖 GitHub 仓库
2. Commit / Push
3. Cloudflare 自动部署
4. 不要删除 Worker 或 Durable Object
