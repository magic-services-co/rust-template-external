import { type CommandInteraction } from "discord.js";
import { Discord, Guard, Slash } from "discordx";
import { Api, Transaction } from "../tools/Api.ts";
import { PermissionGuard, type PermissionsType } from "@discordx/utilities";
import config from '../config.json';

@Discord()
export class SyncUsersRoles {
    @Slash({ name: "syncusersroles", description: "Sync user roles from the website" })
    @Guard(
        PermissionGuard(config.SYNC_USERS_PERMS as PermissionsType, {
            content: "You do not have permission to sync roles!",
        }),
    )
    async syncUsersRoles(interaction: CommandInteraction): Promise<void> {
        await interaction.deferReply();

        try {
            console.log(`[${new Date().toISOString()}] Manual role sync triggered by ${interaction.user.tag}`);
            
            await Api.fetchAndAssignUserRoles(interaction.client as any);
            
            await interaction.editReply("✅ User roles have been synchronized successfully!");
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in manual role sync:`, error);
            await interaction.editReply("❌ An error occurred while synchronizing user roles. Check the console for details.");
        }
    }
}