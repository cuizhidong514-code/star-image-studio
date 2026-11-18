'use strict';

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  AttachmentBuilder,
  MessageFlags
} = require('discord.js');
const fs = require('node:fs/promises');
const path = require('node:path');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2.6-sunburst';
const AUTO_EDIT = String(process.env.AUTO_EDIT || 'false').toLowerCase() === 'true';
const DATA_DIR = process.env.DATA_DIR || './data';
const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_MB || 15) * 1024 * 1024;
const COOLDOWN_MS = Number(process.env.USER_COOLDOWN_SECONDS || 30) * 1000;
const STORE_FILE = path.join(DATA_DIR, 'profiles.json');

if (!DISCORD_TOKEN || !CLIENT_ID || !OPENAI_API_KEY) {
  console.error('缺少环境变量：DISCORD_TOKEN、DISCORD_CLIENT_ID、OPENAI_API_KEY。请在 Railway 的 Variables 中设置。');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('edit')
    .setDescription('上传照片并进行 AI 修图')
    .addAttachmentOption(o => o.setName('photo').setDescription('要修的照片').setRequired(true))
    .addStringOption(o => o.setName('instruction').setDescription('修图要求，例如自然美颜、清晰、换背景').setRequired(false))
    .addStringOption(o => o.setName('profile').setDescription('人物档案名称，可选').setRequired(false)),
  new SlashCommandBuilder()
    .setName('remember')
    .setDescription('记住某个人物的修图偏好')
    .addStringOption(o => o.setName('profile').setDescription('人物档案名称，例如本人、妈妈、朋友A').setRequired(true))
    .addStringOption(o => o.setName('preference').setDescription('要记住的偏好，例如保留脸型、自然肤质').setRequired(true)),
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('查看你的人物修图档案')
    .addStringOption(o => o.setName('name').setDescription('档案名称；不填则列出所有档案').setRequired(false)),
  new SlashCommandBuilder()
    .setName('forget')
    .setDescription('删除指定人物档案')
    .addStringOption(o => o.setName('profile').setDescription('要删除的档案名称').setRequired(true))
].map(c => c.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const cooldowns = new Map();
let store = { users: {} };

async function loadStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    store = JSON.parse(await fs.readFile(STORE_FILE, 'utf8'));
    if (!store || typeof store !== 'object' || !store.users) store = { users: {} };
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('读取档案文件失败，将创建新档案文件：', e.message);
    store = { users: {} };
  }
}
async function saveStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const temp = STORE_FILE + '.tmp';
  await fs.writeFile(temp, JSON.stringify(store, null, 2), 'utf8');
  await fs.rename(temp, STORE_FILE);
}
function userProfiles(userId) {
  if (!store.users[userId]) store.users[userId] = {};
  return store.users[userId];
}
function cleanName(value) { return String(value || '').trim().slice(0, 40); }
function getProfileText(userId, name) {
  const profiles = userProfiles(userId);
  const item = profiles[name];
  return item && Array.isArray(item.preferences) ? item.preferences.join('；') : '';
}
function makePrompt(instruction, profileText) {
  const base = '请对用户上传的原始照片进行真实、自然的照片修饰，而不是重新创作一张不同的人物照片。最高优先级：尽最大可能保持原人物身份与可辨认特征，包括脸型、五官比例、眼睛、鼻子、嘴巴、年龄感、发型和表情；不要擅自换脸、改变身份、过度磨皮或把人物变成网红脸。保留真实皮肤纹理和自然光影。除非用户明确要求，否则不要改变人物姿势、服装、构图或背景。只实施用户明确提出的修改，输出高质量成片。';
  const profile = profileText ? `人物档案偏好：${profileText}。` : '';
  const request = instruction ? `本次修图要求：${instruction}。` : '本次要求：进行适度、自然的整体优化，改善曝光、色彩、清晰度和轻微瑕疵，不改变人物身份。';
  return `${base}\n${profile}\n${request}`;
}
function safeFilename(name, fallback = 'edited-photo.png') {
  const ext = path.extname(name || '').toLowerCase();
  const allowed = ['.png', '.jpg', '.jpeg', '.webp'];
  return `star-edited${allowed.includes(ext) ? ext : fallback.endsWith('.png') ? '.png' : '.jpg'}`;
}

async function editImage(attachment, prompt) {
  if (!attachment.contentType || !/^image\/(png|jpeg|webp)$/.test(attachment.contentType)) {
    throw new Error('目前只支持 PNG、JPG/JPEG、WebP 图片。');
  }
  if (attachment.size > MAX_IMAGE_BYTES) {
    throw new Error(`图片太大，请压缩到 ${Math.floor(MAX_IMAGE_BYTES / 1024 / 1024)} MB 以内再上传。`);
  }
  const download = await fetch(attachment.url);
  if (!download.ok) throw new Error('下载 Discord 图片失败，请重新上传。');
  const bytes = Buffer.from(await download.arrayBuffer());
  const form = new FormData();
  form.append('model', IMAGE_MODEL);
  form.append('prompt', prompt);
  form.append('quality', 'high');
  form.append('size', 'auto');
  form.append('output_format', 'png');
  form.append('complexity', 'high');
  form.append('image[]', new Blob([bytes], { type: attachment.contentType }), attachment.name || 'input-image');

  const response = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result?.error?.message || `OpenAI API 请求失败（HTTP ${response.status}）`;
    throw new Error(message.slice(0, 700));
  }
  const b64 = result?.data?.[0]?.b64_json;
  if (!b64) throw new Error('模型没有返回图片，请稍后重试。');
  return Buffer.from(b64, 'base64');
}

