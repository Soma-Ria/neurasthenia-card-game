# 神经衰弱 Cloudflare 联机版 V3

真正的 1～6 人房间制 WebSocket 联机版本。

## 功能
- 创建房间 / 6位玩家上限
- 分享 `/room/XXXXXX` 邀请链接
- 玩家准备、房主开始
- 普通规则 / 角色卡牌规则
- 每组卡牌明确所属玩家
- 鬼牌、顺逆时针转动
- 服务器权威洗牌、翻牌、配对、计分、回合与结束判断
- Cloudflare Worker + Durable Object Hibernation WebSocket
- 玩家只需浏览器，无需安装任何东西

## 部署
推荐把仓库连接到 Cloudflare Workers，并使用本目录的 `wrangler.jsonc`。
如果使用本地 Wrangler：

```bash
npm install
npx wrangler login
npm run deploy
```

部署后，玩家直接打开 `https://你的项目.workers.dev/` 即可。

## 说明
游戏状态保存在 Durable Object 的 SQLite-backed storage 中；WebSocket 使用 Durable Object Hibernation API，以便空闲时释放内存。游戏中的所有关键操作由服务器验证，客户端不能自行决定分数或回合。
