# 神经衰弱 Cloudflare 联机 V5.8 - 房主观战版

基于 V5.8，新增：房主可以把自己设置为观战玩家。房主进入观战后仍保留房主权限，可以管理房间、玩家权限和游戏设置。

部署：覆盖 GitHub 仓库后让 Cloudflare Worker 重新部署。不要删除现有 GameRoom Durable Object，也不要修改已有 migration。
