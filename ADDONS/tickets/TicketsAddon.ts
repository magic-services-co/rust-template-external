import {
    ActionRowBuilder,
    ApplicationCommandOptionType,
    ButtonBuilder,
    ButtonInteraction,
    ButtonStyle,
    CategoryChannel,
    type Channel,
    ChannelType,
    ChatInputCommandInteraction,
    ComponentType,
    EmbedBuilder,
    type GuildBasedChannel,
    GuildMember,
    type Interaction,
    type Message,
    type MessageActionRowComponentBuilder,
    ModalBuilder,
    ModalSubmitInteraction,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    StringSelectMenuInteraction,
    StringSelectMenuOptionBuilder,
    TextChannel,
    TextInputBuilder,
    TextInputStyle,
    ThreadAutoArchiveDuration,
    type ThreadChannel,
} from "discord.js";
import {
    ButtonComponent,
    Discord,
    Guard,
    ModalComponent,
    On,
    SelectMenuComponent,
    Slash,
    SlashChoice,
    SlashGroup,
    SlashOption,
    type ArgsOf,
} from "discordx";
import { PermissionGuard } from "@discordx/utilities";
import config from "../../config.json";
import { TicketApi, type SupportCategory, type SupportField } from "./TicketApi.ts";
import { TicketRegistry } from "./TicketRegistry.ts";
import { randomUUID } from "crypto";
import { supportClient } from "../../index.ts";

interface PanelSession {
    id: string;
    guildId: string;
    createdBy: string;
    targetChannelId: string;
    ticketParentId?: string;
}

interface PanelConfig {
    guildId: string;
    channelId: string;
    parentCategoryId?: string;
    createdBy: string;
    createdAt: number;
}

const panelSessions = new Map<string, PanelSession>();
const panelConfigs = new Map<string, PanelConfig>();

const DEFAULT_EMBED_COLOR = parseHexColor(
    typeof config.EMBED_HEX === "string" ? config.EMBED_HEX : "0099FF",
);
const SUPPORT_ROLE_IDS: string[] = Array.isArray((config as any).TICKET_SUPPORT_ROLE_IDS)
    ? ((config as any).TICKET_SUPPORT_ROLE_IDS as string[])
    : Array.isArray(config.VIEW_MEMBERS_ROLES)
        ? config.VIEW_MEMBERS_ROLES
        : [];
const CATEGORY_ACCESS_ROLES: Record<string, string[]> =
    (config as any).TICKET_CATEGORY_ACCESS_ROLES &&
    typeof (config as any).TICKET_CATEGORY_ACCESS_ROLES === "object"
        ? (config as any).TICKET_CATEGORY_ACCESS_ROLES
        : {};
const CATEGORY_PING_ROLES: Record<string, string[]> =
    (config as any).TICKET_CATEGORY_PING_ROLES &&
    typeof (config as any).TICKET_CATEGORY_PING_ROLES === "object"
        ? (config as any).TICKET_CATEGORY_PING_ROLES
        : {};
const TICKET_PANEL_TYPE: "dropdown" | "buttons" =
    (config as any).TICKET_PANEL_TYPE === "buttons" ? "buttons" : "dropdown";
const SUPPORT_BOT_TOKEN: string | null =
    (config as any).SUPPORT_BOT_TOKEN && typeof (config as any).SUPPORT_BOT_TOKEN === "string" && (config as any).SUPPORT_BOT_TOKEN.trim().length > 0
        ? (config as any).SUPPORT_BOT_TOKEN.trim()
        : null;
const TICKET_MODE: "dm" | "channel" =
    (config as any).TICKET_MODE === "dm" ? "dm" : "channel";
const TICKET_DM_GUILD_ID: string | null =
    (config as any).TICKET_DM_GUILD_ID && typeof (config as any).TICKET_DM_GUILD_ID === "string" && (config as any).TICKET_DM_GUILD_ID.trim().length > 0
        ? (config as any).TICKET_DM_GUILD_ID.trim()
        : null;
const TICKET_DM_CHANNEL_CATEGORY_ID: string | null =
    (config as any).TICKET_DM_CHANNEL_CATEGORY_ID && typeof (config as any).TICKET_DM_CHANNEL_CATEGORY_ID === "string" && (config as any).TICKET_DM_CHANNEL_CATEGORY_ID.trim().length > 0
        ? (config as any).TICKET_DM_CHANNEL_CATEGORY_ID.trim()
        : null;
const COOLDOWN_BYPASS_ROLE_ID = "1437906177550975026";

interface FieldPrompt {
    field: SupportField;
    stepName: string;
}

interface TicketQuestionPage {
    index: number;
    fields: FieldPrompt[];
}

interface TicketCreationSession {
    id: string;
    userId: string;
    guildId: string;
    category: SupportCategory;
    panelConfig: PanelConfig;
    pages: TicketQuestionPage[];
    responses: Map<string, string>;
    createdAt: number;
}

interface TicketFollowupSession {
    id: string;
    channelId: string;
    messageId: string;
    ticketId: string | null;
    ownerId: string;
    categoryName: string;
    pageIndex: number;
    fields: FieldPrompt[];
    threadId: string | null;
    createdAt: number;
}

interface TicketChannelCreationOptions {
    interaction: StringSelectMenuInteraction | ModalSubmitInteraction | ButtonInteraction;
    category: SupportCategory;
    panelConfig: PanelConfig;
    answers: Record<string, string>;
    initialFields: FieldPrompt[];
    bypassCooldown: boolean;
}

type TicketCreationResult =
    | {
        success: true;
        channel: TextChannel;
        ticketId: string | null;
        creationMessageId: string;
        threadId: string | null;
        thread: ThreadChannel | null;
        apiWarning?: string;
    }
    | {
        success: false;
        error: string;
    };

const ticketCreationSessions = new Map<string, TicketCreationSession>();
const ticketFollowupSessions = new Map<string, TicketFollowupSession>();

