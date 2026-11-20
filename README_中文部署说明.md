# 星绘AI Discord GPT 图片修图机器人 v2.0

这是专门用于 Discord 图片编辑的项目，不是“只生成新图”的演示机器人。

## 功能

- 用户在服务器频道上传 PNG/JPG/WEBP，机器人自动处理。
- 上传时可在消息文字里写中文修图要求；不写时使用默认自然修图要求。
- 默认使用 `gpt-image-2.6-sunburst`。
- 管理员可在 Discord 中输入 `!星绘模型` 查看型号，或输入 `!星绘模型 gpt-image-2.6-flare` 切换型号。
- 支持模型：`gpt-image-2.6-sunburst`、`gpt-image-2.6-flare`、`gpt-image-2.5-sunburst`、`gpt-image-2.5-flare`、`gpt-image-2`、`gpt-image-1.5`。
- 默认输入限制20MB。输出优先发送PNG；如 Discord 上传大小限制拒绝，再自动尝试高质量WebP压缩。
- 内置用户冷却与并发限制，降低意外重复扣费。
- 不把图片长期保存到机器人目录；图片只在处理时暂存于内存。

## 重要前提

1. 需要 Discord Bot Token。
2. 需要 OpenAI API Key，并且 API 项目已开通计费、拥有所选模型权限。
3. ChatGPT Plus/Pro 等订阅不等于 API 额度。
4. 模型会生成式编辑照片，不能承诺每次百分之百保留原人物长相。
5. 4K尺寸是尽力申请的输出尺寸；高分辨率 API 请求可能被模型/账户限制拒绝，也可能耗时更长、费用更高。
6. 机器人程序必须部署在持续运行的服务器上。仅下载或解压 ZIP 不会自动上线。

## Discord 必须设置的权限

在 Discord Developer Portal 打开你的应用：

- Bot -> Privileged Gateway Intents -> 开启 **Message Content Intent**。
- 服务器频道权限至少需要：View Channels、Send Messages、Read Message History、Attach Files。
- 机器人需要在允许的频道中可见且有发送文件权限。

不要把 Bot Token 或 API Key 放到 Discord 聊天、截图或公开仓库里。

## 本地/云端运行

需要 Node.js 20.11 或更新版本。

1. 解压项目。
2. 复制 `.env.example` 并改名为 `.env`。
3. 在 `.env` 填入：
   - `DISCORD_BOT_TOKEN=...`
   - `OPENAI_API_KEY=...`
4. 安装依赖：`npm install`
5. 启动：`npm start`

也可使用 Docker：
`docker build -t xinghui-ai .`
`docker run --env-file .env -v ./data:/app/data xinghui-ai`

## Discord 使用方法

- 上传一张照片，不写文字：默认自然修图。
- 上传一张照片，同时在消息文字里写要求：按你的要求编辑。
- `!星绘帮助`：查看帮助。
- `!星绘状态`：查看机器人状态和当前模型。
- `!星绘模型`：查看支持的 GPT Image 型号。
- `!星绘模型 gpt-image-2.6-flare`：管理员切换当前模型。

一条消息只处理第一张图片。机器人不处理私信。

## 关于4K和画质

默认按输入图片比例计算目标尺寸，最长边最多3840像素，目标总像素约8.3MP。3840边长属于高分辨率/实验性范围，是否能成功取决于模型实际限制。机器人优先以PNG发送；只有 Discord 拒绝较大的文件时才尝试WebP高质量压缩。生成式修图本身不等于像素级无损放大。

## 部署成本

Railway 免费计划页面当前列出每月 $1 使用额度；持续运行的机器人可能超过免费额度。Railway Hobby 当前最低用量为每月 $5。OpenAI 图片 API 调用费用另计。不要在没有设置用量限额时把机器人开放给所有人。

## 故障排查

- Bot 在线但不处理图片：检查 Message Content Intent 和频道权限。
- 401：OpenAI API Key 无效。
- 403：模型权限/组织验证/项目权限不足。
- 429：API额度、计费或速率限制。
- 输出文件发不回：检查服务器附件大小限制；机器人会尝试WebP压缩。
- Railway 重启后模型设置恢复默认：给 `/app/data` 挂载持久化 Volume。

## 安全建议

- API Key 与 Bot Token 只放在宿主的环境变量/Secrets 中。
- 不要把 `.env` 上传到 GitHub。
- 先只允许自己的 Discord 账号测试，再开放给其他成员。
- 在 OpenAI API 项目中设置可承受的预算和用量提醒。
