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
import { buildBetCardImage, buildBetCardImageFromShareUrl, type OddsCompareResponse } from "./lib/betCard/index.js";
import { extractFirstUrl, parseAnyBetPayload, type BetLinkPayload } from "./lib/betPayload.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const rulesChannelId = process.env.DISCORD_RULES_CHANNEL_ID;
const freePicksChannelId = process.env.DISCORD_FREE_PICKS_CHANNEL_ID;
const premiumPicksChannelId = process.env.DISCORD_PREMIUM_PICKS_CHANNEL_ID;
const helpChannelId = process.env.DISCORD_HELP_CHANNEL_ID;
const supportRoleId = process.env.DISCORD_SUPPORT_ROLE_ID;
const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
const enableScrapers = (process.env.ENABLE_SCRAPERS ?? "true").toLowerCase() === "true";
const scraperTimeoutMs = Number(process.env.SCRAPER_TIMEOUT_MS ?? 15000);
const betCardOnly = (process.env.BET_CARD_ONLY ?? "false").toLowerCase() === "true";
const betCardIncludeCompare = (process.env.BET_CARD_INCLUDE_COMPARE ?? "true").toLowerCase() === "true";

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
    .setDescription("Admin-only: post a pick to free or premium picks from a bet link.")
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
        .setName("bet_link")
        .setDescription("Bet link with query params for sport/market/selection/event")
        .setRequired(true)
    )
];

const rest = new REST({ version: "10" }).setToken(token);
await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
  body: commands.map((cmd) => cmd.toJSON())
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function renderPayloadSummary(payload: BetLinkPayload): string {
  return [
    "**Bet parsed**",
    `Sport: ${payload.sport}`,
    `Event: ${payload.event ?? payload.eventId ?? "n/a"}`,
    `Market: ${payload.market}`,
    `Selection: ${payload.selection}`,
    payload.postedOdds !== undefined ? `Posted Odds: ${formatOdds(payload.postedOdds)}` : "Posted Odds: n/a",
    payload.sportsbook ? `Sportsbook: ${payload.sportsbook}` : "Sportsbook: n/a"
  ].join("\n");
}

async function compareBetLinkOdds(payload: BetLinkPayload): Promise<OddsCompareResponse> {
  const response = await fetch(`${apiBaseUrl}/odds/compare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Odds comparison failed: ${body}`);
  }

  return response.json() as Promise<OddsCompareResponse>;
}