function parseHexColor(input: string | number | undefined | null): number {
    if (typeof input === "number" && Number.isFinite(input)) {
        return input;
    }
    if (!input) {
        return DEFAULT_EMBED_COLOR;
    }
    const sanitized = String(input).trim().replace(/^0x/i, "").replace(/^#/, "");
    if (!/^[0-9A-Fa-f]{6}$/.test(sanitized)) {
        return DEFAULT_EMBED_COLOR;
    }
    return Number.parseInt(sanitized, 16);
}

function isGuildTextChannel(channel: Channel | null): channel is TextChannel {
    return (
        !!channel &&
        channel.type === ChannelType.GuildText &&
        typeof (channel as TextChannel).send === "function"
    );
}

function chunkString(input: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let buffer = input;
    while (buffer.length > maxLength) {
        chunks.push(buffer.slice(0, maxLength));
        buffer = buffer.slice(maxLength);
    }
    if (buffer.length > 0) {
        chunks.push(buffer);
    }
    return chunks;
}

function flattenCategoryFields(category: SupportCategory): FieldPrompt[] {
    const prompts: FieldPrompt[] = [];
    const steps = [...(category.steps ?? [])].sort((a, b) => a.order - b.order);
    for (const step of steps) {
        const fields = [...(step.fields ?? [])].sort((a, b) => a.order - b.order);
        for (const field of fields) {
            prompts.push({
                field,
                stepName: step.name ?? "Additional Information",
            });
        }
    }
    return prompts;
}

function chunkPrompts(prompts: FieldPrompt[], perPage = 5): FieldPrompt[][] {
    const pages: FieldPrompt[][] = [];
    for (let i = 0; i < prompts.length; i += perPage) {
        pages.push(prompts.slice(i, i + perPage));
    }
    return pages;
}

function getFieldInputId(field: SupportField): string {
    const key = field.key || String(field.id);
    return `field:${key}`.slice(0, 45);
}

function sanitizeLabel(label: string, fallback: string): string {
    const trimmed = (label || fallback).trim();
    if (trimmed.length <= 45) {
        return trimmed;
    }
    return trimmed.slice(0, 42) + "...";
}

function pickInputStyle(field: SupportField): TextInputStyle {
    const type = field.type?.toLowerCase() ?? "string";
    if (type.includes("paragraph") || type.includes("text") || type.includes("textarea")) {
        return TextInputStyle.Paragraph;
    }
    return TextInputStyle.Short;
}

function buildQuestionModal(
    sessionId: string,
    page: TicketQuestionPage,
    categoryName: string,
): ModalBuilder {
    const modal = new ModalBuilder()
        .setTitle(`${categoryName} • Questions #${page.index + 1}`)
        .setCustomId(`ticket:create:${sessionId}:${page.index}`);

    for (const prompt of page.fields) {
        const field = prompt.field;
        const input = new TextInputBuilder()
            .setCustomId(getFieldInputId(field))
            .setLabel(sanitizeLabel(field.label ?? field.key ?? "Question", "Question"))
            .setRequired(Boolean(field.required))
            .setStyle(pickInputStyle(field));

        const placeholder =
            (typeof field.options === "object" && field.options && "placeholder" in field.options
                ? String(field.options.placeholder ?? "")
                : "") || "";
        if (placeholder) {
            input.setPlaceholder(placeholder.slice(0, 100));
        }

        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    }

    return modal;
}

function buildFollowupModal(
    followupId: string,
    pageIndex: number,
    categoryName: string,
    fields: FieldPrompt[],
): ModalBuilder {
    const modal = new ModalBuilder()
        .setTitle(`${categoryName} • Questions #${pageIndex + 1}`)
        .setCustomId(`ticket:followup-modal:${followupId}`);

    for (const prompt of fields) {
        const field = prompt.field;
        const input = new TextInputBuilder()
            .setCustomId(getFieldInputId(field))
            .setLabel(sanitizeLabel(field.label ?? field.key ?? "Question", "Question"))
            .setRequired(Boolean(field.required))
            .setStyle(pickInputStyle(field));

        const placeholder =
            (typeof field.options === "object" && field.options && "placeholder" in field.options
                ? String(field.options.placeholder ?? "")
                : "") || "";
        if (placeholder) {
            input.setPlaceholder(placeholder.slice(0, 100));
        }

        modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    }

    return modal;
}

function buildStepValue(step: SupportCategory["steps"][number]): string {
    if (!Array.isArray(step.fields) || step.fields.length === 0) {
        return "Please provide any relevant information.";
    }

    const lines = step.fields.map((field) => {
        const required = field.required ? " *(required)*" : "";
        return `• **${field.label ?? field.key}**${required}`;
    });

    const joined = lines.join("\n");
    if (joined.length <= 900) {
        return joined;
    }

    return (
        chunkString(joined, 900)
            .map((chunk, index) => `${index === 0 ? "" : "— "}${chunk}`)
            .join("\n")
    );
}

async function resolveChannel(
    interaction: Interaction,
    channelId: string,
): Promise<TextChannel | null> {
    const guild = interaction.guild;
    if (!guild) {
        return null;
    }
    const cached = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
    return isGuildTextChannel(cached) ? cached : null;
}

function buildPanelEmbed(
    title: string,
    description: string,
    color: number,
    categories: SupportCategory[],
): EmbedBuilder {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setFooter({ text: "Select a category below to open a ticket." });

    const preview = categories
        .slice(0, 3)
        .map((category) => `• **${category.name}** — ${category.description ?? "No description"}`)
        .join("\n");
    if (preview.length > 0) {
        embed.addFields({ name: "Available Categories", value: preview });
    }

    return embed;
}

function buildCategorySelect(
    categories: SupportCategory[],
    buttonLabel: string,
    panelType: "dropdown" | "buttons" = TICKET_PANEL_TYPE,
): 
    | { buttonRows: ActionRowBuilder<MessageActionRowComponentBuilder>[]; reminderRow: ActionRowBuilder<MessageActionRowComponentBuilder> }
    | { selectRow: ActionRowBuilder<MessageActionRowComponentBuilder>; buttonRow: ActionRowBuilder<MessageActionRowComponentBuilder> } {
    if (panelType === "buttons") {
        const categoryButtons = categories.slice(0, 25).map((category) =>
            new ButtonBuilder()
                .setCustomId(`ticket:category-button:${category.slug}`)
                .setLabel(category.name.slice(0, 80))
                .setStyle(ButtonStyle.Primary),
        );

        const buttonRows = chunkButtons(categoryButtons, 5).map((chunk) =>
            new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(chunk),
        );

        const reminderButton = new ButtonBuilder()
            .setCustomId("ticket:category-reminder")
            .setLabel(buttonLabel || "Need help picking?")
            .setStyle(ButtonStyle.Secondary);

        const reminderRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(reminderButton);

        return { buttonRows, reminderRow };
    } else {
        const select = new StringSelectMenuBuilder()
            .setCustomId("ticket:category-select")
            .setPlaceholder("Select a ticket category")
            .setMinValues(1)
            .setMaxValues(1);

        const options = categories.slice(0, 25).map((category) =>
            new StringSelectMenuOptionBuilder()
                .setLabel(category.name.slice(0, 100))
                .setValue(category.slug)
                .setDescription((category.description ?? "Create this ticket").slice(0, 100)),
        );

        select.addOptions(options);

        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select);
        const button = new ButtonBuilder()
            .setCustomId("ticket:category-reminder")
            .setLabel(buttonLabel || "Need help picking?")
            .setStyle(ButtonStyle.Secondary);

        const buttonRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(button);

        return { selectRow: row, buttonRow };
    }
}

function chunkButtons<T>(items: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
}

function sanitizeChannelName(userTag: string, categorySlug: string): string {
    const safeUser = userTag
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 20);
    const safeSlug = categorySlug
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 20);
    const unique = randomUUID().split("-")[0];
    return `ticket-${safeSlug}-${safeUser}-${unique}`.slice(0, 90);
}

function canManageTicket(member: GuildMember | null, ownerId: string): boolean {
    if (!member) {
        return false;
    }
    if (member.id === ownerId) {
        return true;
    }
    if (member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return true;
    }
    return SUPPORT_ROLE_IDS.some((roleId) => member.roles.cache.has(roleId));
}

async function ensureParentCategory(
    guildChannel: GuildBasedChannel | null,
    parentId?: string,
    guild?: import("discord.js").Guild,
): Promise<CategoryChannel | null> {
    if (!parentId) {
        return null;
    }
    const targetGuild = guild ?? guildChannel?.guild;
    if (!targetGuild) {
        return null;
    }

    const parent =
        targetGuild.channels.cache.get(parentId) ??
        (await targetGuild.channels.fetch(parentId).catch(() => null));

    if (parent && parent.type === ChannelType.GuildCategory) {
        return parent as CategoryChannel;
    }
    return null;
}

