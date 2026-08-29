# 神经衰弱 Cloudflare 联机 V5.1

- 鬼牌触发后所有场上牌重新洗牌，未配对牌重新盖回。
- 直接打开 `/room/房间号` 显示游戏页面，不再看到 GameRoom；随后连接 `/room/房间号/ws`。
- 准备按钮明确显示已准备/未准备。
- 主动退出立即移除；刷新/短断线保留 15 秒，允许自动重连。
- 刷新房间 URL 自动重新加入。
- 保留 GameRoom Durable Object 类名，避免 10064。
- 16 种颜色、批量添加、角色颜色和计分等 V5 功能。

部署时覆盖 GitHub 仓库即可，不要删除现有 Worker 或 GameRoom Durable Object。
