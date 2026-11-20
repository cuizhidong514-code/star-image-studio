import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import {
  Client,
  GatewayIntentBits,
  Events,
  AttachmentBuilder,
  PermissionsBitField
} from "discord.js";
import sharp from "sharp";

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN?.trim();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();

if (!BOT_TOKEN || !OPENAI_API_KEY) {
  console.error("启动失败：请在部署平台环境变量中设置 DISCORD_BOT_TOKEN 和 OPENAI_API_KEY。");
  process.exit(1);
}

const ALLOWED_MODELS = new Set([
  "gpt-image-2.6-sunburst",
  "gpt-image-2.6-flare",
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare",
  "gpt-image-2",
  "gpt-image-1.5"
]);

const DEFAULT_MODEL = process.env.DEFAULT_IMAGE_MODEL || "gpt-image-2.6-sunburst";
if (!ALLOWED_MODELS.has(DEFAULT_MODEL)) {
  console.error(`DEFAULT_IMAGE_MODEL 不受支持：${DEFAULT_MODEL}`);
  process.exit(1);
}

const MAX_INPUT_BYTES = Math.max(1, Number(process.env.MAX_INPUT_MB || 20)) * 1024 * 1024;
const USER_COOLDOWN_MS = Math.max(0, Number(process.env.USER_COOLDOWN_SECONDS || 30)) * 1000;
const MAX_CONCURRENT = Math.max(1, Number(process.env.MAX_CONCURRENT_JOBS || 1));
const MAX_EDGE = Math.min(3840, Math.max(1024, Number(process.env.OUTPUT_MAX_EDGE || 3840)));
const MAX_PIXELS = Math.max(1024 * 1024, Number(process.env.OUTPUT_MAX_PIXELS || 8294400));
const QUALITY = process.env.IMAGE_QUALITY || "xhigh";
const COMPLEXITY = process.env.IMAGE_COMPLEXITY || "high";
const ALLOWED_GUILD_ID = process.env.ALLOWED_GUILD_ID?.trim();
const DATA_DIR = process.env.DATA_DIR || "./data";
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const ADMIN_USER_IDS = new Set(
  (process.env.ADMIN_USER_IDS || "").split(",").map((x) => x.trim()).filter(Boolean)
);

const MIME_BY_EXTENSION = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"]
]);
const SUPPORTED_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

const cooldowns = new Map();
const dailyCounts = new Map();
let activeJobs = 0;
let currentModel = DEFAULT_MODEL;

const DEFAULT_PROMPT = [
  "请直接编辑我上传的这张真实照片，而不是重新创作一张相似照片。",
  "首要要求：尽最大努力保留原人物身份与辨识度，包括脸型、五官位置和比例、眼睛、鼻子、嘴巴、年龄感、发型、肤色、表情和姿势；不得擅自换脸、改变人物身份或美化成另一个人。",
  "保持原照片的主体、服装、场景、构图和透视关系，除非用户明确要求修改。",
  "进行自然、真实、专业的照片修饰：合理调整曝光、白平衡、色彩、对比度、清晰度和噪点。",
  "如涉及人像，轻微修饰皮肤瑕疵和油光，保留自然皮肤纹理、毛孔与真实细节，禁止塑料感磨皮或过度锐化。",
  "不要自动添加文字、水印、装饰、虚构物体或额外人物。不要把真实照片转成动漫、插画或明显的AI艺术风格。",
  "尽量保持输入图像的长宽比和画面内容。"
].join("\n");

async function loadSettings() {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (ALLOWED_MODELS.has(parsed.model)) currentModel = parsed.model;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("读取模型设置失败，使用默认模型。");
    }
    currentModel = DEFAULT_MODEL;
  }
}