async function sendCreationEmbed(
    channel: TextChannel,
    category: SupportCategory,
    ownerMention: string,
    pingMentions: string[],
): Promise<{ message: Message; thread: ThreadChannel | null }> {
    const embed = new EmbedBuilder()
        .setTitle(`Ticket • ${category.name}`)
        .setDescription(
            `Hello ${ownerMention}! A member of staff will be with you shortly.\n` +
                `Use the buttons or prompts in this channel to provide the requested information.`,
        )
        .setColor(DEFAULT_EMBED_COLOR)
        .setTimestamp();

    const closeButton = new ButtonBuilder()
        .setCustomId(`ticket:close:${channel.id}`)
        .setLabel("Close Ticket")
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(closeButton);
    const mentionString = [ownerMention, ...pingMentions.map((id) => `<@&${id}>`)]
        .filter(Boolean)
        .join(" ");
    
    let message: Message;
    if (SUPPORT_BOT_TOKEN && supportClient) {
        try {
            const guild = channel.guild;
            if (guild) {
                const supportGuild = supportClient.guilds.cache.get(guild.id) ?? await supportClient.guilds.fetch(guild.id).catch(() => null);
                if (supportGuild) {
                    const supportChannel = supportGuild.channels.cache.get(channel.id) ?? await supportGuild.channels.fetch(channel.id).catch(() => null);
                    if (supportChannel && isGuildTextChannel(supportChannel)) {
                        message = await supportChannel.send({ content: mentionString, embeds: [embed], components: [row] });
                        let thread: ThreadChannel | null = null;
                        try {
                            thread = await message.startThread({
                                name: `${category.name} Responses`,
                                autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
                            });
                        } catch (error) {
                            console.warn(
                                `[${new Date().toISOString()}] Failed to start thread for ticket channel ${channel.id}:`,
                                error,
                            );
                        }
                        return { message, thread };
                    }
                }
            }
        } catch (error) {
            console.warn(`[${new Date().toISOString()}] Failed to send message via support client, falling back to regular client:`, error);
        }
    }
    
    message = await channel.send({ content: mentionString, embeds: [embed], components: [row] });

    let thread: ThreadChannel | null = null;
    try {
        thread = await message.startThread({
            name: `${category.name} Responses`,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        });
    } catch (error) {
        console.warn(
            `[${new Date().toISOString()}] Failed to start thread for ticket channel ${channel.id}:`,
            error,
        );
    }

    return { message, thread };
}

function buildFieldSummary(prompts: FieldPrompt[], answers: Record<string, string>): string[] {
    return prompts.map((prompt) => {
        const question = prompt.field.label ?? prompt.field.key ?? "Question";
        const answer = answers[prompt.field.key] ?? "";
        const trimmed = answer.trim();
        return `**${question}**\n${trimmed.length > 0 ? trimmed : "_No response provided._"}`;
    });
}

async function postTicketAnswers(options: {
    channel: TextChannel;
    ticketId: string | null;
    prompts: FieldPrompt[];
    answers: Record<string, string>;
    submittedBy: string;
    categoryName: string;
    pageIndex: number;
    thread?: ThreadChannel | null;
    threadId?: string | null;
}): Promise<void> {
    const { channel, ticketId, prompts, answers, submittedBy, categoryName, pageIndex } = options;
    let target: TextChannel | ThreadChannel = channel;
    if (options.thread) {
        target = options.thread;
    } else if (options.threadId) {
        const fetchedThread =
            channel.threads.cache.get(options.threadId) ??
            (await channel.threads.fetch(options.threadId).catch(() => null));
        if (fetchedThread) {
            target = fetchedThread;
        }
    }
    if (prompts.length === 0) {
        return;
    }

    const summaryLines = buildFieldSummary(prompts, answers);

    const embed = new EmbedBuilder()
        .setTitle(`${categoryName} • Questions #${pageIndex + 1}`)
        .setColor(DEFAULT_EMBED_COLOR)
        .setTimestamp();

    for (const prompt of prompts) {
        const question = prompt.field.label ?? prompt.field.key ?? "Question";
        const answer = answers[prompt.field.key] ?? "";
        const value = answer.trim().length > 0 ? answer.trim() : "_No response provided._";
        embed.addFields({
            name: question.slice(0, 256),
            value: value.slice(0, 1024),
        });
    }

    await target.send({
        content: `📝 <@${submittedBy}> submitted their answers.`,
        embeds: [embed],
    });

    if (ticketId) {
        const apiContent = summaryLines.join("\n\n").slice(0, 1900);
        await TicketApi.postMessage(ticketId, {
            content: `Questions #${pageIndex + 1} responses:\n${apiContent}`,
            discordUserId: submittedBy,
            metadata: {
                questionPage: pageIndex + 1,
                discordUserId: submittedBy,
                threadId: target.id !== channel.id ? target.id : undefined,
            },
        });
    }
}

