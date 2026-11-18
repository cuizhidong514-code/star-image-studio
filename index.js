import "dotenv/config";
import {
  Client, GatewayIntentBits, REST, Routes, AttachmentBuilder,
  Events
} from "discord.js";
import OpenAI, { toFile } from "openai";
import { commandData } from "./commands.js";
import { loadStore, addNote, getNotes, listProfiles, forgetNotes } from "./storage.js";

const required = ["DISCORD_BOT_TOKEN", "DISCORD_CLIENT_ID", "OPENAI_API_KEY"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`缺少环境变量 ${key}。请在 Railway → Variables 中设置。`);
    process.exit(1);
  }
}

const MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.6-sunburst";
const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_MB || 18) * 1024 * 1024;
const AUTO_RETOUCH = (process.env.AUTO_RETOUCH || "false").toLowerCase() === "true";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    ...(AUTO_RETOUCH ? [GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] : [])
  ]
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const basePrompt = [
  "你是一名专业、谨慎的照片修图师。请直接编辑用户上传的原照片，而不是重新创作一张相似照片。",
  "最高优先级：尽可能保留原人物真实身份和可辨认的面部特征，包括脸型、五官比例、眼睛、鼻子、嘴巴、年龄感、肤色和自然表情。",
  "除非用户明确要求，不要改变人物身份、性别表达、年龄、发型、服装、身体比例或姿势；不要擅自增加人物或物体。",
  "默认追求自然、真实、不过度磨皮、不塑料脸。保留皮肤纹理和照片原有构图。",
  "只实施用户明确提出的修改；未提及的区域尽量保持不变。"
].join("\n");

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_BOT_TOKEN);
  const route = process.env.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DISCORD_GUILD_ID)
    : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);
  await rest.put(route, { body: commandData });
  console.log("Discord 斜杠命令已注册。");
}

function isImageAttachment(att) {
  const type = (att.contentType || "").toLowerCase();
  return type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(att.name || "");
}

async function editPhoto(attachment, instruction, userId, profileName) {
  if (!isImageAttachment(attachment)) throw new Error("请上传 PNG、JPG 或 WEBP 格式的照片。");
  if (attachment.size > MAX_IMAGE_BYTES) throw new Error(`照片太大，请压缩到 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB 以内。`);

  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error("无法读取 Discord 图片，请重新上传。");
  const buffer = Buffer.from(await response.arrayBuffer());

  const notes = getNotes(userId, profileName);
  const memory = [...notes.defaults, ...notes.profile].map(x => `- ${x}`).join("\n");
  const prompt = [
    basePrompt,
    memory ? `用户保存的修图偏好/人物档案（请遵守）：\n${memory}` : "",
    `本次修图要求：${instruction?.trim() || "在保持人物身份和原始画面特征的前提下，进行自然、轻度、专业的整体优化。"}`
  ].filter(Boolean).join("\n\n");

  const file = await toFile(buffer, attachment.name || "photo.jpg", {
    type: attachment.contentType || "image/jpeg"
  });
  const result = await openai.images.edit({
    model: MODEL,
    image: file,
    prompt,
    size: "auto",
    quality: "high"
  });

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error("模型没有返回图片，请稍后重试。");
  return Buffer.from(b64, "base64");
}

client.once(Events.ClientReady, c => {
  console.log(`星绘 AI 修图师已上线：${c.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand()) return;
  const uid = interaction.user.id;

  try {
    if (interaction.commandName === "remember") {
      const note = interaction.options.getString("note", true);
      const profile = interaction.options.getString("profile");
      await addNote(uid, profile, note);
      await interaction.reply({
        content: profile ? `已保存到人物档案「${profile}」。` : "已保存为你的个人默认修图偏好。",
        ephemeral: true
      });
      return;
    }
    if (interaction.commandName === "profiles") {
      const names = listProfiles(uid);
      await interaction.reply({
        content: names.length ? `你的人物档案：${names.map(n => `「${n}」`).join("、")}` : "目前还没有人物档案。使用 /remember 并填写 profile 名称即可建立。",
        ephemeral: true
      });
      return;
    }
    if (interaction.commandName === "forget") {
      const profile = interaction.options.getString("profile");
      await forgetNotes(uid, profile);
      await interaction.reply({
        content: profile ? `已删除人物档案「${profile}」中的偏好。` : "已清空你的个人默认修图偏好。",
        ephemeral: true
      });
      return;
    }
    if (interaction.commandName === "retouch") {
      const photo = interaction.options.getAttachment("photo", true);
      const instruction = interaction.options.getString("instruction") || "";
      const profile = interaction.options.getString("profile");
      await interaction.deferReply();
      await interaction.editReply("收到照片，正在修图。模型处理可能需要一些时间，请稍候……");
      const output = await editPhoto(photo, instruction, uid, profile);
      const file = new AttachmentBuilder(output, { name: "star-retouched.png" });
      await interaction.editReply({
        content: "修图完成。请检查结果；AI 修图无法保证每次都完全保留原貌。",
        files: [file]
      });
    }
  } catch (err) {
    console.error("处理命令失败：", err);
    const message = err?.status === 401
      ? "OpenAI API Key 无效或无权使用该模型，请检查 Railway 环境变量。"
      : err?.status === 429
        ? "API 使用额度或速率限制已达到，请检查 API 账户额度后再试。"
        : (err.message || "发生未知错误，请稍后重试。").slice(0, 1500);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: `修图失败：${message}`, files: [] }).catch(() => {});
    } else {
      await interaction.reply({ content: `操作失败：${message}`, ephemeral: true }).catch(() => {});
    }
  }
});

if (AUTO_RETOUCH) {
  client.on(Events.MessageCreate, async message => {
    if (message.author.bot || !message.guild || !message.content.includes("#修图")) return;
    const photo = message.attachments.find(isImageAttachment);
    if (!photo) return;
    try {
      const status = await message.reply("收到自动修图请求，正在处理……");
      const output = await editPhoto(photo, message.content.replace("#修图", "").trim(), message.author.id, null);
      await status.edit({ content: "自动修图完成。", files: [new AttachmentBuilder(output, { name: "star-retouched.png" })] });
    } catch (err) {
      console.error("自动修图失败：", err);
      await message.reply(`自动修图失败：${(err.message || "请稍后重试。").slice(0, 1000)}`).catch(() => {});
    }
  });
}

await loadStore();
await registerCommands();
await client.login(process.env.DISCORD_BOT_TOKEN);
