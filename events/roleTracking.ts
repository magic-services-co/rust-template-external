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
        if (Api.ignoreRoleChange) {
            return;
        }

        const changed = oldMember.roles.cache.size != newMember.roles.cache.size;
        const linkedMembers = await Api.fetchLinkedUsers();

        if (!linkedMembers.includes(newMember.id)) {
            return;
        }

        if (!changed) {
            return;
        }

        const addedRoles = newMember.roles.cache.difference(oldMember.roles.cache);
        const removedRoles = oldMember.roles.cache.difference(newMember.roles.cache);
        
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

        for (const [roleId, role] of addedRoles) {
            if (rolesToTrack.includes(roleId)) {
                const userShouldHaveRole = membersRoles.includes(roleId);
                
                if (!userShouldHaveRole) {
                    console.log(`[${new Date().toISOString()}] Removing incorrectly assigned role ${role.name} from ${newMember.user.tag}`);
                    await Api.handleInstantRoleUpdate(client, newMember.id, roleId, newMember.guild.id, "remove");
                } else {
                }
            }
        }

        for (const [roleId, role] of removedRoles) {
            if (rolesToTrack.includes(roleId)) {
                const userShouldHaveRole = membersRoles.includes(roleId);
                
                if (userShouldHaveRole) {
                    console.log(`[${new Date().toISOString()}] Re-adding incorrectly removed role ${role.name} to ${newMember.user.tag}`);
                    await Api.handleInstantRoleUpdate(client, newMember.id, roleId, newMember.guild.id, "add");
                } else {
                }
            }
        }

        if (addedRoles.size > 0 || removedRoles.size > 0) {
            for (const [roleId] of addedRoles) {
                if (rolesToTrack.includes(roleId)) {
                    Api.sendRoleUpdate(new Transaction(newMember.id, roleId, newMember.guild.id, true));
                }
            }
            for (const [roleId] of removedRoles) {
                if (rolesToTrack.includes(roleId)) {
                    Api.sendRoleUpdate(new Transaction(newMember.id, roleId, newMember.guild.id, false));
                }
            }
        }
    }

    @On({ event: "ready" })
    async onReady(client: Client) {
        console.log("Bot is ready");
    }
}