function renderOddsComparison(comparison: OddsCompareResponse): string {
  const sortedBooks = [...comparison.books].sort((a, b) => b.odds - a.odds);
  const topBooks = sortedBooks.slice(0, 6);

  const postedLine = comparison.sportsbook || comparison.postedOdds !== null
    ? `Posted: ${comparison.selection} | ${comparison.postedOdds !== null ? formatOdds(comparison.postedOdds) : "n/a"} @ ${comparison.sportsbook ?? "unknown book"}`
    : `Selection: ${comparison.selection}`;

  const marketLines = topBooks.map((book) => `- ${book.bookName}: ${formatOdds(book.odds)}`);

  return [
    "**Bet odds check**",
    `Event: ${comparison.eventName}`,
    postedLine,
    "",
    "**Other books:**",
    ...marketLines,
    "",
    "**Risk note:** Bet responsibly. No bet is guaranteed."
  ].join("\n");
}

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
          content: "Only admins can use this command."
        });
        return;
      }

      const tier = interaction.options.getString("tier", true);
      const betLink = interaction.options.getString("bet_link", true);
      const targetChannelId = tier === "premium" ? premiumPicksChannelId : freePicksChannelId;

      if (!targetChannelId || !interaction.guild) {
        await interaction.editReply({
          content: `Target channel is not configured for ${tier} picks. Set DISCORD_${tier.toUpperCase()}_PICKS_CHANNEL_ID in apps/bot/.env and restart the bot.`
        });
        return;
      }

      const targetChannel = await interaction.guild.channels.fetch(targetChannelId).catch(() => null);
      if (!targetChannel) {
        await interaction.editReply({
          content: `Could not find channel with id ${targetChannelId}. Verify DISCORD_${tier.toUpperCase()}_PICKS_CHANNEL_ID and that the bot is in this server.`
        });
        return;
      }

      if (!targetChannel.isTextBased()) {
        await interaction.editReply({
          content: "Configured target channel is invalid or not text-based."
        });
        return;
      }

      const me = interaction.guild.members.me;
      const perms = me?.permissionsIn(targetChannel);
      if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) {
        await interaction.editReply({
          content: `I don't have permission to post in ${channelMention(targetChannelId, tier === "premium" ? "#premium-picks" : "#free-picks")}. Grant View Channel + Send Messages and try again.`
        });
        return;
      }

      const sourceUrl = extractFirstUrl(betLink) ?? undefined;
      const payload = await parseAnyBetPayload(betLink, { enableScrapers, scraperTimeoutMs });

      if (!payload) {
        if (sourceUrl) {
          try {
            const shareCard = await buildBetCardImageFromShareUrl({
              sourceUrl,
              includeCompare: false,
              enableScrapers,
              notes: ["Compare unavailable (share-link only mode)"]
            });

            if (shareCard) {
              await targetChannel.send({
                content: betCardOnly
                  ? undefined
                  : [
                      "**Bet card generated from share link**",
                      "Structured odds compare data was unavailable for this link.",
                      `Bet Link: ${betLink}`
                    ].join("\n"),
                files: [{ attachment: shareCard.image, name: "bet-card.png" }]
              });

              await interaction.editReply({
                content: `Share-link card posted to ${channelMention(targetChannelId, tier === "premium" ? "#premium-picks" : "#free-picks")}.`
              });
              return;
            }
          } catch (error) {
            console.error("Share-link enrichment failed for /post-template:", error);
          }
        }

        await interaction.editReply({
          content: [
            "I couldn't extract bet details from that link.",
            "Required fields are: `sport`, `market`, `selection`, and either `event` or `event_id`.",
            "I also attempted Bet365 share-link enrichment, but no public leg data was available.",
            "Short/private sportsbook links often hide this data unless they redirect to a public URL with those params.",
            `Scraper fallback for bet365/hardrock is ${enableScrapers ? "enabled" : "disabled"} but may still fail on protected links.`,
            "If a share page requires login, it's unsupported for enrichment.",
            "Fallback format in the same `bet_link` field:",
            "`https://... | sport=basketball_nba | market=player_points | selection=Bruce Brown Under 7.5 | event=Denver Nuggets vs Los Angeles Lakers | odds=-100 | sportsbook=bet365`"
          ].join("\n")
        });
        return;
      }

      let comparison: OddsCompareResponse | null = null;
      try {
        comparison = await compareBetLinkOdds(payload);
      } catch (error) {
        console.error("Failed to compare odds for /post-template:", error);
      }

      let cardBuffer: Buffer;
      try {
        const card = await buildBetCardImage(payload, comparison, {
          sourceUrl,
          includeCompare: betCardIncludeCompare,
          enableScrapers,
          notes: comparison ? undefined : ["No compare data"]
        });
        cardBuffer = card.image;
      } catch (error) {
        console.error("Failed to render bet card for /post-template:", error);
        await interaction.editReply({
          content: "I parsed the bet, but failed to generate the card image. Check bot logs and renderer dependencies."
        });
        return;
      }

      const textTemplate = comparison
        ? [renderOddsComparison(comparison), "", `Bet Link: ${betLink}`].join("\n")
        : [renderPayloadSummary(payload), "", "Compare data unavailable.", `Bet Link: ${betLink}`].join("\n");

      await targetChannel.send({
        content: betCardOnly ? undefined : textTemplate,
        files: [{ attachment: cardBuffer, name: "bet-card.png" }]
      });

      await interaction.editReply({
        content: `Template posted to ${channelMention(targetChannelId, tier === "premium" ? "#premium-picks" : "#free-picks")}.`
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

client.on("messageCreate", async (message) => {
  if (message.author.bot) {
    return;
  }

  const links = message.content.match(/https?:\/\/\S+/gi);
  if (!links?.length) {
    return;
  }

  let betPayload: BetLinkPayload | null = null;
  let sourceUrl: string | undefined;
  let firstLink: string | undefined;
  for (const link of links) {
    firstLink = firstLink ?? link;
    betPayload = await parseAnyBetPayload(link, { enableScrapers, scraperTimeoutMs });
    if (betPayload) {
      sourceUrl = link;
      break;
    }
  }

  if (!betPayload) {
    if (firstLink) {
      try {
        const shareCard = await buildBetCardImageFromShareUrl({
          sourceUrl: firstLink,
          includeCompare: false,
          enableScrapers,
          notes: ["Compare unavailable (share-link only mode)"]
        });

        if (shareCard) {
          await message.reply({
            content: "I couldn't parse a full payload, but I generated a Bet365 share-link card.",
            files: [{ attachment: shareCard.image, name: "bet-card.png" }]
          });
          return;
        }
      } catch (error) {
        console.error("Share-link enrichment failed from message link:", error);
      }
    }
    return;
  }

  let comparison: OddsCompareResponse | null = null;
  try {
    comparison = await compareBetLinkOdds(betPayload);
  } catch (error) {
    console.error("Failed to compare odds from message link:", error);
  }

  try {
    const card = await buildBetCardImage(betPayload, comparison, {
      sourceUrl,
      includeCompare: betCardIncludeCompare,
      enableScrapers,
      notes: comparison ? undefined : ["No compare data"]
    });

    const content = comparison
      ? renderOddsComparison(comparison)
      : [
          renderPayloadSummary(betPayload),
          "",
          "I found a bet link and generated a card, but compare data was unavailable."
        ].join("\n");

    await message.reply({
      content,
      files: [{ attachment: card.image, name: "bet-card.png" }]
    });
  } catch (error) {
    console.error("Failed to render bet card from message link:", error);
    await message.reply([
      "I found a bet link, but couldn't render a bet card.",
      "I need extractable params like:",
      "`sport`, `market`, `selection`, and either `event` or `event_id`.",
      "If a share page requires login, it's unsupported for enrichment.",
      "Example: `...?sport=basketball_nba&market=player_points&selection=Bruce%20Brown%20Under%207.5&event=Denver%20Nuggets%20vs%20Lakers&odds=-100&sportsbook=bet365`"
    ].join("\n"));
  }
});

client.once("clientReady", () => {
  console.log(`Bot ready as ${client.user?.tag}`);
});

await client.login(token);

