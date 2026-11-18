# 星绘 AI 修图师（Discord）

这是 Railway 长驻运行的 Discord Gateway 机器人。**启动入口在项目根目录 `index.js`**，`package.json` 的启动命令是 `node index.js`，不会再查找不存在的 `src/index.js`。

## Railway Variables

在 Railway 服务的 Variables 中逐项添加：

- `DISCORD_TOKEN`：Discord Bot Token（不要公开）
- `DISCORD_CLIENT_ID`：Discord 应用 ID
- `DISCORD_GUILD_ID`：目标 Discord 服务器 ID（建议先填，命令会立即注册到该服务器）
- `OPENAI_API_KEY`：OpenAI API Key（不要公开）
- `OPENAI_IMAGE_MODEL`：`gpt-image-2.6-sunburst`
- `AUTO_EDIT`：`false`（默认关闭自动模式，避免频道里有人发图就意外产生费用）
- `DATA_DIR`：`/data`
- `MAX_IMAGE_MB`：`15`
- `USER_COOLDOWN_SECONDS`：`30`

## Railway 持久化档案

如果希望人物档案在重新部署后仍保留，请在 Railway 给服务添加 Volume，并将 Mount Path 设为 `/data`。否则容器本地文件可能在重新部署后丢失。

## Discord Bot 设置

在 Discord Developer Portal 的 Bot 页面启用 **MESSAGE CONTENT INTENT**，仅在你要开启 `AUTO_EDIT=true` 自动处理频道图片时需要。Slash 命令 `/edit` 不依赖自动监听频道消息。

## Commands

- `/edit photo instruction profile`：上传照片修图；instruction 可写本次要求，profile 可填人物档案名。
- `/remember profile preference`：保存一个人物档案偏好。
- `/profile name`：查看档案；不填 name 列出档案名。
- `/forget profile`：删除人物档案。

## 注意

- 图片编辑通过 `POST https://api.openai.com/v1/images/edits` 调用 GPT Image。
- API 按实际模型用量收费；请勿把 API Key 或 Bot Token 发到聊天、GitHub 或截图中。
- 模型会尽量保持人物身份特征，但无法保证每个细节完全不变。重要照片请检查成片。
- 自动模式默认关闭。确认机器人稳定、费用可接受后，再考虑把 `AUTO_EDIT` 改成 `true`。
