import { Discord, On, Client, type ArgsOf } from "discordx";
import { Api, Transaction } from "../tools/Api.ts";
import config from '../config.json';

@Discord()
class RoleTracking {
    @On({ event: "guildMemberUpdate" })
    async onMemberUpdate(
        [oldMember, newMember]: ArgsOf<"guildMemberUpdate">,
        client: Client,
        _guardPayload: any
    ) {
        const changed = oldMember.roles.cache.size != newMember.roles.cache.size;
        const linkedMembers = await Api.fetchLinkedUsers();

        if (!linkedMembers.includes(newMember.id)) {
            return;
        }

        if (!changed) {
            return;
        }

        if (Api.ignoreRoleChange) {
            return;
        }

        const rolesToTrack = await Api.fetchRoles(newMember.guild.id);
        if (rolesToTrack.length == 0) {
            return;
        }

        const premiumRole = newMember.roles.premiumSubscriberRole;
        const membersRoles = await Api.fetchUsersRoles(newMember.id, newMember.guild.id);

        if (premiumRole && rolesToTrack.includes(premiumRole.id)) {
            if (newMember.roles.cache.has(premiumRole.id) &&
                !membersRoles.includes(premiumRole.id)) {
                await Api.handleInstantRoleUpdate(client, newMember.id, premiumRole.id, newMember.guild.id, "add");
            } else if (!newMember.roles.cache.has(premiumRole.id) &&
                membersRoles.includes(premiumRole.id)) {
                await Api.handleInstantRoleUpdate(client, newMember.id, premiumRole.id, newMember.guild.id, "remove");
            }
        }

        const newRole = newMember.roles.cache.difference(oldMember.roles.cache).first();
        if (!newRole || !rolesToTrack.includes(newRole.id)) {
            return;
        }

        const added = oldMember.roles.cache.size < newMember.roles.cache.size;

        Api.sendRoleUpdate(new Transaction(newMember.id, newRole.id, newMember.guild.id, added));

        if (!added && membersRoles.includes(newRole.id)) {
            await Api.handleInstantRoleUpdate(client, newMember.id, newRole.id, newMember.guild.id, "add");
        }
    }

    @On({ event: "ready" })
    async onReady(client: Client) {
        console.log("Bot is ready");
    }
}