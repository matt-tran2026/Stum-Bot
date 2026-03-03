import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionFlagsBits
} from "discord.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const rulesChannelId = process.env.DISCORD_RULES_CHANNEL_ID;
const freePicksChannelId = process.env.DISCORD_FREE_PICKS_CHANNEL_ID;
const premiumPicksChannelId = process.env.DISCORD_PREMIUM_PICKS_CHANNEL_ID;
const helpChannelId = process.env.DISCORD_HELP_CHANNEL_ID;
const supportRoleId = process.env.DISCORD_SUPPORT_ROLE_ID;

if (!token || !clientId || !guildId) {
  throw new Error("Missing DISCORD_TOKEN, DISCORD_CLIENT_ID, or DISCORD_GUILD_ID");
}

const commands = [
  new SlashCommandBuilder()
    .setName("start")
    .setDescription("Get a quick guide to use this server."),
  new SlashCommandBuilder()
    .setName("rules")
    .setDescription("Get a summary of server rules and expectations."),
  new SlashCommandBuilder()
    .setName("where")
    .setDescription("Find where free picks, premium picks, and support are."),
  new SlashCommandBuilder()
    .setName("post-template")
    .setDescription("Admin-only: post a pick template to free or premium picks.")
    .addStringOption((opt) =>
      opt
        .setName("tier")
        .setDescription("Where to post the template")
        .addChoices(
          { name: "free", value: "free" },
          { name: "premium", value: "premium" }
        )
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("headline")
        .setDescription("Optional title for this pick post")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("market")
        .setDescription("Example: Player Props - Threes")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("selection")
        .setDescription("Example: Curry Over 4.5 Threes")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("odds")
        .setDescription("Example: +105")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("stake_units")
        .setDescription("Example: 1.5u")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("fanduel_odds")
        .setDescription("Example: +100")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("draftkings_odds")
        .setDescription("Example: -105")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("caesars_odds")
        .setDescription("Example: +102")
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName("bet_link")
        .setDescription("Link to the bet slip or sportsbook page")
        .setRequired(false)
    )
];

const rest = new REST({ version: "10" }).setToken(token);
await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
  body: commands.map((cmd) => cmd.toJSON())
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

function channelMention(channelId: string | undefined, fallback: string): string {
  return channelId ? `<#${channelId}>` : fallback;
}

