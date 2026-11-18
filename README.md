# 星绘 AI 修图师（Discord 机器人）

这是一个供 Railway 部署的 Node.js Discord Gateway 机器人基础版本。

## 已实现
- `/retouch`：上传照片并输入修图要求，调用 `gpt-image-2.6-sunburst` 编辑原图。
- `/remember`：保存个人默认偏好，或按 `profile` 名称保存人物档案。
- `/profiles`：查看人物档案名称。
- `/forget`：删除一个人物档案，或清空个人默认偏好。
- 默认提示词强调尽可能保留原人物身份、五官特征和自然皮肤质感。
- 可选自动修图：消息包含 `#修图` 且附带图片时触发，默认关闭以防误触和意外 API 费用。

## Railway 环境变量
在服务的 Variables 中逐项添加：
- `DISCORD_BOT_TOKEN`：Discord Bot Token
- `DISCORD_CLIENT_ID`：Discord Application ID
- `DISCORD_GUILD_ID`：你的服务器 ID（建议先用服务器级命令，注册更快）
- `OPENAI_API_KEY`：OpenAI API Key
- `OPENAI_IMAGE_MODEL`：`gpt-image-2.6-sunburst`
- `DATA_DIR`：`/data`
- `MAX_IMAGE_MB`：`18`
- `AUTO_RETOUCH`：先设为 `false`

不要把密钥写进代码或上传到 GitHub，也不要发给任何人。

## 持久化记忆
在 Railway 为服务添加 Volume，并将挂载路径设为 `/data`。人物档案和偏好保存在 `/data/preferences.json`。不配置 Volume 时，重新部署可能丢失这些偏好。

## Discord 设置
Bot 需要 `applications.commands` scope，以及在服务器中使用命令的权限。
先使用 `/retouch` 斜杠命令，不需要开启 Message Content Intent。
若要启用自动模式：
1. 在 Discord Developer Portal → Bot 中开启 **Message Content Intent**。
2. 在 Railway Variables 将 `AUTO_RETOUCH` 改为 `true`。
3. 自动模式仅处理包含 `#修图` 的图片消息，以免普通图片上传意外产生费用。

## 运行
Node.js 20 或更高版本：
```bash
npm install
npm start
```

## 重要说明
- GPT Image 修图会尽量遵守保留人物长相的要求，但任何生成式模型都不能保证每次完全一致。
- 每次修图都会产生 OpenAI API 用量费用；请先用少量测试。
- 这个版本尚未加入计费系统、队列、用户额度、管理员后台或照片长期存储。
- 用户照片只在请求处理期间读取，不写入本地持久化档案。
