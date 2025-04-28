import {Discord, On} from "discordx";
import {Guild} from "discord.js";
import {Api} from "../tools/Api.ts";

@Discord()
class GuildTracking {
    @On({ event: "guildCreate"})
    onGuildCreate(guild: Guild) {
        Api.sendGuildUpdate(guild.id, guild.name, true);
        console.log(`Added to new Guild: ${guild.id} ${guild.name}`);
    }

    @On({ event: "guildDelete"})
    onGuildDelete(guild: Guild) {
        Api.sendGuildUpdate(guild.id, guild.name, false);
        console.log(`Removed from Guild: ${guild.id} ${guild.name}`);
    }
}