async function createTicketChannelForUser(options: TicketChannelCreationOptions): Promise<TicketCreationResult> {
    const { interaction, category, panelConfig, answers, bypassCooldown } = options;
    const userId = interaction.user.id;
    
    let targetGuild = interaction.guild;
    let isDmMode = false;
    
    if (TICKET_MODE === "dm") {
        if (!TICKET_DM_GUILD_ID) {
            return {
                success: false,
                error: "DM mode is enabled but TICKET_DM_GUILD_ID is not configured.",
            };
        }
        
        const client = interaction.client;
        const dmGuild = client.guilds.cache.get(TICKET_DM_GUILD_ID) ?? await client.guilds.fetch(TICKET_DM_GUILD_ID).catch(() => null);
        
        if (!dmGuild) {
            return {
                success: false,
                error: "Unable to access the configured DM guild. Please check TICKET_DM_GUILD_ID.",
            };
        }
        
        targetGuild = dmGuild;
        isDmMode = true;
    } else {
        if (!targetGuild) {
            return {
                success: false,
                error: "Unable to create a ticket outside of a guild.",
            };
        }
    }

    const openTickets = TicketRegistry.getOpenTicketsForUser(userId, category.slug);
    if (!bypassCooldown && category.maxTicketsPerUser && openTickets.length >= category.maxTicketsPerUser) {
        return {
            success: false,
            error: `You already have ${openTickets.length} open ticket(s) in **${category.name}**. Please close them before creating another.`,
        };
    }

    if (!bypassCooldown && category.ticketCooldownMinutes && category.maxTicketsPerCooldown) {
        const recentTickets = TicketRegistry.getRecentTicketsForUser(
            userId,
            category.slug,
            category.ticketCooldownMinutes,
        );
        if (recentTickets.length >= category.maxTicketsPerCooldown) {
            const oldest = recentTickets.sort((a, b) => a.createdAt - b.createdAt)[0];
            const availableAt = oldest.createdAt + category.ticketCooldownMinutes * 60_000;
            const remainingMs = Math.max(availableAt - Date.now(), 0);
            const remainingMinutes = Math.ceil(remainingMs / 60_000);

            return {
                success: false,
                error: `You have reached the limit for **${category.name}** tickets. Please wait about ${remainingMinutes} minute(s) before trying again.`,
            };
        }
    }

    const sourceChannel = !isDmMode
        ? ((interaction.channel as GuildBasedChannel | null) ??
            (panelConfig.channelId
                ? ((targetGuild.channels.cache.get(panelConfig.channelId) ??
                    (await targetGuild.channels.fetch(panelConfig.channelId).catch(() => null))) as GuildBasedChannel | null)
                : null))
        : null;

    const parentCategoryId = isDmMode ? TICKET_DM_CHANNEL_CATEGORY_ID : panelConfig.parentCategoryId;
    const parentCategory = await ensureParentCategory(sourceChannel, parentCategoryId ?? undefined, isDmMode ? targetGuild : undefined);
    const everyoneRole = targetGuild.roles.everyone;
    const permissionOverwrites = [
        {
            id: everyoneRole.id,
            deny: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
            ],
        },
        {
            id: userId,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.ReadMessageHistory,
            ],
        },
    ];

    const allowedRoleIds = new Set<string>();

    const pushSupportRole = async (roleId: string) => {
        if (!roleId) {
            return;
        }

        if (allowedRoleIds.has(roleId)) {
            return;
        }

        const supportRole =
            targetGuild.roles.cache.get(roleId) ?? (await targetGuild.roles.fetch(roleId).catch(() => null));
        if (!supportRole) {
            return;
        }

        allowedRoleIds.add(roleId);
        permissionOverwrites.push({
            id: supportRole.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
            ],
        });
    };

    for (const roleId of SUPPORT_ROLE_IDS) {
        await pushSupportRole(roleId);
    }

    const categoryAccess = Array.isArray(CATEGORY_ACCESS_ROLES[category.slug])
        ? CATEGORY_ACCESS_ROLES[category.slug]
        : [];

    for (const roleId of categoryAccess) {
        await pushSupportRole(roleId);
    }

    const pingRoleIds = Array.isArray(CATEGORY_PING_ROLES[category.slug])
        ? CATEGORY_PING_ROLES[category.slug].filter(
              (roleId): roleId is string => typeof roleId === "string" && roleId.length > 0,
          )
        : [];

    for (const roleId of pingRoleIds) {
        await pushSupportRole(roleId);
    }

    const channelName = sanitizeChannelName(interaction.user.username, category.slug);
    const topic = `Ticket owner: ${interaction.user.tag} (${interaction.user.id}) • Category: ${category.name}${isDmMode ? " • DM Mode" : ""}`;

    if (isDmMode) {
        const userOverwriteIndex = permissionOverwrites.findIndex((overwrite) => overwrite.id === userId);
        if (userOverwriteIndex !== -1) {
            permissionOverwrites.splice(userOverwriteIndex, 1);
        }
    }

    const ticketChannel = await targetGuild.channels
        .create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: parentCategory?.id,
            topic: topic.slice(0, 1024),
            permissionOverwrites,
            reason: `Ticket created by ${interaction.user.tag} (${interaction.user.id}) for category ${category.slug}${isDmMode ? " (DM Mode)" : ""}`,
        })
        .catch((error) => {
            console.error(`[${new Date().toISOString()}] Failed to create ticket channel`, error);
            return null;
        });

    if (!ticketChannel || ticketChannel.type !== ChannelType.GuildText) {
        return {
            success: false,
            error: "I couldn't create the ticket channel. Please contact staff.",
        };
    }

    const ticketId = await TicketApi.createTicket({
        categorySlug: category.slug,
        discordUserId: userId,
        guildId: targetGuild.id,
        channelId: ticketChannel.id,
        answers,
    });

    TicketRegistry.add({
        channelId: ticketChannel.id,
        guildId: targetGuild.id,
        ownerId: userId,
        categorySlug: category.slug,
        ticketId: ticketId ?? null,
        createdAt: Date.now(),
        isDmMode,
    });

    const creation = await sendCreationEmbed(ticketChannel, category, `<@${userId}>`, pingRoleIds);
    const thread = creation.thread;
    const threadId = thread?.id ?? null;

    if (isDmMode) {
        try {
            const clientForDm = SUPPORT_BOT_TOKEN && supportClient ? supportClient : interaction.client;
            const user = await clientForDm.users.fetch(userId);
            const dmEmbed = new EmbedBuilder()
                .setTitle(`Ticket • ${category.name}`)
                .setDescription(
                    `Hello! Your ticket has been created. A member of staff will be with you shortly.\n` +
                    `You can reply to this DM to send messages to the support team.`,
                )
                .setColor(DEFAULT_EMBED_COLOR)
                .setTimestamp();

            await user.send({ embeds: [dmEmbed] }).catch((error) => {
                console.warn(`[${new Date().toISOString()}] Failed to send DM to user ${userId}:`, error);
            });
        } catch (error) {
            console.warn(`[${new Date().toISOString()}] Failed to fetch user or send DM for ticket:`, error);
        }
    }

    const apiWarning = ticketId
        ? undefined
        : "\n⚠️ Ticket channel created locally, but the website API rejected ticket creation. Staff should review API logs.";

    return {
        success: true,
        channel: ticketChannel,
        ticketId: ticketId ?? null,
        creationMessageId: creation.message.id,
        threadId,
        thread,
        apiWarning,
    };
}

