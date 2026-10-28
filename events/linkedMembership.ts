import { Discord, On, Client, type ArgsOf } from "discordx";
import { reportMemberLeft } from "../tools/linkAudit.ts";

@Discord()
class LinkedMembership {
    @On({ event: "guildMemberRemove" })
    async onMemberLeave(
        [member]: ArgsOf<"guildMemberRemove">,
        client: Client,
    ) {
        if (member.user?.bot || !member.id || !member.guild?.id) {
            return;
        }

        try {
            await reportMemberLeft(client, member.id, member.guild.id);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Failed to handle ${member.id} leaving ${member.guild.id}:`, error);
        }
    }
}
