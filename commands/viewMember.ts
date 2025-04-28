import {ApplicationCommandOptionType, CommandInteraction, EmbedBuilder, User} from "discord.js";
import {Discord, Slash, SlashOption, Guard} from "discordx";
import {Api} from "../tools/Api.ts";
import {PermissionGuard, type PermissionHandler, type PermissionsType} from "@discordx/utilities";
import config from '../config.json';

@Discord()
class ViewMember {
    private regex = /[A-F0-9]{6}/;
    private hexString = "0x" + config.EMBED_HEX.replace("0x", "").replace("#", "").toUpperCase();
    hexColour = Number(this.regex.test(this.hexString) ? this.hexString : '0099FF');
    @Slash({description: 'View Member info'})
    @Guard(
        // @ts-ignore
        PermissionGuard(ViewMember.resolvePermission, {
            content: "You do not have permission to view member information!",
        }),
    )
    async view_member(
        @SlashOption({
            description: "User",
            name: "user",
            required: false,
            type: ApplicationCommandOptionType.User
        })
            user: User,
        @SlashOption({
            description: "discordID/steamID/paynowID of the user",
            name: "or-id",
            required: false,
            type: ApplicationCommandOptionType.String
        })
            userId: string,
        interaction: CommandInteraction,
    ) {
        if (user) {
            userId = user.id;
        }
        if (userId == null) {
            interaction.reply("User or UserID required!");
            return;
        }
        try {
            const userInfo = await Api.fetchUser(userId);
            if (userInfo == null) {
                interaction.reply("User not found!");
                return;
            }
            if (!userInfo.isLinked) {
                interaction.reply("User not linked to discord!");
            }
            const updateEmbed = new EmbedBuilder()
                .setColor(this.hexColour)
                .setAuthor({name: userInfo.name + " has linked their accounts.", iconURL: userInfo.image})
                .addFields({
                    name: "Discord ID", value: "```" + userInfo.discordId + "```\n" +
                        "**Account Links**\n" +
                        `- <@${userInfo.discordId}>\n` +
                        `- [Battlemetrics](https://www.battlemetrics.com/rcon/players?filter%5Bsearch%5D=${userInfo.steamId})\n` +
                        `- [PayNow](https://dashboard.paynow.gg/customer/${userInfo.storeId})`, inline: true
                })
                .addFields({
                    name: "Steam ID", value: "```" + userInfo.steamId + "```\n" +
                        "**Extra Info**\n" +
                        `- Boosting Discord Server ${userInfo.isBoosting ? '☑️' : '❌'}\n` +
                        `- Steam Group Member ${userInfo.joinedSteamGroup ? '☑️' : '❌'}\n` +
                        `- [Website Profile](${config.API_ENDPOINT.replace("/api","")}/admin/users/${userInfo.steamId})`, inline: true
                })
                .setTimestamp();
            interaction.reply({embeds: [updateEmbed], ephemeral: true});
        } catch (e) {
            interaction.reply({content: `Failed to get user ${userId}: ${e}`, ephemeral: true});
        }
    }

    private static resolvePermission(
        interaction: PermissionHandler,
    ): Promise<PermissionsType> {
        if (interaction instanceof CommandInteraction) {
            for (const role of config.VIEW_MEMBERS_ROLES) {
                if (interaction.guild?.roles.cache.get(role)?.members.has(interaction.user.id)) {
                    // Everyone should have this permission
                    return Promise.resolve(["SendMessages"]);
                }
            }
        }
        return Promise.resolve(["Administrator"]);
    }
}