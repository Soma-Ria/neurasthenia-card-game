# 神经衰弱 Cloudflare 联机 V4

本版包含：
- 房主可随时结束本局并返回准备阶段
- 卡牌配置表格 + 所属角色下拉选择
- 玩家自行选择颜色，服务器保证不重复
- 计分按“一对牌”计算：普通 +1；角色规则普通 0、他人 +1、自己 -2
- 浏览器 localStorage 保存个人上次设置
- 首页和准备页均显示规则
- Cloudflare Worker + Durable Object + WebSocket
- 最多 6 人

部署：
`npm install`
`npx wrangler deploy`

也可使用 Cloudflare Dashboard + GitHub 自动部署。
