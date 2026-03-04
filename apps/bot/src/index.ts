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
import { scrapeBetFromLink } from "./lib/scrapers.js";

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

type BetLinkPayload = {
  sport: string;
  market: string;
  selection: string;
  event?: string;
  eventId?: string;
  sportsbook?: string;
  postedOdds?: number;
};

type OddsCompareResponse = {
  eventName: string;
  sport: string;
  market: string;
  selection: string;
  sportsbook: string | null;
  postedOdds: number | null;
  books: Array<{
    bookKey: string;
    bookName: string;
    odds: number;
  }>;
};

function normalizeBookFromHostname(hostname: string): string | undefined {
  const host = hostname.toLowerCase();
  if (host.includes("bet365")) return "Bet365";
  if (host.includes("fanduel")) return "FanDuel";
  if (host.includes("draftkings")) return "DraftKings";
  if (host.includes("caesars")) return "Caesars";
  if (host.includes("betmgm")) return "BetMGM";
  return undefined;
}

function parseBetLink(link: string): BetLinkPayload | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }

  const sport =
    url.searchParams.get("sport") ??
    url.searchParams.get("sport_key") ??
    url.searchParams.get("league");

  const market =
    url.searchParams.get("market") ??
    url.searchParams.get("market_key") ??
    url.searchParams.get("bet_type");

  const selection =
    url.searchParams.get("selection") ??
    url.searchParams.get("pick") ??
    url.searchParams.get("outcome");

  const eventId =
    url.searchParams.get("event_id") ??
    url.searchParams.get("eventId");

  const event =
    url.searchParams.get("event") ??
    url.searchParams.get("event_name");

  const sportsbook =
    url.searchParams.get("sportsbook") ??
    url.searchParams.get("book") ??
    url.searchParams.get("bookmaker") ??
    normalizeBookFromHostname(url.hostname);

  const postedOddsRaw = url.searchParams.get("odds") ?? url.searchParams.get("price");
  const postedOdds = postedOddsRaw ? Number(postedOddsRaw) : undefined;

  if (!sport || !market || !selection || (!eventId && !event)) {
    return null;
  }

  return {
    sport,
    market,
    selection,
    event: event ?? undefined,
    eventId: eventId ?? undefined,
    sportsbook,
    postedOdds: Number.isFinite(postedOdds) ? postedOdds : undefined
  };
}

function parseManualBetDetails(input: string): Partial<BetLinkPayload> {
  const fields: Partial<BetLinkPayload> = {};
  const regex = /(sport|market|selection|event|event_id|eventid|sportsbook|book|bookmaker|odds|price)\s*[:=]\s*([^|\n]+)/gi;

  for (const match of input.matchAll(regex)) {
    const key = match[1].toLowerCase().trim();
    const rawValue = match[2].trim();
    if (!rawValue) continue;

    if (key === "sport") fields.sport = rawValue;
    if (key === "market") fields.market = rawValue;
    if (key === "selection") fields.selection = rawValue;
    if (key === "event") fields.event = rawValue;
    if (key === "event_id" || key === "eventid") fields.eventId = rawValue;
    if (key === "sportsbook" || key === "book" || key === "bookmaker") fields.sportsbook = rawValue;
    if (key === "odds" || key === "price") {
      const oddsNum = Number(rawValue);
      if (Number.isFinite(oddsNum)) fields.postedOdds = oddsNum;
    }
  }

  return fields;
}

function mergeBetDetails(base: BetLinkPayload | null, extras: Partial<BetLinkPayload>): BetLinkPayload | null {
  const sport = extras.sport ?? base?.sport;
  const market = extras.market ?? base?.market;
  const selection = extras.selection ?? base?.selection;
  const event = extras.event ?? base?.event;
  const eventId = extras.eventId ?? base?.eventId;

  if (!sport || !market || !selection || (!event && !eventId)) {
    return null;
  }

  return {
    sport,
    market,
    selection,
    event,
    eventId,
    sportsbook: extras.sportsbook ?? base?.sportsbook,
    postedOdds: extras.postedOdds ?? base?.postedOdds
  };
}

function extractFirstUrl(input: string): string | null {
  const match = input.match(/https?:\/\/\S+/i);
  return match ? match[0] : null;
}

