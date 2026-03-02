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
        if (!config.ROLE_SYNC_ENABLED || Api.ignoreRoleChange) {
            return;
        }

        const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
        const removedRoles = oldMember.roles.cache.filter(role => !newMember.roles.cache.has(role.id));

        if (addedRoles.size === 0 && removedRoles.size === 0) {
            return;
        }

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

    @On({ event: "guildMemberAdd" })
    async onMemberJoin(
        [member]: ArgsOf<"guildMemberAdd">,
        client: Client,
        _guardPayload: any
    ) {
        if (!config.ROLE_SYNC_ENABLED) {
            return;
        }
        
        try {
            const rolesToAssign = await Api.fetchUsersRoles(member.id, member.guild.id);
            if (rolesToAssign.length === 0) {
                return;
            }

            const botMember = member.guild.members.cache.get(client.user?.id || '') ??
                await member.guild.members.fetch(client.user?.id || '').catch(() => null);
            if (!botMember?.permissions.has('ManageRoles')) {
                console.warn(`[${new Date().toISOString()}] Bot missing 'Manage Roles' permission in guild ${member.guild.name} (${member.guild.id})`);
                return;
            }

            const eligibleRoles = rolesToAssign.filter(roleId => {
                const role = member.guild.roles.cache.get(roleId);
                if (!role) {
                    console.warn(`[${new Date().toISOString()}] Role ${roleId} not found in guild ${member.guild.name}`);
                    return false;
                }
                if (role.position >= (botMember.roles.highest?.position || 0)) {
                    console.warn(`[${new Date().toISOString()}] Skipping role ${role.name} (${role.id}) in guild ${member.guild.name} - above bot's highest role`);
                    return false;
                }
                return true;
            });

            const missingRoles = eligibleRoles.filter(roleId => !member.roles.cache.has(roleId));
            if (missingRoles.length === 0) {
                return;
            }

            Api.setIgnoreRoleChange(3000);
            await member.roles.add(missingRoles);
            console.log(`[${new Date().toISOString()}] Assigned ${missingRoles.length} role(s) to ${member.user.tag} in ${member.guild.name} on join`);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error assigning roles to ${member.user.tag} (${member.id}) on join:`, error);
        }
    }

    @On({ event: "clientReady" })
    async onReady(client: Client) {
        console.log("Bot is ready");
    }
}