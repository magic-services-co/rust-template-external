import {
    ActionRowBuilder,
    ApplicationCommandOptionType,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ChatInputCommandInteraction,
    EmbedBuilder,
    type GuildBasedChannel,
    type Message,
    type MessageActionRowComponentBuilder,
    ModalBuilder,
    ModalSubmitInteraction,
    TextChannel,
    TextInputBuilder,
    TextInputStyle,
} from "discord.js";
import {
    Discord,
    Guard,
    ModalComponent,
    Slash,
    SlashGroup,
    SlashOption,
} from "discordx";
import { PermissionGuard } from "@discordx/utilities";
import config from "../../config.json";
import { randomUUID } from "crypto";
import { linkClient } from "../../index.ts";

interface LinkPanelSession {
    id: string;
    guildId: string;
    createdBy: string;
    targetChannelId: string;
}

const linkPanelSessions = new Map<string, LinkPanelSession>();

const DEFAULT_EMBED_COLOR = parseHexColor(
    typeof config.EMBED_HEX === "string" ? config.EMBED_HEX : "0099FF",
);
const LINK_BOT_TOKEN: string | null =
    (config as any).LINK_BOT_TOKEN && typeof (config as any).LINK_BOT_TOKEN === "string" && (config as any).LINK_BOT_TOKEN.trim().length > 0
        ? (config as any).LINK_BOT_TOKEN.trim()
        : null;

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

function isGuildTextChannel(channel: any): channel is TextChannel {
    return (
        !!channel &&
        channel.type === ChannelType.GuildText &&
        typeof (channel as TextChannel).send === "function"
    );
}

async function resolveChannel(
    interaction: ModalSubmitInteraction,
    channelId: string,
): Promise<TextChannel | null> {
    const guild = interaction.guild;
    if (!guild) {
        return null;
    }
    const cached = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
    return isGuildTextChannel(cached) ? cached : null;
}

@Discord()
@SlashGroup({ name: "linkpanel", description: "Link panel management commands" })
export class LinkPanelAddon {
    @Slash({ name: "send", description: "Send a link panel" })
    @SlashGroup("linkpanel")
    @Guard(
        PermissionGuard(["ManageChannels"], {
            content: "You need the Manage Channels permission to configure the link panel.",
        }),
    )
    async sendLinkPanel(
        @SlashOption({
            name: "channel",
            description: "Channel to send the panel to",
            type: ApplicationCommandOptionType.Channel,
            channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
            required: true,
        })
        targetChannel: GuildBasedChannel,
        interaction: ChatInputCommandInteraction,
    ): Promise<void> {
        try {
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
            linkPanelSessions.set(sessionId, {
                id: sessionId,
                guildId: interaction.guildId,
                createdBy: interaction.user.id,
                targetChannelId: sendableChannel.id,
            });

            const modal = new ModalBuilder()
                .setTitle("Link Panel Builder")
                .setCustomId(`link:panel-builder:${sessionId}`);

            const titleInput = new TextInputBuilder()
                .setCustomId("panel-title")
                .setLabel("Embed Title")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setValue("Link your account!");

            const descriptionInput = new TextInputBuilder()
                .setCustomId("panel-description")
                .setLabel("Embed Description")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setValue("Click the button below to link your account.");

            const colorInput = new TextInputBuilder()
                .setCustomId("panel-color")
                .setLabel("Embed Accent Colour (hex)")
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setPlaceholder("e.g. 0099FF");

            const linkInput = new TextInputBuilder()
                .setCustomId("panel-link-url")
                .setLabel("Linking Page URL")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setPlaceholder("https://example.com/link");

            const buttonLabelInput = new TextInputBuilder()
                .setCustomId("panel-button-label")
                .setLabel("Button Label")
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setPlaceholder("Link Account");

            modal.addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(colorInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(linkInput),
                new ActionRowBuilder<TextInputBuilder>().addComponents(buttonLabelInput),
            );

            await interaction.showModal(modal);

            setTimeout(() => {
                linkPanelSessions.delete(sessionId);
            }, 5 * 60_000);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error handling /panel send link`, error);
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

    @ModalComponent({ id: /^link:panel-builder:/ })
    async handleLinkPanelModal(interaction: ModalSubmitInteraction): Promise<void> {
        try {
            const [, , sessionId] = interaction.customId.split(":");
            const session = linkPanelSessions.get(sessionId);
            if (!session) {
                await interaction.reply({
                    content: "This panel builder session has expired. Please run the command again.",
                    ephemeral: true,
                });
                return;
            }

            linkPanelSessions.delete(sessionId);

            const title = interaction.fields.getTextInputValue("panel-title")?.trim() ?? "Link your account!";
            const description =
                interaction.fields.getTextInputValue("panel-description")?.trim() ??
                "Click the button below to link your account.";
            const color = parseHexColor(interaction.fields.getTextInputValue("panel-color"));
            const linkUrl = interaction.fields.getTextInputValue("panel-link-url")?.trim() ?? "";
            const buttonLabel = interaction.fields.getTextInputValue("panel-button-label")?.trim() ?? "";

            if (!linkUrl) {
                await interaction.reply({
                    content: "Please provide a valid linking page URL.",
                    ephemeral: true,
                });
                return;
            }

            try {
                new URL(linkUrl);
            } catch {
                await interaction.reply({
                    content: "Please provide a valid URL (must start with http:// or https://).",
                    ephemeral: true,
                });
                return;
            }

            const target = await resolveChannel(interaction, session.targetChannelId);
            if (!target) {
                await interaction.reply({
                    content: "I can no longer access the target channel. Please try again.",
                    ephemeral: true,
                });
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setDescription(description)
                .setColor(color)
                .setFooter({ text: "Click the button below to get started." });

            const linkButton = new ButtonBuilder()
                .setLabel(buttonLabel || "Link Account")
                .setStyle(ButtonStyle.Link)
                .setURL(linkUrl);

            const buttonRow = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(linkButton);
            const components = [buttonRow];

            let message: Message;
            if (LINK_BOT_TOKEN && linkClient) {
                try {
                    const guild = target.guild;
                    if (guild) {
                        const linkGuild = linkClient.guilds.cache.get(guild.id) ?? await linkClient.guilds.fetch(guild.id).catch(() => null);
                        if (linkGuild) {
                            const linkChannel = linkGuild.channels.cache.get(target.id) ?? await linkGuild.channels.fetch(target.id).catch(() => null);
                            if (linkChannel && isGuildTextChannel(linkChannel)) {
                                message = await linkChannel.send({
                                    embeds: [embed],
                                    components,
                                });
                            } else {
                                message = await target.send({
                                    embeds: [embed],
                                    components,
                                });
                            }
                        } else {
                            message = await target.send({
                                embeds: [embed],
                                components,
                            });
                        }
                    } else {
                        message = await target.send({
                            embeds: [embed],
                            components,
                        });
                    }
                } catch (error) {
                    console.warn(`[${new Date().toISOString()}] Failed to send link panel via link client, falling back to regular client:`, error);
                    message = await target.send({
                        embeds: [embed],
                        components,
                    });
                }
            } else {
                message = await target.send({
                    embeds: [embed],
                    components,
                });
            }

            await interaction.reply({
                content: `Link panel sent to <#${target.id}>.`,
                ephemeral: true,
            });
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error handling link panel modal:`, error);
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
}