async function handleEdit(interaction, attachment, instruction, profileName) {
  const now = Date.now();
  const previous = cooldowns.get(interaction.user.id) || 0;
  if (now - previous < COOLDOWN_MS) {
    const seconds = Math.ceil((COOLDOWN_MS - (now - previous)) / 1000);
    const msg = `请稍等 ${seconds} 秒再进行下一次修图，避免重复扣费。`;
    if (interaction.deferred || interaction.replied) return interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
    return interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
  }
  cooldowns.set(interaction.user.id, now);
  await interaction.deferReply();
  try {
    const name = cleanName(profileName);
    const prefs = name ? getProfileText(interaction.user.id, name) : '';
    const prompt = makePrompt(instruction, prefs);
    const output = await editImage(attachment, prompt);
    const file = new AttachmentBuilder(output, { name: 'star-edited.png' });
    await interaction.editReply({ content: '修图完成。请检查成片；AI 可能仍会对细节产生变化，重要照片请与原图对照。', files: [file] });
  } catch (error) {
    console.error('修图失败：', error);
    await interaction.editReply(`修图失败：${error.message}\n如果提示组织验证或权限问题，请先检查 OpenAI API 账户的图像模型访问权限。`);
  }
}

client.once('ready', () => {
  console.log(`星绘 AI 修图师已上线：${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  try {
    if (interaction.commandName === 'edit') {
      const photo = interaction.options.getAttachment('photo', true);
      const instruction = interaction.options.getString('instruction') || '';
      const profile = interaction.options.getString('profile') || '';
      return await handleEdit(interaction, photo, instruction, profile);
    }
    if (interaction.commandName === 'remember') {
      const name = cleanName(interaction.options.getString('profile', true));
      const preference = interaction.options.getString('preference', true).trim().slice(0, 500);
      if (!name || !preference) return interaction.reply({ content: '档案名称和偏好内容不能为空。', flags: MessageFlags.Ephemeral });
      const profiles = userProfiles(interaction.user.id);
      if (!profiles[name]) profiles[name] = { preferences: [] };
      profiles[name].preferences.push(preference);
      profiles[name].preferences = [...new Set(profiles[name].preferences)].slice(-20);
      await saveStore();
      return interaction.reply({ content: `已保存「${name}」的人物偏好。以后修图时在 /edit 的 profile 栏填写这个名称即可调用。`, flags: MessageFlags.Ephemeral });
    }
    if (interaction.commandName === 'profile') {
      const name = cleanName(interaction.options.getString('name'));
      const profiles = userProfiles(interaction.user.id);
      if (name) {
        const text = getProfileText(interaction.user.id, name);
        return interaction.reply({ content: text ? `**${name}**：${text}` : `没有找到「${name}」档案。`, flags: MessageFlags.Ephemeral });
      }
      const names = Object.keys(profiles);
      return interaction.reply({ content: names.length ? `你的档案：\n${names.map(n => `• ${n}`).join('\n')}` : '你还没有人物档案。使用 /remember 创建。', flags: MessageFlags.Ephemeral });
    }
    if (interaction.commandName === 'forget') {
      const name = cleanName(interaction.options.getString('profile', true));
      const profiles = userProfiles(interaction.user.id);
      if (!profiles[name]) return interaction.reply({ content: `没有找到「${name}」档案。`, flags: MessageFlags.Ephemeral });
      delete profiles[name];
      await saveStore();
      return interaction.reply({ content: `已删除「${name}」档案。`, flags: MessageFlags.Ephemeral });
    }
  } catch (error) {
    console.error('命令处理失败：', error);
    const msg = '命令处理时出错，请稍后重试。';
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
    else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

// 可选自动模式：仅当 AUTO_EDIT=true 时，才处理频道里直接发送的图片；默认关闭以避免意外 API 费用。
client.on('messageCreate', async message => {
  if (!AUTO_EDIT || message.author.bot || !message.guild) return;
  const image = message.attachments.find(a => a.contentType && /^image\/(png|jpeg|webp)$/.test(a.contentType));
  if (!image) return;
  const now = Date.now();
  const previous = cooldowns.get(message.author.id) || 0;
  if (now - previous < COOLDOWN_MS) return;
  cooldowns.set(message.author.id, now);
  const status = await message.reply('收到照片，正在修图…').catch(() => null);
  if (!status) return;
  try {
    const output = await editImage(image, makePrompt(message.content || '', ''));
    await status.edit({ content: '修图完成。AI 可能会改变部分细节，请检查后再使用。', files: [new AttachmentBuilder(output, { name: 'star-edited.png' })] });
  } catch (error) {
    console.error('自动修图失败：', error);
    await status.edit(`自动修图失败：${error.message}`).catch(() => {});
  }
});

async function start() {
  await loadStore();
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('已更新服务器专属 Slash 命令。');
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('已更新全局 Slash 命令。全局命令可能需要一些时间显示。');
  }
  await client.login(DISCORD_TOKEN);
}

process.on('unhandledRejection', error => console.error('未处理的 Promise 错误：', error));
start().catch(error => { console.error('启动失败：', error); process.exit(1); });