function supportMention(): string {
  return supportRoleId ? `<@&${supportRoleId}>` : "an admin";
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    if (interaction.commandName === "start") {
    const embed = new EmbedBuilder()
      .setTitle("Welcome to the Server")
      .setDescription("Use this quick checklist to get set up.")
      .addFields(
        {
          name: "1) Read Rules",
          value: `Start in ${channelMention(rulesChannelId, "#rules")} and follow posting guidelines.`
        },
        {
          name: "2) Find Picks",
          value: `Free picks: ${channelMention(freePicksChannelId, "#free-picks")} | Premium picks: ${channelMention(premiumPicksChannelId, "#premium-picks")}`
        },
        {
          name: "3) Need Help?",
          value: `Ask in ${channelMention(helpChannelId, "#help")} or ping ${supportMention()}.`
        }
      )
      .setTimestamp(new Date());

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (interaction.commandName === "rules") {
    const embed = new EmbedBuilder()
      .setTitle("Server Rules Summary")
      .addFields(
        { name: "No guaranteed profit claims", value: "Do not claim locks or guaranteed wins." },
        { name: "Post respectfully", value: "No spam, harassment, or personal attacks." },
        { name: "Use correct channels", value: `Picks belong in ${channelMention(freePicksChannelId, "#free-picks")} or ${channelMention(premiumPicksChannelId, "#premium-picks")}.` },
        { name: "Bet responsibly", value: "Only wager what you can afford to lose." }
      )
      .setFooter({ text: `Full rules: ${channelMention(rulesChannelId, "#rules")}` })
      .setTimestamp(new Date());

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (interaction.commandName === "where") {
    await interaction.reply({
      content: [
        `Free picks: ${channelMention(freePicksChannelId, "#free-picks")}`,
        `Premium picks: ${channelMention(premiumPicksChannelId, "#premium-picks")}`,
        `Rules: ${channelMention(rulesChannelId, "#rules")}`,
        `Help: ${channelMention(helpChannelId, "#help")}`
      ].join("\n"),
      ephemeral: true
    });
    return;
  }

  if (interaction.commandName === "post-template") {
    await interaction.deferReply({ ephemeral: true });

    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    if (!isAdmin) {
      await interaction.editReply({
        content: "Only admins can use this command.",
      });
      return;
    }

    const tier = interaction.options.getString("tier", true);
    const headline = interaction.options.getString("headline") ?? "New Pick";
    const market = interaction.options.getString("market") ?? "[fill]";
    const selection = interaction.options.getString("selection") ?? "[fill]";
    const odds = interaction.options.getString("odds") ?? "[fill]";
    const stakeUnits = interaction.options.getString("stake_units") ?? "[fill]";
    const fanduelOdds = interaction.options.getString("fanduel_odds") ?? "[fill]";
    const draftkingsOdds = interaction.options.getString("draftkings_odds") ?? "[fill]";
    const caesarsOdds = interaction.options.getString("caesars_odds") ?? "[fill]";
    const betLink = interaction.options.getString("bet_link") ?? "[fill]";
    const targetChannelId = tier === "premium" ? premiumPicksChannelId : freePicksChannelId;

    if (!targetChannelId || !interaction.guild) {
      await interaction.editReply({
        content: `Target channel is not configured for ${tier} picks. Set DISCORD_${tier.toUpperCase()}_PICKS_CHANNEL_ID in apps/bot/.env and restart the bot.`,
      });
      return;
    }

    const targetChannel = await interaction.guild.channels.fetch(targetChannelId).catch(() => null);
    if (!targetChannel) {
      await interaction.editReply({
        content: `Could not find channel with id ${targetChannelId}. Verify DISCORD_${tier.toUpperCase()}_PICKS_CHANNEL_ID and that the bot is in this server.`,
      });
      return;
    }

    if (!targetChannel.isTextBased()) {
      await interaction.editReply({
        content: "Configured target channel is invalid or not text-based.",
      });
      return;
    }

    const template = [
      `## ${headline}`,
      "",
      `**Market:** ${market}`,
      `**Selection:** ${selection}`,
      `**Odds:** ${odds}`,
      `**Stake (units):** ${stakeUnits}`,
      `**Bet Link:** ${betLink}`,
      "",
      "**Market check (other books):**",
      `- FanDuel: ${fanduelOdds}`,
      `- DraftKings: ${draftkingsOdds}`,
      `- Caesars: ${caesarsOdds}`,
      "",
      "**Risk note:** Bet responsibly. No bet is guaranteed."
    ].join("\n");

    const me = interaction.guild.members.me;
    const perms = me?.permissionsIn(targetChannel);
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) {
      await interaction.editReply({
        content: `I don't have permission to post in ${channelMention(targetChannelId, tier === "premium" ? "#premium-picks" : "#free-picks")}. Grant View Channel + Send Messages and try again.`,
      });
      return;
    }

    await targetChannel.send(template);
    await interaction.editReply({
      content: `Template posted to ${channelMention(targetChannelId, tier === "premium" ? "#premium-picks" : "#free-picks")}.`,
    });
  }
  } catch (error) {
    console.error("Interaction handler error:", error);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("Command failed. Check bot logs for details.");
    } else {
      await interaction.reply({
        content: "Command failed. Check bot logs for details.",
        ephemeral: true
      });
    }
  }
});

client.on("guildMemberAdd", async (member) => {
  const channel = member.guild.systemChannel;
  if (!channel) {
    return;
  }

  const welcomeText = [
    `Welcome ${member}, glad you're here.`,
    `Start with ${channelMention(rulesChannelId, "#rules")} and run \`/start\` for setup help.`,
    `Questions? Ask in ${channelMention(helpChannelId, "#help")} or ping ${supportMention()}.`
  ].join("\n");

  try {
    await channel.send(welcomeText);
  } catch (error) {
    console.error("Failed to send welcome message:", error);
  }
});

client.once("clientReady", () => {
  console.log(`Bot ready as ${client.user?.tag}`);
});

await client.login(token);