async function saveSettings() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = `${SETTINGS_FILE}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ model: currentModel }, null, 2), "utf8");
  await fs.rename(temp, SETTINGS_FILE);
}

function isAdmin(message) {
  return Boolean(
    ADMIN_USER_IDS.has(message.author.id) ||
    message.member?.permissions?.has(PermissionsBitField.Flags.ManageGuild)
  );
}

function getAttachmentMime(attachment) {
  const fromHeader = attachment.contentType?.split(";")[0]?.toLowerCase();
  if (SUPPORTED_MIME.has(fromHeader)) return fromHeader;
  const ext = path.extname(attachment.name || "").toLowerCase();
  return MIME_BY_EXTENSION.get(ext) || null;
}

function isImageAttachment(attachment) {
  return Boolean(getAttachmentMime(attachment));
}

function getModelFromCommand(content) {
  const prefix = "!星绘模型";
  return content.slice(prefix.length).trim();
}

function utcDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getSizeForImage(width, height) {
  // GPT Image 2.6 supports custom dimensions. Keep the original aspect ratio,
  // cap longest edge at 3840, and cap total pixels around an 8.3 MP 4K frame.
  const scale = Math.min(
    MAX_EDGE / Math.max(width, height),
    Math.sqrt(MAX_PIXELS / (width * height))
  );
  const outWidth = Math.max(16, Math.floor((width * scale) / 16) * 16);
  const outHeight = Math.max(16, Math.floor((height * scale) / 16) * 16);
  return `${outWidth}x${outHeight}`;
}

async function downloadDiscordAttachment(attachment) {
  let url;
  try {
    url = new URL(attachment.url);
  } catch {
    throw new Error("图片链接无效。");
  }

  const allowedHosts = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
  if (!allowedHosts.has(url.hostname)) {
    throw new Error("图片来源不是 Discord 附件链接，已拒绝下载。");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`从 Discord 下载图片失败（HTTP ${response.status}）。`);

    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (declaredLength > MAX_INPUT_BYTES) {
      throw new Error(`图片超过机器人限制（${Math.round(MAX_INPUT_BYTES / 1024 / 1024)}MB）。`);
    }

    const data = Buffer.from(await response.arrayBuffer());
    if (data.length > MAX_INPUT_BYTES) {
      throw new Error(`图片超过机器人限制（${Math.round(MAX_INPUT_BYTES / 1024 / 1024)}MB）。`);
    }
    if (data.length === 0) throw new Error("收到的图片文件是空的。");
    return data;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("下载图片超时，请重新上传。");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAIImageEdit(imageBuffer, filename, mimeType, prompt, model, outputSize) {
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("quality", QUALITY);
  form.append("complexity", COMPLEXITY);
  form.append("size", outputSize);
  form.append("output_format", "png");
  form.append("image", new Blob([imageBuffer], { type: mimeType }), filename);

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(240_000)
  });

  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`OpenAI API 返回了无法读取的响应（HTTP ${response.status}）。`);
  }

  if (!response.ok) {
    const apiMessage = body?.error?.message || `HTTP ${response.status}`;
    if (response.status === 401) throw new Error("OpenAI API Key 无效，请检查部署平台中的 OPENAI_API_KEY。");
    if (response.status === 403) throw new Error(`当前 API 项目没有模型访问权限：${apiMessage}`);
    if (response.status === 429) throw new Error(`API 额度不足、速率受限或账单未开通：${apiMessage}`);
    if (response.status === 400) throw new Error(`图片或参数不符合模型要求：${apiMessage}`);
    throw new Error(`OpenAI API 错误（${response.status}）：${apiMessage}`);
  }

  const encoded = body?.data?.[0]?.b64_json;
  if (!encoded) throw new Error("API 请求成功，但没有返回可用的图片数据。");
  return Buffer.from(encoded, "base64");
}

function isDiscordFileTooLarge(error) {
  const code = error?.code ?? error?.rawError?.code;
  const message = String(error?.message || "").toLowerCase();
  return code === 40005 || message.includes("too large") || message.includes("entity too large");
}

async function sendImageWithFallback(statusMessage, pngBuffer, model) {
  try {
    await statusMessage.edit({
      content: `✅ 星绘AI修图完成\n模型：${model}\n优先保留 PNG 原始输出。`,
      files: [new AttachmentBuilder(pngBuffer, { name: "xinghui-ai-edited.png" })]
    });
    return;
  } catch (error) {
    if (!isDiscordFileTooLarge(error)) throw error;
  }

  // Only compress when Discord refuses the original PNG because it is too large.
  for (const quality of [96, 93, 90, 86]) {
    const webpBuffer = await sharp(pngBuffer).webp({ quality, effort: 6 }).toBuffer();
    try {
      await statusMessage.edit({
        content: `✅ 星绘AI修图完成\n模型：${model}\n由于 Discord 附件大小限制，已自动转为高质量 WebP（${quality}%）。`,
        files: [new AttachmentBuilder(webpBuffer, { name: "xinghui-ai-edited.webp" })]
      });
      return;
    } catch (error) {
      if (!isDiscordFileTooLarge(error)) throw error;
    }
  }

  throw new Error("修图已生成，但图片仍超过 Discord 允许的附件大小。请调低输出分辨率或提高服务器附件限制。");
}

async function handleHelp(message) {
  await message.reply([
    "**星绘AI 使用说明**",
    "直接上传一张 PNG/JPG/WEBP 照片即可自动修图。",
    "上传照片时附带文字，可指定修图要求；不附文字则执行默认自然修图。",
    "`!星绘状态` 查看机器人和当前模型。",
    "`!星绘模型` 查看可选 GPT Image 型号。",
    "`!星绘模型 gpt-image-2.6-flare` 管理员切换模型。",
    "注意：每条消息只处理第一张图片。"
  ].join("\n"));
}

async function processImageMessage(message, attachment) {
  if (activeJobs >= MAX_CONCURRENT) {
    await message.reply("星绘AI现在正在处理其他照片，请稍后再上传，避免重复请求。");
    return;
  }

  const now = Date.now();
  const last = cooldowns.get(message.author.id) || 0;
  if (now - last < USER_COOLDOWN_MS) {
    const seconds = Math.ceil((USER_COOLDOWN_MS - (now - last)) / 1000);
    await message.reply(`请间隔约 ${seconds} 秒再提交下一张照片。`);
    return;
  }

  const dayKey = `${utcDayKey()}:${message.author.id}`;
  const count = dailyCounts.get(dayKey) || 0;
  const dailyLimit = Math.max(1, Number(process.env.USER_DAILY_LIMIT || 20));
  if (count >= dailyLimit) {
    await message.reply(`今天已达到每人 ${dailyLimit} 次的机器人保护上限。`);
    return;
  }

  const mimeType = getAttachmentMime(attachment);
  if (!mimeType) {
    await message.reply("目前只支持 PNG、JPG/JPEG 和 WEBP 图片。");
    return;
  }
  if (attachment.size > MAX_INPUT_BYTES) {
    await message.reply(`这张图片超过机器人输入限制（${Math.round(MAX_INPUT_BYTES / 1024 / 1024)}MB）。`);
    return;
  }

  cooldowns.set(message.author.id, now);
  dailyCounts.set(dayKey, count + 1);
  activeJobs += 1;

  const statusMessage = await message.reply("📷 收到照片，星绘AI正在调用 GPT 图像模型进行修图……");
  try {
    await message.channel.sendTyping().catch(() => {});
    let inputBuffer = await downloadDiscordAttachment(attachment);

    // Apply EXIF orientation before sending the source photo to the image API.
    inputBuffer = await sharp(inputBuffer).rotate().toBuffer();
    const metadata = await sharp(inputBuffer).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("无法读取图片尺寸，请换成标准 JPG、PNG 或 WEBP 文件。");
    }

    const promptText = message.content
      .replace(/https?:\/\/\S+/g, "")
      .trim()
      .slice(0, 8000);
    const prompt = promptText
      ? `${DEFAULT_PROMPT}\n\n用户额外修图要求：\n${promptText}`
      : DEFAULT_PROMPT;

    const size = getSizeForImage(metadata.width, metadata.height);
    const imageBuffer = await callOpenAIImageEdit(
      inputBuffer,
      attachment.name || "input-image",
      mimeType,
      prompt,
      currentModel,
      size
    );

    await sendImageWithFallback(statusMessage, imageBuffer, currentModel);
  } catch (error) {
    console.error("修图任务失败：", error?.message || "unknown error");
    const msg = error?.message || "未知错误";
    await statusMessage.edit({
      content: `❌ 这次修图没有成功：${msg}\n请检查模型权限、API额度和机器人频道权限。`
    }).catch(() => {});
  } finally {
    activeJobs = Math.max(0, activeJobs - 1);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`星绘AI已上线：${readyClient.user.tag}`);
  console.log(`当前图像模型：${currentModel}`);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot || !message.guild) return;
    if (ALLOWED_GUILD_ID && message.guild.id !== ALLOWED_GUILD_ID) return;

    const content = message.content.trim();

    if (content === "!星绘帮助") {
      await handleHelp(message);
      return;
    }

    if (content === "!星绘状态") {
      await message.reply(`星绘AI运行正常。\n当前模型：${currentModel}\n正在处理任务：${activeJobs}/${MAX_CONCURRENT}`);
      return;
    }

    if (content === "!星绘模型" || content.startsWith("!星绘模型 ")) {
      if (!isAdmin(message)) {
        await message.reply("只有服务器管理员可以切换模型。");
        return;
      }
      const requested = getModelFromCommand(content);
      if (!requested) {
        await message.reply(
          `当前模型：${currentModel}\n可选型号：\n${[...ALLOWED_MODELS].map((m) => `• ${m}`).join("\n")}\n切换示例：\`!星绘模型 gpt-image-2.6-flare\``
        );
        return;
      }
      if (!ALLOWED_MODELS.has(requested)) {
        await message.reply("不支持这个型号。输入 `!星绘模型` 查看可选型号。");
        return;
      }
      currentModel = requested;
      await saveSettings();
      await message.reply(`✅ 已切换图像模型：${currentModel}`);
      return;
    }

    const imageAttachments = [...message.attachments.values()].filter(isImageAttachment);
    if (imageAttachments.length === 0) return;

    if (imageAttachments.length > 1) {
      await message.reply("我检测到多张图片。为避免一次产生多笔费用，本版每条消息只处理第一张。");
    }
    await processImageMessage(message, imageAttachments[0]);
  } catch (error) {
    console.error("消息处理错误：", error?.message || "unknown error");
    await message.reply("星绘AI处理这条消息时遇到错误，请稍后重试。").catch(() => {});
  }
});

await loadSettings();
client.login(BOT_TOKEN);
