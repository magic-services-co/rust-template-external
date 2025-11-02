import {Discord, On} from "discordx";
import {Guild} from "discord.js";

@Discord()
class GuildTracking {
    @On({ event: "guildCreate"})
    onGuildCreate(guild: Guild) {
        console.log(`Added to new Guild: ${guild.id} ${guild.name} - Please add this guild ID to website settings`);
    }

    @On({ event: "guildDelete"})
    onGuildDelete(guild: Guild) {
        console.log(`Removed from Guild: ${guild.id} ${guild.name} - Please remove this guild ID from website settings`);
    }
}