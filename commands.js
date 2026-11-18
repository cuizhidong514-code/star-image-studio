import { SlashCommandBuilder } from "discord.js";

export const commandData = [
  new SlashCommandBuilder()
    .setName("retouch")
    .setDescription("上传照片并进行 AI 修图")
    .addAttachmentOption(o => o.setName("photo").setDescription("要修的照片").setRequired(true))
    .addStringOption(o => o.setName("instruction").setDescription("修图要求，例如自然美颜、换背景、调色").setRequired(false).setMaxLength(1500))
    .addStringOption(o => o.setName("profile").setDescription("人物档案名称（可选）").setRequired(false).setMaxLength(40)),
  new SlashCommandBuilder()
    .setName("remember")
    .setDescription("记住你的修图偏好或某个人物的特点")
    .addStringOption(o => o.setName("note").setDescription("要记住的偏好或人物特点").setRequired(true).setMaxLength(1000))
    .addStringOption(o => o.setName("profile").setDescription("人物档案名称；不填则保存为个人默认偏好").setRequired(false).setMaxLength(40)),
  new SlashCommandBuilder()
    .setName("profiles")
    .setDescription("查看你保存的人物档案名称"),
  new SlashCommandBuilder()
    .setName("forget")
    .setDescription("删除一个人物档案或清空个人默认偏好")
    .addStringOption(o => o.setName("profile").setDescription("要删除的人物档案名称；不填则清空个人默认偏好").setRequired(false).setMaxLength(40))
].map(c => c.toJSON());
