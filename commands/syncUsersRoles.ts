import { type CommandInteraction } from "discord.js";
import { Discord, Guard, Slash } from "discordx";
import { Api, Transaction } from "../tools/Api.ts";
import { PermissionGuard, type PermissionsType } from "@discordx/utilities";
import config from '../config.json';

@Discord()
class SyncUsersRoles {
    @Slash({ description: 'Sync All Users Roles' })
    @Guard(
        PermissionGuard(config.SYNC_USERS_PERMS as PermissionsType, {
            content: "You do not have permission to sync roles!",
        }),
    )
    async sync_users_roles(
        interaction: CommandInteraction
    ) {
        await interaction.deferReply();

        try {
            Api.ignoreRoleChange = true;
            const rolesToTrack = await Api.fetchRoles(interaction.guildId!);

            if (rolesToTrack.length < 1) {
                interaction.editReply("No Roles to Sync!");
                return;
            }

            const guild = interaction.guild;
            if (guild == null) {
                interaction.editReply("This command must be run in a server");
                return;
            }

            const linkedMembers = await Api.fetchLinkedUsers();
            const premiumRole = guild.roles.premiumSubscriberRole;

            for (const memberId of linkedMembers) {
                guild.members.fetch(memberId).then(async (member) => {
                    const membersRoles = await Api.fetchUsersRoles(member.id, interaction.guildId!);

                    if (premiumRole) {
                        if (membersRoles.includes(premiumRole.id)) {
                            if (!member.roles.cache.has(premiumRole.id)) {
                                Api.sendRoleUpdate(new Transaction(member.id, premiumRole.id, guild.id, false));
                            }
                        } else {
                            if (member.roles.cache.has(premiumRole.id)) {
                                Api.sendRoleUpdate(new Transaction(member.id, premiumRole.id, guild.id, true));
                            }
                        }
                    }

                    for (const role of membersRoles) {
                        const roleToAdd = guild.roles.cache.find(r => r.id === role);
                        if (roleToAdd) {
                            if (roleToAdd.id === premiumRole?.id) {
                                continue;
                            }
                            if (!roleToAdd.editable) {
                                console.warn(`No permission to add role: ${roleToAdd.name} to ${member.displayName}`);
                                continue;
                            }
                            await member.roles.add(roleToAdd);
                        }
                    }
                    for (const role of rolesToTrack) {
                        const roleToRemove = guild.roles.cache.find(r => r.id === role);
                        if (roleToRemove?.id === premiumRole?.id) {
                            continue;
                        }
                        if (roleToRemove && !membersRoles.includes(role)) {
                            if (!roleToRemove.editable) {
                                console.warn(`No permission to remove role: ${roleToRemove.name} from ${member.displayName}`);
                                continue;
                            }
                            await member.roles.remove(roleToRemove);
                        }
                    }
                }).catch((error) => {
                    console.warn(`Member ${memberId} could not be fetched: ${error.message}`);
                });
            }

            interaction.editReply(`All Users have been Synced`);
            Api.ignoreRoleChange = false;

        } catch (e) {
            Api.ignoreRoleChange = false;
            interaction.editReply(`Failed to get Sync Roles: ${e}`);
        }
    }
}