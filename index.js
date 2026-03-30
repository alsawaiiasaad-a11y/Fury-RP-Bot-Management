// index.js
require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// ===== MongoDB Setup =====
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ===== User Schema =====
const userSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  total: { type: Number, default: 0 },
  active: { type: Boolean, default: false },
  lastClick: { type: Number, default: 0 }
});
const User = mongoose.model('User', userSchema);

// ===== Discord Client =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const TOKEN = process.env.TOKEN;
const ASSIST_CHANNELS = (process.env.ASSIST_CHANNELS || '').split(',').filter(Boolean);

// ===== Buttons =====
const row = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('in').setLabel('IN').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('out').setLabel('OUT').setStyle(ButtonStyle.Danger)
);

// ===== Helper: Get or Create User =====
async function getUser(userId) {
  let user = await User.findOne({ userId });
  if (!user) {
    user = new User({ userId });
    await user.save();
  }
  return user;
}

// ===== PANEL =====
async function sendPanel(channel) {
  try {
    const filePath = path.join(__dirname, 'assets', 'design.gif');
    if (!fs.existsSync(filePath)) return channel.send("❌ GIF not found");

    const attachment = new AttachmentBuilder(filePath);
    const embed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle("Fury Management System")
      .setDescription("Click **IN** to start the timer. Must click every 30 min.")
      .setImage('attachment://design.gif')
      .setFooter({ text: "Fury RP" });

    await channel.send({ embeds: [embed], files: [attachment], components: [row] });
  } catch (err) {
    console.error(err);
  }
}

// ===== MESSAGE HANDLER =====
client.on('messageCreate', async msg => {
  if (!msg.guild || msg.author.bot) return;

  if (msg.content === '!panel') return sendPanel(msg.channel);

  if (msg.content === '!leaderboard') {
    const users = await User.find().sort({ total: -1 }).limit(50); // top 50
    let desc = users.length ? '' : 'No leaderboard data yet!';
    users.forEach((u, i) => {
      desc += `**${i + 1}.** <@${u.userId}> — **${u.total} points**\n`;
    });

    await msg.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xFFD700)
          .setTitle('🏆 Fury Leaderboard')
          .setDescription(desc)
      ]
    });
  }

  if (msg.content === '!resetpoints') {
    await User.updateMany({}, { $set: { total: 0 } });
    msg.channel.send("✅ All points reset!");
  }
});

// ===== BUTTON HANDLER =====
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

  const userId = interaction.user.id;
  let user = await getUser(userId);

  const member = interaction.guild.members.cache.get(userId);
  const inAssist = member?.voice.channelId && ASSIST_CHANNELS.includes(member.voice.channelId);

  if (!inAssist) return interaction.reply({ content: '❌ Join assist VC', ephemeral: true });

  if (interaction.customId === 'in') {
    if (user.active) return interaction.reply({ content: '⚠️ Already IN', ephemeral: true });

    user.active = true;
    user.lastClick = Date.now();
    await user.save();

    return interaction.reply({ content: '✅ Signed IN', ephemeral: true });
  }

  if (interaction.customId === 'out') {
    if (!user.active) return interaction.reply({ content: '⚠️ Not IN', ephemeral: true });

    user.active = false;
    user.lastClick = 0;
    await user.save();

    return interaction.reply({ content: '⛔ Signed OUT', ephemeral: true });
  }
});

// ===== TIMER LOOP =====
setInterval(async () => {
  const now = Date.now();
  const users = await User.find({ active: true });

  for (const user of users) {
    let member = null;
    for (const g of client.guilds.cache.values()) {
      const m = g.members.cache.get(user.userId);
      if (m) { member = m; break; }
    }
    if (!member || !member.voice.channelId) continue;
    const inAssist = ASSIST_CHANNELS.includes(member.voice.channelId);

    if (!inAssist || now - user.lastClick > 30 * 60 * 1000) {
      user.active = false;
      user.lastClick = 0;
      await user.save();
      continue;
    }

    user.total += 1;
    await user.save();
  }

  console.log("✅ Timer loop ran");
}, 5 * 60 * 1000);

// ===== VOICE UPDATE =====
client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member || oldState.member;
  const userId = member.id;
  let user = await User.findOne({ userId });
  if (!user?.active) return;

  if ((oldState.selfDeaf === false && newState.selfDeaf === true) || newState.selfDeaf) {
    user.active = false;
    user.lastClick = 0;
    await user.save();
    try { await member.send('🚫 You deafened yourself. Timer stopped and signed OUT.'); } catch {}
  }
});

// ===== READY =====
client.once('clientReady', () => {
  console.log(`${client.user.tag} is online!`);
});

// ===== LOGIN =====
client.login(TOKEN);