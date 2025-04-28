import { Discord, On, Client, type ArgsOf } from "discordx";
import { Api, Transaction } from "../tools/Api.ts";

@Discord()
class RoleTracking {
    @On({ event: "guildMemberUpdate" })
    async onMemberUpdate(
        [oldMember, newMember]: ArgsOf<"guildMemberUpdate">,
        _client: Client,
        _guardPayload: any
    ) {
        const changed = oldMember.roles.cache.size != newMember.roles.cache.size;
        const linkedMembers = await Api.fetchLinkedUsers();

        // If the user is not linked, we don't need to do anything
        if (!linkedMembers.includes(newMember.id)) {
            return;
        }

        // If the roles haven't changed, we don't need to do anything
        if (!changed) {
            return;
        }

        // Add note to explain why we are ignoring the role change
        if (Api.ignoreRoleChange) {
            console.log("Ignoring role change")
            return;
        }
        const rolesToTrack = await Api.fetchRoles(newMember.guild.id);
        if (rolesToTrack.length == 0) {
            console.warn("There are no roles to track for this guild")
            return;
        }

        const premiumRole = newMember.roles.premiumSubscriberRole;

        // If the premium role exists and is in the roles to track, we need to check if the user has it
        if (premiumRole && rolesToTrack.includes(premiumRole.id)) {
            const membersRoles = await Api.fetchUsersRoles(newMember.id, newMember.guild.id);
            if (newMember.roles.cache.has(premiumRole.id) &&
                !membersRoles.includes(premiumRole.id)) {
                // User has premium role in discord but not in the database
                // Which means they have subscribed to nitro
                Api.sendRoleUpdate(new Transaction(newMember.id, premiumRole.id, newMember.guild.id, true));
            } else if (!newMember.roles.cache.has(premiumRole.id) &&
                membersRoles.includes(premiumRole.id)) {
                // User has no premium role in discord but has it in the database
                // Which means they have unsubscribed from nitro
                Api.sendRoleUpdate(new Transaction(newMember.id, premiumRole.id, newMember.guild.id, false));
            }
        }

        const newRole = newMember.roles.cache.difference(oldMember.roles.cache).first()!;
        if (!rolesToTrack.includes(newRole.id)) {
            return;
        }
        const added = oldMember.roles.cache.size < newMember.roles.cache.size;
        console.log(`ℹ Role ${newRole.name} ${added ? "added to" : "removed from"} ${newMember.nickname ? newMember.nickname : newMember.displayName} on Discord`);
        Api.sendRoleUpdate(new Transaction(newMember.id, newRole.id, newMember.guild.id, added));
    }
}