@Discord()
@SlashGroup({ name: "panel", description: "Panel management commands" })
export class TicketPanelAddon {
    @Slash({ name: "send", description: "Send a configured panel" })
    @SlashGroup("panel")
    @Guard(
        PermissionGuard(["ManageChannels"], {
            content: "You need the Manage Channels permission to configure the ticket panel.",
        }),
    )
    async sendPanel(
        @SlashChoice({ name: "Tickets", value: "tickets" })
        @SlashOption({
            name: "panel_type",
            description: "Which panel would you like to send?",
            type: ApplicationCommandOptionType.String,
            required: true,
        })
        panelType: string,
        @SlashOption({
            name: "channel",
            description: "Channel to send the panel to",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
            required: true,
        })
        targetChannel: GuildBasedChannel,
        @SlashOption({
            name: "ticket_category",
            description: "Discord category to create ticket channels under",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildCategory],
            required: false,
        })
        ticketParent: GuildBasedChannel | undefined,
        interaction: ChatInputCommandInteraction,
    ): Promise<void> {
        try {
            if (panelType !== "tickets") {
                await interaction.reply({
                    content: "That panel type is not supported yet.",
                    ephemeral: true,
                });
                return;
            }

            if (!interaction.inCachedGuild()) {
                await interaction.reply({
                    content: "This command can only be used inside a guild.",
                    ephemeral: true,
                });
                return;
            }

            const sendableChannel = targetChannel as GuildBasedChannel;
            if (
                sendableChannel.type !== ChannelType.GuildText &&
                sendableChannel.type !== ChannelType.GuildAnnouncement
            ) {
                await interaction.reply({
                    content: "The selected channel is not text-based. Please choose a text channel.",
                    ephemeral: true,
                });
                return;
            }

            const sessionId = randomUUID();
            panelSessions.set(sessionId, {
                id: sessionId,
                guildId: interaction.guildId,
                createdBy: interaction.user.id,
                targetChannelId: sendableChannel.id,
                ticketParentId: ticketParent?.id,
            });

            const modal = new ModalBuilder()
                .setTitle("Ticket Panel Builder")
                .setCustomId(`ticket:panel-builder:${sessionId}`);

            const titleInput = new TextInputBuilder()
                .setCustomId("panel-title")
                .setLabel("Embed Title")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue("Need support? Open a ticket!");

            const descriptionInput = new TextInputBuilder()
                .setCustomId("panel-description")
                .setLabel("Embed Description")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setValue("Use the menu below to pick the type of ticket you need help with.");

            const colorInput = new TextInputBuilder()
                .setCustomId("panel-color")
                .setLabel("Embed Accent Colour (hex)")
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setPlaceholder("e.g. 0099FF");

            const buttonInput = new TextInputBuilder()
                .setCustomId("panel-button-label")
                .setLabel("Helper Button Label")
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setPlaceholder("Optional");

            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(colorInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(buttonInput),
            );

            await interaction.showModal(modal);

            setTimeout(() => {
                panelSessions.delete(sessionId);
            }, 5 * 60_000);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error handling /panel send tickets`, error);
            if (!interaction.replied && !interaction.deferred) {
                await interaction
                    .reply({
                        content:
                            "Something went wrong while opening the panel builder. Please try again or contact an administrator.",
                        ephemeral: true,
                    })
                    .catch(() => null);
            }
        }
    }

    @ModalComponent({ id: /^ticket:panel-builder:/ })
    async handlePanelModal(interaction: ModalSubmitInteraction): Promise<void> {
        try {
            const [, , sessionId] = interaction.customId.split(":");
            const session = panelSessions.get(sessionId);
            if (!session) {
                await interaction.reply({
                    content: "This panel builder session has expired. Please run the command again.",
                    ephemeral: true,
                });
                return;
            }

            panelSessions.delete(sessionId);

            const title = interaction.fields.getTextInputValue("panel-title")?.trim() ?? "Support Tickets";
            const description =
                interaction.fields.getTextInputValue("panel-description")?.trim() ??
                "Select a category below to open a ticket with our team.";
            const color = parseHexColor(interaction.fields.getTextInputValue("panel-color"));
            const buttonLabel = interaction.fields.getTextInputValue("panel-button-label")?.trim() ?? "";

            const target = await resolveChannel(interaction, session.targetChannelId);
            if (!target) {
                await interaction.reply({
                    content: "I can no longer access the target channel. Please try again.",
                    ephemeral: true,
                });
                return;
            }

            const categories = await TicketApi.fetchCategories(true);
            if (categories.length === 0) {
                await interaction.reply({
                    content:
                        "Unable to fetch ticket categories from the website API. Please check the configuration.",
                    ephemeral: true,
                });
                return;
            }

            const embed = buildPanelEmbed(title, description, color, categories);
            const categoryComponents = buildCategorySelect(categories, buttonLabel);

            let components: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
            if (TICKET_PANEL_TYPE === "buttons" && "buttonRows" in categoryComponents) {
                components = categoryComponents.buttonRows;
                if (buttonLabel) {
                    components.push(categoryComponents.reminderRow);
                }
            } else if ("selectRow" in categoryComponents) {
                components = [categoryComponents.selectRow];
                if (buttonLabel) {
                    components.push(categoryComponents.buttonRow);
                }
            }

            let message: Message;
            if (SUPPORT_BOT_TOKEN && supportClient && supportClient.user) {
                try {
                    console.log(`[${new Date().toISOString()}] Attempting to send ticket panel via support client`);
                    const guild = target.guild;
                    if (guild) {
                        const supportGuild = supportClient.guilds.cache.get(guild.id) ?? await supportClient.guilds.fetch(guild.id).catch((error) => {
                            console.error(`[${new Date().toISOString()}] Failed to fetch support guild ${guild.id}:`, error);
                            return null;
                        });
                        if (supportGuild) {
                            console.log(`[${new Date().toISOString()}] Found support guild: ${supportGuild.name}`);
                            const supportChannel = supportGuild.channels.cache.get(target.id) ?? await supportGuild.channels.fetch(target.id).catch((error) => {
                                console.error(`[${new Date().toISOString()}] Failed to fetch support channel ${target.id}:`, error);
                                return null;
                            });
                            if (supportChannel && isGuildTextChannel(supportChannel)) {
                                console.log(`[${new Date().toISOString()}] Sending panel via support client to channel ${supportChannel.name}`);
                                message = await supportChannel.send({
                                    embeds: [embed],
                                    components,
                                });
                                console.log(`[${new Date().toISOString()}] Successfully sent panel via support client`);
                            } else {
                                console.warn(`[${new Date().toISOString()}] Support channel not found or not a text channel, falling back to regular client`);
                                message = await target.send({
                                    embeds: [embed],
                                    components,
                                });
                            }
                        } else {
                            console.warn(`[${new Date().toISOString()}] Support guild not found, falling back to regular client`);
                            message = await target.send({
                                embeds: [embed],
                                components,
                            });
                        }
                    } else {
                        console.warn(`[${new Date().toISOString()}] Target has no guild, falling back to regular client`);
                        message = await target.send({
                            embeds: [embed],
                            components,
                        });
                    }
                } catch (error) {
                    console.error(`[${new Date().toISOString()}] Error sending panel via support client:`, error);
                    console.warn(`[${new Date().toISOString()}] Falling back to regular client`);
                    message = await target.send({
                        embeds: [embed],
                        components,
                    });
                }
            } else {
                console.log(`[${new Date().toISOString()}] Using regular client to send panel (SUPPORT_BOT_TOKEN=${!!SUPPORT_BOT_TOKEN}, supportClient=${!!supportClient}, supportClient.user=${!!(supportClient?.user)})`);
                message = await target.send({
                    embeds: [embed],
                    components,
                });
            }

            if (!message) {
                throw new Error("Failed to send panel message - message is undefined");
            }

            panelConfigs.set(message.id, {
                guildId: message.guildId ?? session.guildId,
                channelId: message.channelId,
                parentCategoryId: session.ticketParentId,
                createdBy: session.createdBy,
                createdAt: Date.now(),
            });

            console.log(`[${new Date().toISOString()}] Panel sent successfully, message ID: ${message.id}`);
            await interaction.reply({
                content: `Ticket panel sent to <#${target.id}>.`,
                ephemeral: true,
            });
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error handling panel modal:`, error);
            console.error(`[${new Date().toISOString()}] Error stack:`, error instanceof Error ? error.stack : "No stack trace");
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: "Something went wrong. Try again.",
                    ephemeral: true,
                }).catch((replyError) => {
                    console.error(`[${new Date().toISOString()}] Failed to send error reply:`, replyError);
                });
            }
        }
    }

    @ButtonComponent({ id: "ticket:category-reminder" })
    async handleReminderButton(interaction: ButtonInteraction): Promise<void> {
        const panelConfig = panelConfigs.get(interaction.message.id);
        const isButtons = TICKET_PANEL_TYPE === "buttons";
        const message = isButtons
            ? "Click the most relevant category button to make sure your ticket reaches the right team. If you're unsure, choose the closest match and staff will guide you."
            : "Select the most relevant category from the dropdown to make sure your ticket reaches the right team. If you're unsure, choose the closest match and staff will guide you.";
        
        await interaction.reply({
            content: message,
            ephemeral: true,
        });
    }

    async handleCategorySelection(
        interaction: StringSelectMenuInteraction | ButtonInteraction,
        slug: string,
    ): Promise<void> {
        const panelConfig = panelConfigs.get(interaction.message.id);
        if (!panelConfig) {
            await interaction.reply({
                content: "This ticket panel is no longer active. Please ask staff to resend it.",
                ephemeral: true,
            });
            return;
        }

        const categories = await TicketApi.fetchCategories(true);
        if (categories.length === 0) {
            await interaction.reply({
                content: "Unable to fetch ticket categories. Please try again later.",
                ephemeral: true,
            });
            return;
        }
        
        const category = categories.find((item) => item.slug === slug);
        if (!category) {
            console.error(`[${new Date().toISOString()}] Category not found. Slug: "${slug}", Available slugs: ${categories.map(c => c.slug).join(", ")}`);
            await interaction.reply({
                content: "That category is no longer available. Please pick another option.",
                ephemeral: true,
            });
            return;
        }

        const prompts = flattenCategoryFields(category);
        const bypassCooldown = interaction.member instanceof GuildMember
            ? interaction.member.roles.cache.has(COOLDOWN_BYPASS_ROLE_ID)
            : false;

        if (prompts.length === 0) {
            await interaction.deferReply({ ephemeral: true });

            const result = await createTicketChannelForUser({
                interaction,
                category,
                panelConfig,
                answers: {},
                initialFields: [],
                bypassCooldown,
            });

            if (!result.success) {
                await interaction.editReply({ content: result.error });
                return;
            }

            const responseMessage = `Ticket created: <#${result.channel.id}>${result.apiWarning ?? ""}`;
            await interaction.editReply({ content: responseMessage });
            return;
        }

        const pages = chunkPrompts(prompts).map((fields, index) => ({ index, fields }));
        const sessionId = randomUUID();
        const session: TicketCreationSession = {
            id: sessionId,
            userId: interaction.user.id,
            guildId: interaction.guildId ?? "",
            category,
            panelConfig,
            pages,
            responses: new Map(),
            createdAt: Date.now(),
        };

        ticketCreationSessions.set(sessionId, session);

        const modal = buildQuestionModal(sessionId, pages[0], category.name);
        await interaction.showModal(modal);

        setTimeout(() => {
            const existing = ticketCreationSessions.get(sessionId);
            if (existing && Date.now() - existing.createdAt > 10 * 60_000) {
                ticketCreationSessions.delete(sessionId);
            }
        }, 10 * 60_000);
    }

    @SelectMenuComponent({ id: "ticket:category-select" })
    async handleCategorySelect(interaction: StringSelectMenuInteraction): Promise<void> {
        const slug = interaction.values[0];
        await this.handleCategorySelection(interaction, slug);
    }

    @ButtonComponent({ id: /^ticket:category-button:/ })
    async handleCategoryButton(interaction: ButtonInteraction): Promise<void> {
        const parts = interaction.customId.split(":");
        const slug = parts.slice(2).join(":");
        if (!slug) {
            await interaction.reply({
                content: "Invalid category button. Please try again.",
                ephemeral: true,
            });
            return;
        }
        await this.handleCategorySelection(interaction, slug);
    }

    @ModalComponent({ id: /^ticket:create:/ })
    async handleTicketCreateModal(interaction: ModalSubmitInteraction): Promise<void> {
        const [, , sessionId, pageIndexRaw] = interaction.customId.split(":");
        const pageIndex = Number.parseInt(pageIndexRaw ?? "0", 10);

        const session = ticketCreationSessions.get(sessionId);
        if (!session) {
            await interaction.reply({
                content: "This ticket request has expired. Please try again.",
                ephemeral: true,
            });
            return;
        }

        const page = session.pages[pageIndex];
        if (!page) {
            await interaction.reply({
                content: "Unable to locate the questions for this ticket. Please try again.",
                ephemeral: true,
            });
            return;
        }

        for (const prompt of page.fields) {
            const value = interaction.fields.getTextInputValue(getFieldInputId(prompt.field));
            session.responses.set(prompt.field.key, value.trim());
        }

        await interaction.deferReply({ ephemeral: true });

        const answersObject = Object.fromEntries(session.responses.entries());
        const bypassCooldown = interaction.member instanceof GuildMember
            ? interaction.member.roles.cache.has(COOLDOWN_BYPASS_ROLE_ID)
            : false;

        const result = await createTicketChannelForUser({
            interaction,
            category: session.category,
            panelConfig: session.panelConfig,
            answers: answersObject,
            initialFields: page.fields,
            bypassCooldown,
        });

        if (!result.success) {
            ticketCreationSessions.delete(sessionId);
            await interaction.editReply({ content: result.error });
            return;
        }

        await postTicketAnswers({
            channel: result.channel,
            ticketId: result.ticketId,
            prompts: page.fields,
            answers: answersObject,
            submittedBy: interaction.user.id,
            categoryName: session.category.name,
            pageIndex,
            thread: result.thread,
            threadId: result.threadId,
        });

        const remainingPages = session.pages.slice(pageIndex + 1);
        const followupEntries: { id: string; page: TicketQuestionPage }[] = [];

        if (remainingPages.length > 0) {
            const buttons: ButtonBuilder[] = [];
            for (const followupPage of remainingPages) {
                const followupId = `${session.id}-${followupPage.index}-${randomUUID().slice(0, 8)}`;
                followupEntries.push({ id: followupId, page: followupPage });
                ticketFollowupSessions.set(followupId, {
                    id: followupId,
                    channelId: result.channel.id,
                    messageId: "",
                    ticketId: result.ticketId,
                    ownerId: session.userId,
                    categoryName: session.category.name,
                    pageIndex: followupPage.index,
                    fields: followupPage.fields,
                    threadId: result.threadId,
                    createdAt: Date.now(),
                });

                const button = new ButtonBuilder()
                    .setCustomId(`ticket:followup:${followupId}`)
                    .setLabel(`Answer Questions #${followupPage.index + 1}`)
                    .setStyle(ButtonStyle.Primary);
                buttons.push(button);
            }

            const rows = chunkButtons(buttons, 5).map((chunk) =>
                new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(chunk),
            );

            const followupMessage = await result.channel.send({
                content: `<@${session.userId}> please complete the remaining question set(s) below.`,
                components: rows,
            });

            for (const entry of followupEntries) {
                const record = ticketFollowupSessions.get(entry.id);
                if (record) {
                    record.messageId = followupMessage.id;
                    ticketFollowupSessions.set(entry.id, record);
                    setTimeout(() => {
                        ticketFollowupSessions.delete(entry.id);
                    }, 60 * 60_000);
                }
            }
        }

        ticketCreationSessions.delete(sessionId);

        const followupNotice =
            remainingPages.length > 0
                ? "\nPlease use the buttons in the ticket to answer the remaining questions."
                : "";

        await interaction.editReply({
            content: `Ticket created: <#${result.channel.id}>${result.apiWarning ?? ""}${followupNotice}`,
        });
    }

    @ButtonComponent({ id: /^ticket:followup:/ })
    async handleFollowupButton(interaction: ButtonInteraction): Promise<void> {
        const [, , followupId] = interaction.customId.split(":");
        const followup = ticketFollowupSessions.get(followupId);
        if (!followup) {
            await interaction.reply({
                content: "These questions were already answered or have expired.",
                ephemeral: true,
            });
            return;
        }

        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({
                content: "Unable to continue this questionnaire outside of a guild.",
                ephemeral: true,
            });
            return;
        }

        const member =
            interaction.member instanceof GuildMember
                ? interaction.member
                : guild.members.cache.get(interaction.user.id) ??
                  (await guild.members.fetch(interaction.user.id).catch(() => null));

        if (!canManageTicket(member ?? null, followup.ownerId)) {
            await interaction.reply({
                content: "Only the ticket owner or staff can answer these questions.",
                ephemeral: true,
            });
            return;
        }

        const modal = buildFollowupModal(
            followupId,
            followup.pageIndex,
            followup.categoryName,
            followup.fields,
        );

        await interaction.showModal(modal);
    }

    @ModalComponent({ id: /^ticket:followup-modal:/ })
    async handleFollowupModal(interaction: ModalSubmitInteraction): Promise<void> {
        const [, , followupId] = interaction.customId.split(":");
        const followup = ticketFollowupSessions.get(followupId);
        if (!followup) {
            await interaction.reply({
                content: "These questions were already answered or have expired.",
                ephemeral: true,
            });
            return;
        }

        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({
                content: "Unable to record responses outside of a guild.",
                ephemeral: true,
            });
            return;
        }

        const channel =
            guild.channels.cache.get(followup.channelId) ??
            (await guild.channels.fetch(followup.channelId).catch(() => null));
        if (!isGuildTextChannel(channel)) {
            ticketFollowupSessions.delete(followupId);
            await interaction.reply({
                content: "This ticket channel no longer exists.",
                ephemeral: true,
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });

        const answers: Record<string, string> = {};
        for (const prompt of followup.fields) {
            const value = interaction.fields.getTextInputValue(getFieldInputId(prompt.field));
            answers[prompt.field.key] = value.trim();
        }

        const threadChannel =
            followup.threadId
                ? (channel.threads.cache.get(followup.threadId) ??
                    (await channel.threads.fetch(followup.threadId).catch(() => null)))
                : null;

        await postTicketAnswers({
            channel,
            ticketId: followup.ticketId,
            prompts: followup.fields,
            answers,
            submittedBy: interaction.user.id,
            categoryName: followup.categoryName,
            pageIndex: followup.pageIndex,
            thread: threadChannel ?? null,
            threadId: followup.threadId,
        });

        const message = await channel.messages.fetch(followup.messageId).catch(() => null);
        if (message) {
            const updatedRows = message.components.map((row) => {
                const builder = new ActionRowBuilder<MessageActionRowComponentBuilder>();
                if ('components' in row && Array.isArray(row.components)) {
                    for (const component of row.components) {
                        if (component.type === ComponentType.Button) {
                            const button = ButtonBuilder.from(component as any);
                            const componentCustomId =
                                (component as any).customId ?? (component as any).data?.custom_id;
                            if (componentCustomId === `ticket:followup:${followupId}`) {
                                button.setDisabled(true);
                            }
                            builder.addComponents(button);
                        }
                    }
                }
                return builder;
            });

            await message.edit({ components: updatedRows });
        }

        ticketFollowupSessions.delete(followupId);

        await interaction.editReply({
            content: "Thanks! Your responses were recorded.",
        });
    }

    @ButtonComponent({ id: /^ticket:close:/ })
    async handleCloseButton(interaction: ButtonInteraction): Promise<void> {
        const [, , channelId] = interaction.customId.split(":");
        const ticket = TicketRegistry.getByChannel(channelId);
        if (!ticket) {
            await interaction.reply({
                content: "I couldn't find data for this ticket. It may already be closed.",
                ephemeral: true,
            });
            return;
        }

        const guild = interaction.guild ?? (interaction.client.guilds.cache.get(ticket.guildId) ?? await interaction.client.guilds.fetch(ticket.guildId).catch(() => null));
        if (!guild) {
            await interaction.reply({
                content: "Unable to close ticket - guild not found.",
                ephemeral: true,
            });
            return;
        }

        const member =
            interaction.member instanceof GuildMember
                ? interaction.member
                : guild.members.cache.get(interaction.user.id) ??
                  (await guild.members.fetch(interaction.user.id).catch(() => null));

        if (!canManageTicket(member ?? null, ticket.ownerId)) {
            await interaction.reply({
                content: "Only the ticket owner or staff can close this ticket.",
                ephemeral: true,
            });
            return;
        }

        const channel =
            guild.channels.cache.get(ticket.channelId) ??
            (await guild.channels.fetch(ticket.channelId).catch(() => null));

        if (!isGuildTextChannel(channel)) {
            TicketRegistry.close(ticket.channelId);
            await interaction.reply({
                content: "This ticket channel no longer exists.",
                ephemeral: true,
            });
            return;
        }

        TicketRegistry.close(ticket.channelId);

        const websiteClose = await TicketApi.closeTicket(ticket.ticketId);

        if (ticket.ticketId) {
            await TicketApi.postMessage(ticket.ticketId, {
                content: `Ticket closed by ${interaction.user.tag} (${interaction.user.id})`,
                discordUserId: interaction.user.id,
                metadata: {
                    discordUserId: interaction.user.id,
                },
            });
        }

        await interaction.reply({
            content: websiteClose.success
                ? "Closing ticket... The website ticket was closed and this channel will be removed shortly."
                : "Closing ticket... This channel will be removed shortly (website ticket may need manual review).",
            ephemeral: true,
        });

        const transcriptButton = ticket.ticketId
            ? new ButtonBuilder()
                  .setLabel("View Transcript")
                  .setStyle(ButtonStyle.Link)
                  .setURL(`https://rusticon.co/ticket/${ticket.ticketId}`)
            : null;

        const channelComponents = transcriptButton
            ? [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(transcriptButton)]
            : [];

        await channel.send({
            content: `🔒 Ticket closed by <@${interaction.user.id}>. This channel will be deleted.`,
            components: channelComponents,
        });

        try {
            const clientForDm = SUPPORT_BOT_TOKEN && supportClient ? supportClient : interaction.client;
            const user = await clientForDm.users.fetch(ticket.ownerId);
            const dmEmbed = new EmbedBuilder()
                .setTitle("Ticket Closed")
                .setDescription(
                    ticket.isDmMode
                        ? `Your ticket **${ticket.categorySlug}** has been closed by ${interaction.user.tag}.`
                        : `Your ticket **${ticket.categorySlug}** has been closed by ${interaction.user.tag}. You can view the transcript using the button below.`
                )
                .setColor(DEFAULT_EMBED_COLOR)
                .setTimestamp();

            const dmComponents = transcriptButton
                ? [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(transcriptButton)]
                : [];

            await user.send({ embeds: [dmEmbed], components: dmComponents }).catch(() => {
            });
        } catch (error) {
        }

        setTimeout(async () => {
            await channel.delete(`Ticket closed by ${interaction.user.tag}`).catch((error: unknown) => {
                console.error(`[${new Date().toISOString()}] Failed to delete ticket channel`, error);
            });
        }, 5_000);
    }

    @On({ event: "messageCreate" })
    async onTicketMessage([message]: ArgsOf<"messageCreate">): Promise<void> {
        if (message.author.bot) {
            return;
        }

        if (SUPPORT_BOT_TOKEN && supportClient) {
            if (message.client.user?.id !== supportClient.user?.id) {
                return;
            }
            if (message.author.id === supportClient.user?.id) {
                return;
            }
        } else {
            if (message.author.id === message.client.user?.id) {
                return;
            }
        }

        const clientToUse = SUPPORT_BOT_TOKEN && supportClient ? supportClient : message.client;

        if (!message.guild && message.channel.type === ChannelType.DM) {
            console.log(`[${new Date().toISOString()}] Received DM from ${message.author.id} (${message.author.tag})`);
            const openTickets = TicketRegistry.getOpenTicketsForUser(message.author.id);
            console.log(`[${new Date().toISOString()}] Found ${openTickets.length} open tickets for user`);
            const dmTickets = openTickets.filter((t) => t.isDmMode);
            console.log(`[${new Date().toISOString()}] Found ${dmTickets.length} DM mode tickets`);
            
            const dmTicket = dmTickets.sort((a, b) => b.createdAt - a.createdAt)[0];
            
            if (dmTicket) {
                console.log(`[${new Date().toISOString()}] Processing DM ticket: channelId=${dmTicket.channelId}, guildId=${dmTicket.guildId}`);
                try {
                    const guild = clientToUse.guilds.cache.get(dmTicket.guildId) ?? await clientToUse.guilds.fetch(dmTicket.guildId).catch((error) => {
                        console.error(`[${new Date().toISOString()}] Failed to fetch guild ${dmTicket.guildId}:`, error);
                        return null;
                    });
                    if (guild) {
                        console.log(`[${new Date().toISOString()}] Found guild: ${guild.name}`);
                        const channel = guild.channels.cache.get(dmTicket.channelId) ?? await guild.channels.fetch(dmTicket.channelId).catch((error) => {
                            console.error(`[${new Date().toISOString()}] Failed to fetch channel ${dmTicket.channelId}:`, error);
                            return null;
                        });
                        if (channel && isGuildTextChannel(channel)) {
                            console.log(`[${new Date().toISOString()}] Found channel: ${channel.name}, forwarding message`);
                            const attachments: string[] = [...message.attachments.values()].map((att) => att.url);
                            const embed = new EmbedBuilder()
                                .setAuthor({
                                    name: message.author.tag,
                                    iconURL: message.author.displayAvatarURL() ?? undefined,
                                })
                                .setDescription(message.content || "(no content)")
                                .setColor(DEFAULT_EMBED_COLOR)
                                .setTimestamp();

                            let content = message.content || "";
                            if (attachments.length > 0) {
                                content += (content ? "\n\n" : "") + "**Attachments:**\n" + attachments.join("\n");
                            }

                            await channel.send({
                                content: content || undefined,
                                embeds: [embed],
                            }).then(() => {
                                console.log(`[${new Date().toISOString()}] Successfully forwarded DM to channel ${channel.id}`);
                            }).catch((error: unknown) => {
                                console.error(`[${new Date().toISOString()}] Failed to forward DM to channel:`, error);
                            });

                            if (dmTicket.ticketId) {
                                await TicketApi.postMessage(dmTicket.ticketId, {
                                    content: message.content || "(no content)",
                                    discordUserId: message.author.id,
                                    attachments: attachments.length > 0 ? attachments : undefined,
                                    metadata: {
                                        messageId: message.id,
                                        channelId: channel.id,
                                        discordUserId: message.author.id,
                                        isDm: true,
                                    },
                                });
                            }
                        } else {
                            console.warn(`[${new Date().toISOString()}] Channel ${dmTicket.channelId} not found or not a text channel`);
                        }
                    } else {
                        console.warn(`[${new Date().toISOString()}] Guild ${dmTicket.guildId} not found`);
                    }
                } catch (error) {
                    console.error(`[${new Date().toISOString()}] Error forwarding DM to channel:`, error);
                }
            } else {
                console.log(`[${new Date().toISOString()}] No DM mode ticket found for user ${message.author.id}`);
            }
            return;
        }

        if (!message.guild) {
            return;
        }

        const ticket = TicketRegistry.getByChannel(message.channelId);
        if (!ticket) {
            return;
        }

        const attachments: string[] = [...message.attachments.values()].map((att) => att.url);

        if (ticket.isDmMode) {
            try {
                const clientForDm = SUPPORT_BOT_TOKEN && supportClient ? supportClient : clientToUse;
                const user = await clientForDm.users.fetch(ticket.ownerId);
                const embed = new EmbedBuilder()
                    .setAuthor({
                        name: message.author.tag,
                        iconURL: message.author.displayAvatarURL() ?? undefined,
                    })
                    .setDescription(message.content || "(no content)")
                    .setColor(DEFAULT_EMBED_COLOR)
                    .setTimestamp();

                let content = message.content || "";
                if (attachments.length > 0) {
                    content += (content ? "\n\n" : "") + "**Attachments:**\n" + attachments.join("\n");
                }

                await user.send({
                    content: content || undefined,
                    embeds: [embed],
                }).catch((error: unknown) => {
                    console.warn(`[${new Date().toISOString()}] Failed to forward channel message to user DM:`, error);
                });
            } catch (error) {
                console.warn(`[${new Date().toISOString()}] Failed to fetch user or send DM:`, error);
            }
        }

        if (ticket.ticketId) {
            await TicketApi.postMessage(ticket.ticketId, {
                content: message.content || "(no content)",
                discordUserId: message.author.id,
                attachments: attachments.length > 0 ? attachments : undefined,
                metadata: {
                    messageId: message.id,
                    channelId: message.channelId,
                    discordUserId: message.author.id,
                },
            });
        }
    }

    @On({ event: "channelDelete" })
    async onChannelDelete([channel]: ArgsOf<"channelDelete">): Promise<void> {
        if (channel.type !== ChannelType.GuildText) {
            return;
        }

        const ticket = TicketRegistry.getByChannel(channel.id);
        if (ticket) {
            TicketRegistry.close(channel.id);
        }
    }

    @On({ event: "interactionCreate" })
    async ensurePanelConfig([interaction]: ArgsOf<"interactionCreate">): Promise<void> {
        if (!interaction.isMessageComponent()) {
            return;
        }

        const isSelectMenu = interaction.componentType === ComponentType.StringSelect;
        const isButton = interaction.componentType === ComponentType.Button;
        
        if (!isSelectMenu && !isButton) {
            return;
        }

        const isCategorySelect = interaction.customId === "ticket:category-select";
        const isCategoryButton = typeof interaction.customId === "string" && interaction.customId.startsWith("ticket:category-button:");

        if (!isCategorySelect && !isCategoryButton) {
            return;
        }

        if (!panelConfigs.has(interaction.message.id)) {
            panelConfigs.set(interaction.message.id, {
                guildId: interaction.guildId ?? "",
                channelId: interaction.channelId ?? "",
                createdBy: interaction.user.id,
                createdAt: Date.now(),
            });
        }
    }
}

