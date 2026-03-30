require('dotenv').config({ path: './.env' });

const { 
  Client, 
  GatewayIntentBits, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  Events, 
  EmbedBuilder, 
  AttachmentBuilder 
} = require('discord.js');

const fs = require('fs');
const path = require('path');

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
const ASSIST_CHANNELS = (process.env.ASSIST_CHANNELS || '')
  .split(',')
  .filter(Boolean);

// Ensure data.json exists
if (!fs.existsSync('data.json')) fs.writeFileSync('data.json', '{}');
let data = JSON.parse(fs.readFileSync('data.json'));

// Buttons
const row = new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('in').setLabel('IN').setStyle(ButtonStyle.Success),
  new ButtonBuilder().setCustomId('out').setLabel('OUT').setStyle(ButtonStyle.Danger)
);

// ===== HELPER: SEND PANEL =====
async function sendPanel(channel) {
  try {
    const filePath = path.join(__dirname, 'assets', 'design.gif');
    const files = fs.existsSync(filePath) ? [new AttachmentBuilder(filePath)] : [];
    const image = fs.existsSync(filePath) ? 'attachment://design.gif' : null;

    const embed = new EmbedBuilder()
      .setColor(0x0099FF)
      .setTitle("Fury Management System")
      .setDescription("Click (IN) to start the timer. Must click every 30 min.")
      .setFooter({ text: "Fury RP" });

    if (image) embed.setImage(image);

    await channel.send({ embeds: [embed], files, components: [row] });
    console.log("✅ PANEL SENT SUCCESSFULLY");
  } catch (err) {
    console.error("❌ PANEL ERROR:", err);
    await channel.send("❌ Error sending panel. Check bot permissions.");
  }
}

// ===== MESSAGE HANDLER =====
client.on('messageCreate', async (msg) => {
  if (!msg.guild || msg.author.bot) return;

  // ----- PANEL -----
  if (msg.content === '!panel') {
    console.log("⚡ PANEL COMMAND TRIGGERED");
    await sendPanel(msg.channel);
  }

  // ----- LEADERBOARD -----
  if (msg.content === '!leaderboard') {
    try {
      const sorted = Object.entries(data).sort((a, b) => b[1].total - a[1].total);
      let description = sorted.length ? '' : 'No leaderboard data yet!';

      for (let i = 0; i < sorted.length; i++) {
        const [userId, info] = sorted[i];
        description += `**${i + 1}.** <@${userId}> — **${info.total} points**\n`;
      }

      await msg.channel.send({
        embeds: [new EmbedBuilder()
          .setColor(0xFFD700)
          .setTitle('🏆 Fury Leaderboard (1 point = 5min)')
          .setDescription(description)
          .setFooter({ text: 'Fury Management System' })
          .setTimestamp()
        ]
      });
    } catch (err) {
      console.error("❌ LEADERBOARD ERROR:", err);
    }
  }

  // ----- RESET -----
  if (msg.content === '!resetpoints') {
    try {
      for (const userId in data) data[userId].total = 0;
      fs.writeFileSync('data.json', JSON.stringify(data, null, 2));

      await msg.channel.send({
        embeds: [new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle('🏆 Fury Leaderboard Reset')
          .setDescription('All points reset to 0!')
          .setFooter({ text: 'Fury Management System' })
          .setTimestamp()
        ]
      });
    } catch (err) {
      console.error("❌ RESET ERROR:", err);
    }
  }
});

// ===== BUTTON HANDLER =====
client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isButton()) return;

  const userId = interaction.user.id;
  if (!data[userId]) data[userId] = { total: 0, active: false, lastClick: 0 };

  const member = interaction.guild.members.cache.get(userId);
  const inAssist = member?.voice.channelId && ASSIST_CHANNELS.includes(member.voice.channelId);

  if (member?.voice.selfDeaf) {
    return interaction.reply({ content: '🚫 You are deafened, cannot sign IN.', ephemeral: true });
  }

  if (!inAssist) {
    return interaction.reply({ content: '❌ You must be in assist VC!', ephemeral: true });
  }

  if (interaction.customId === 'in') {
    if (data[userId].active) return interaction.reply({ content: '⚠️ Already signed in!', ephemeral: true });
    data[userId].active = true;
    data[userId].lastClick = Date.now();
    fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
    return interaction.reply({ content: '✅ Signed IN! Timer started.', ephemeral: true });
  }

  if (interaction.customId === 'out') {
    if (!data[userId].active) return interaction.reply({ content: '⚠️ Not signed in!', ephemeral: true });
    data[userId].active = false;
    data[userId].lastClick = 0;
    fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
    return interaction.reply({ content: '⛔ Signed OUT!', ephemeral: true });
  }
});

// ===== TIMER LOOP =====
setInterval(async () => {
  const now = Date.now();

  for (const [userId, user] of Object.entries(data)) {
    if (!user.active) continue;

    let member = null;
    for (const g of client.guilds.cache.values()) {
      const m = g.members.cache.get(userId);
      if (m) { member = m; break; }
    }
    if (!member || !member.voice.channelId) continue;

    const inAssist = ASSIST_CHANNELS.includes(member.voice.channelId);

    if (!inAssist || member.voice.selfDeaf || now - user.lastClick > 30 * 60 * 1000) {
      user.active = false;
      user.lastClick = 0;

      try {
        const u = await client.users.fetch(userId);
        if (!inAssist) await u.send('⛔ You left assist VC. Signed OUT.');
        else if (member.voice.selfDeaf) await u.send('🚫 You deafened yourself. Signed OUT.');
        else await u.send('⏰ 30 min passed. Signed OUT.');
      } catch {}

      continue;
    }

    user.total += 1;
  }

  fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
  console.log('✅ Timer loop ran');
}, 5 * 60 * 1000);

// ===== VOICE UPDATE =====
client.on('voiceStateUpdate', async (oldState, newState) => {
  const userId = oldState.member.id;
  if (!data[userId]?.active) return;

  if (!oldState.selfDeaf && newState.selfDeaf) {
    data[userId].active = false;
    data[userId].lastClick = 0;
    fs.writeFileSync('data.json', JSON.stringify(data, null, 2));

    try {
      await oldState.member.send('🚫 You deafened yourself. Signed OUT.');
    } catch {}
  }
});

// ===== READY =====
client.once('ready', () => {
  console.log(`${client.user.tag} is online!`);
});

// ===== LOGIN =====
client.login(TOKEN);