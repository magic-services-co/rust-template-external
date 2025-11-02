import { Discord, On, Client, type ArgsOf } from "discordx";
import { Api } from "../tools/Api.ts";
import config from '../config.json';

@Discord()
class RoleTracking {
    @On({ event: "guildMemberUpdate" })
    async onMemberUpdate(
        [oldMember, newMember]: ArgsOf<"guildMemberUpdate">,
        client: Client,
        _guardPayload: any
    ) {
        if (Api.ignoreRoleChange) {
            return;
        }

        const changed = oldMember.roles.cache.size != newMember.roles.cache.size;

        if (!changed) {
            return;
        }

        const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
        const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));

        const rolesToTrack = await Api.fetchRoles(newMember.guild.id);
        if (rolesToTrack.length == 0) {
            return;
        }

        for (const [roleId] of addedRoles) {
            if (rolesToTrack.includes(roleId)) {
                await Api.syncRoleToWebsite(newMember.id, roleId, newMember.guild.id, "add");
            }
        }

        for (const [roleId] of removedRoles) {
            if (rolesToTrack.includes(roleId)) {
                await Api.syncRoleToWebsite(newMember.id, roleId, newMember.guild.id, "remove");
            }
        }
    }

    @On({ event: "ready" })
    async onReady(client: Client) {
        console.log("Bot is ready");
    }
}