async function parseBetLinkWithRedirect(rawInput: string): Promise<BetLinkPayload | null> {
  const extractedUrl = extractFirstUrl(rawInput);
  const link = extractedUrl ?? rawInput.trim();
  const direct = parseBetLink(link);
  const manual = parseManualBetDetails(rawInput);

  if (direct) {
    return mergeBetDetails(direct, manual);
  }

  if (!extractedUrl) {
    return mergeBetDetails(null, manual);
  }

  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return mergeBetDetails(null, manual);
  }

  // Some sportsbooks share short links (ex: bet365 /s/r/...) that redirect to a fuller URL.
  if (!url.hostname.toLowerCase().includes("bet365")) {
    return mergeBetDetails(null, manual);
  }

  try {
    const response = await fetch(link, {
      method: "GET",
      redirect: "follow"
    });

    const redirected = response.url && response.url !== link ? parseBetLink(response.url) : null;
    return mergeBetDetails(redirected, manual);
  } catch {
    return mergeBetDetails(null, manual);
  }
}

async function parseAnyBetPayload(input: string): Promise<BetLinkPayload | null> {
  const direct = await parseBetLinkWithRedirect(input);
  if (direct) {
    return direct;
  }

  const fragments = input.split("|").map((part) => part.trim()).filter(Boolean);
  for (const fragment of fragments) {
    const parsed = await parseBetLinkWithRedirect(fragment);
    if (parsed) {
      return parsed;
    }
  }

  if (enableScrapers) {
    const link = extractFirstUrl(input);
    if (link) {
      const scraped = await scrapeBetFromLink(link, { timeoutMs: scraperTimeoutMs });
      if (scraped) {
        return mergeBetDetails(null, scraped);
      }
    }
  }

  return null;
}

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
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
    `**Bet odds check**`,
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
        content: "Only admins can use this command.",
      });
      return;
    }

    const tier = interaction.options.getString("tier", true);
    const betLink = interaction.options.getString("bet_link", true);
    const targetChannelId = tier === "premium" ? premiumPicksChannelId : freePicksChannelId;
    const payload = await parseAnyBetPayload(betLink);

    if (!payload) {
      await interaction.editReply({
        content: [
          "I couldn't extract bet details from that link.",
          "Required fields are: `sport`, `market`, `selection`, and either `event` or `event_id`.",
          "Short/private sportsbook links often hide this data unless they redirect to a public URL with those params.",
          `Scraper fallback for bet365/hardrock is ${enableScrapers ? "enabled" : "disabled"} but may still fail on protected links.`,
          "Fallback format in the same `bet_link` field:",
          "`https://... | sport=basketball_nba | market=player_points | selection=Bruce Brown Under 7.5 | event=Denver Nuggets vs Los Angeles Lakers | odds=-100 | sportsbook=bet365`"
        ].join("\n")
      });
      return;
    }

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

    let template: string;
    try {
      const comparison = await compareBetLinkOdds(payload);
      template = [
        renderOddsComparison(comparison),
        "",
        `Bet Link: ${betLink}`
      ].join("\n");
    } catch (error) {
      console.error("Failed to compare odds for /post-template:", error);
      await interaction.editReply({
        content: "Failed to compare odds for this bet link. Verify the link params and API key, then try again."
      });
      return;
    }

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

client.on("messageCreate", async (message) => {
  if (message.author.bot) {
    return;
  }

  const links = message.content.match(/https?:\/\/\S+/gi);
  if (!links?.length) {
    return;
  }

  let betPayload: BetLinkPayload | null = null;
  for (const link of links) {
    betPayload = await parseAnyBetPayload(link);
    if (betPayload) {
      break;
    }
  }

  if (!betPayload) {
    return;
  }

  try {
    const comparison = await compareBetLinkOdds(betPayload);
    await message.reply(renderOddsComparison(comparison));
  } catch (error) {
    console.error("Failed to compare odds from message link:", error);
    await message.reply([
      "I found a bet link, but couldn't compare it.",
      "I need extractable params like:",
      "`sport`, `market`, `selection`, and either `event` or `event_id`.",
      "Example: `...?sport=basketball_nba&market=player_points&selection=Bruce%20Brown%20Under%207.5&event=Denver%20Nuggets%20vs%20Lakers&odds=-100&sportsbook=bet365`",
      "If you're using a short sportsbook link, try the fully expanded share URL."
    ].join("\n"));
  }
});

client.once("clientReady", () => {
  console.log(`Bot ready as ${client.user?.tag}`);
});

await client.login(token);
