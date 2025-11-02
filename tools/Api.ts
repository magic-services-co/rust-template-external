import { CONSTANTS } from "./constants.ts";
import config from '../config.json';
import type { Client } from "discordx";
import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, type Guild, type GuildBasedChannel, type MessageActionRowComponentBuilder } from "discord.js";

interface CacheEntry {
    data: any;
    timestamp: number;
    expiresIn: number;
}

class Cache {
    private static cache: Map<string, CacheEntry> = new Map();
    private static readonly DEFAULT_EXPIRY = 5 * 60 * 1000; 

    static set(key: string, data: any, expiresIn: number = this.DEFAULT_EXPIRY): void {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            expiresIn
        });
    }

    static get(key: string): any | null {
        const entry = this.cache.get(key);
        if (!entry) return null;

        if (Date.now() - entry.timestamp > entry.expiresIn) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    static clear(): void {
        this.cache.clear();
    }
}

export class Api {
    static ignoreRoleChange: boolean = false;
    static roleChangeTimeout: NodeJS.Timeout | null = null;

    static setIgnoreRoleChange(duration: number = 2000): void {
        if (this.roleChangeTimeout) {
            clearTimeout(this.roleChangeTimeout);
        }
        
        this.ignoreRoleChange = true;
        this.roleChangeTimeout = setTimeout(() => {
            this.ignoreRoleChange = false;
            this.roleChangeTimeout = null;
        }, duration);
    }

    static async syncRoleToWebsite(discordId: string, roleId: string, guildId: string, action: "add" | "remove"): Promise<void> {
        const headers: Headers = new Headers()
        headers.set('Content-Type', 'application/json');
        headers.set('x-api-key', config.API_KEY);

        const request: RequestInfo = new Request(config.API_ENDPOINT + '/discord/sync-roles', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                discordId,
                roleId,
                guildId,
                action
            })
        })

        try {
            const res = await fetch(request);
            if (!res.ok) {
                console.error(`[${new Date().toISOString()}] Error syncing role to website:`, res.status);
                const json = await res.json().catch(() => ({}));
                console.error(`[${new Date().toISOString()}] Response body:`, json);
            } else {
                console.log(`[${new Date().toISOString()}] Successfully synced role ${action} to website`);
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in syncRoleToWebsite: ${error}`);
        }
    }

    static sendGuildUpdate(id: string, name: string, added: boolean) {
        const headers: Headers = new Headers();
        headers.set('x-api-key', config.API_KEY);
        let request: RequestInfo;
        if (added) {
            headers.set('Content-Type', 'application/json');
            headers.set('Accept', 'application/json');

            request = new Request(config.API_ENDPOINT + CONSTANTS.GUILDS, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    id: id,
                    name: name,
                })
            });
        } else {
            const url = new URL(config.API_ENDPOINT + CONSTANTS.GUILDS);
            url.searchParams.set('id', id);

            request = new Request(url, {
                method: 'DELETE',
                headers: headers
            });
        }

        fetch(request)
            .then(res => {
                if (!res.ok) {
                    console.error("Sending Guild update error, response:", res);
                    res.json().then(json => console.error("body: ", json));
                }
            });
    }

    static async fetchRoles(guildId: string): Promise<string[]> {
        const url = new URL(config.API_ENDPOINT + CONSTANTS.FETCH_ROLES);
        url.searchParams.set('guildId', guildId);
        const request: RequestInfo = new Request(url, {
            method: 'GET',
            headers: new Headers({ 'x-api-key': config.API_KEY }),
        });
        try {
            const res = await fetch(request);
            if (!res.ok) {
                console.error(`[${new Date().toISOString()}] Error Fetching roles for guild ${guildId}:`, res.status, res.statusText);
                const errorBody = await res.text();
                console.error(`[${new Date().toISOString()}] Error body:`, errorBody);
                return [];
            }
            const json = await res.json();
            
            let roles: any[] = [];
            if (Array.isArray(json)) {
                roles = json;
            } else if (json && json.roles && Array.isArray(json.roles)) {
                roles = json.roles;
            } else {
                console.error(`[${new Date().toISOString()}] Invalid response format from API for roles:`, json);
                return [];
            }

            return roles
                .filter(role => role && role.discordRoleId)
                .map(role => role.discordRoleId);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in fetchRoles:`, error);
            return [];
        }
    }

    static async fetchUser(userId: string): Promise<{
        id: string, name: string, image: string, isBoosting: boolean,
        steamId: string, discordId: string, isLinked: boolean, storeId: string,
        joinedSteamGroup: boolean, roles: []
    } | null> {
        const request: RequestInfo = new Request(config.API_ENDPOINT + CONSTANTS.FETCH_USER + userId, {
            method: 'GET',
            headers: new Headers({ 'x-api-key': config.API_KEY }),
        });
        const res = await fetch(request);
        if (!res.ok) {
            console.error("Error Fetching user: ", userId);
            console.error("body: ", res.body);
            return null;
        }
        const json = await res.json();
        if (json.users.size < 1) {
            return null;
        }
        return json.users[0];
    }

    static async fetchUsersRoles(userId: string, guildId: string): Promise<string[]> {
        if (!userId || !guildId) {
            console.error(`[${new Date().toISOString()}] Invalid parameters for fetchUsersRoles: userId=${userId}, guildId=${guildId}`);
            return [];
        }

        try {
            const rolesUrl = new URL(config.API_ENDPOINT + CONSTANTS.FETCH_ROLES);
            rolesUrl.searchParams.set('guildId', guildId);
            const rolesRequest = new Request(rolesUrl, {
                method: 'GET',
                headers: new Headers({ 'x-api-key': config.API_KEY }),
            });

            const rolesRes = await fetch(rolesRequest);
            if (!rolesRes.ok) {
                console.error(`[${new Date().toISOString()}] Error fetching roles for guild ${guildId}:`, rolesRes.status, rolesRes.statusText);
                return [];
            }

            const rolesJson = await rolesRes.json();
            let roles: any[] = [];
            if (Array.isArray(rolesJson)) {
                roles = rolesJson;
            } else if (rolesJson && rolesJson.roles && Array.isArray(rolesJson.roles)) {
                roles = rolesJson.roles;
            }

            try {
                const userRequest = new Request(config.API_ENDPOINT + CONSTANTS.FETCH_USER + userId, {
                    method: 'GET',
                    headers: new Headers({ 'x-api-key': config.API_KEY }),
                });

                const userRes = await fetch(userRequest);
                if (!userRes.ok) {
                    if (userRes.status !== 500) {
                        console.error(`[${new Date().toISOString()}] Error fetching user details for ${userId}:`, userRes.status, userRes.statusText);
                    }
                    return [];
                }

                const userJson = await userRes.json();
                if (!userJson || !userJson.users || userJson.users.length === 0) {
                    return [];
                }

                const userData = userJson.users[0];
                if (!userData) {
                    return [];
                }

                const rolesToAssign: string[] = [];

                const linkedRole = roles.find(role => role.assignOnVerification);
                if (linkedRole && userData.isLinked) {
                    rolesToAssign.push(linkedRole.discordRoleId);
                }

                const steamGroupRole = roles.find(role => role.assignOnGroupJoin);
                if (steamGroupRole && userData.joinedSteamGroup) {
                    rolesToAssign.push(steamGroupRole.discordRoleId);
                }

                const boosterRole = roles.find(role => role.assignOnBoost);
                if (boosterRole && userData.isBoosting) {
                    rolesToAssign.push(boosterRole.discordRoleId);
                }

                if (userData.roles && Array.isArray(userData.roles)) {
                    for (const userRole of userData.roles) {
                        const matchingRole = roles.find(role => role.id === userRole);
                        if (matchingRole && matchingRole.discordRoleId) {
                            rolesToAssign.push(matchingRole.discordRoleId);
                        }
                    }
                }

                return rolesToAssign;
            } catch (error) {
                if (error instanceof Error && !error.message.includes('500')) {
                    console.error(`[${new Date().toISOString()}] Error in fetchUsersRoles:`, error);
                }
                return [];
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in fetchUsersRoles:`, error);
            return [];
        }
    }

    static async fetchAndApplyUpdates(client: Client, lastFetch: string) {
        const url = new URL(config.API_ENDPOINT + CONSTANTS.FETCH_STATS);
        url.searchParams.set('minimize', 'true');
        url.searchParams.set('startDate', lastFetch);
        const request: RequestInfo = new Request(url, {
            method: 'GET',
            headers: new Headers({ 'x-api-key': config.API_KEY }),
        });
        const res = await fetch(request);
        if (!res.ok) {
            return;
        }
        const json = await res.json();
        const logs: Log[] = json.logs;
        for (const log of logs) {
            if (log.action == "ROLE_ASSIGNED" || log.action == "ROLE_REVOKED" || log.action == "USER_UPDATED") {
                if (log.discordRoleId) {
                    await this.applyRoleUpdate(client, log);
                }
            }
        }
        if (logs.length > 0) {
            console.log(`[${new Date().toISOString()}] Processed ${logs.length} update(s) from API`);
        }
    }

    static async applyRoleUpdate(client: Client, log: Log) {
        const guild = client.guilds.cache.get(log.discordGuildId);
        if (!guild) {
            console.error("Guild " + log.discordGuildId + " not found!");
            return;
        }
        if (guild.roles.premiumSubscriberRole?.id == log.discordRoleId) {
            return;
        }
        
        try {
            if (!guild.members.cache.has(log.discordId)) {
                console.warn(`Member "${log.discordId}" not found in guild "${guild.name}" cache, attempting to fetch...`);
                try {
                    await guild.members.fetch(log.discordId);
                } catch (error) {
                    console.warn(`Member "${log.discordId}" not found on guild "${guild.name}": ${error}`);
                    return;
                }
            }

            const member = guild.members.cache.get(log.discordId);
            if (!member) {
                console.error(`Member "${log.discordId}" not found in guild "${guild.name}" after fetch!`);
                return;
            }

            if (log.action == "ROLE_ASSIGNED") {
                try {
                    Api.setIgnoreRoleChange(3000);
                    await member.roles.add(log.discordRoleId);
                    console.log(`[${new Date().toISOString()}] Role "${log.discordRoleId}" added to ${member.displayName} in ${guild.name} via API`);
                } catch (error) {
                    console.error(`Error adding role to member ${member.displayName} (${log.discordId}), role: ${log.discordRoleId}, error: ${error}`);
                }
            } else if (log.action == "ROLE_REVOKED") {
                try {
                    Api.setIgnoreRoleChange(3000);
                    await member.roles.remove(log.discordRoleId);
                    console.log(`[${new Date().toISOString()}] Role "${log.discordRoleId}" revoked from ${member.displayName} in ${guild.name} via API`);
                } catch (error) {
                    console.error(`Error revoking role from member ${member.displayName} (${log.discordId}), role: ${log.discordRoleId}, error: ${error}`);
                }
            } else if (log.action == "USER_UPDATED" && config.SET_DISCORD_NAME_TO_STEAM_NAME) {
                try {
                    if (member.nickname !== log.name) {
                        console.log(`[${new Date().toISOString()}] Updating nickname from "${member.nickname}" to "${log.name}" for ${member.displayName} in ${guild.name}`);
                        await member.setNickname(log.name);
                    }
                } catch (error) {
                    console.error(`Error updating nickname for member ${member.displayName} (${log.discordId}), error: ${error}`);
                }
            }
        } catch (error) {
            console.error(`Error processing update for member ${log.discordId}: ${error}`);
        }
    }

    static async handleInstantRoleUpdate(client: Client, userId: string, roleId: string, guildId: string, action: "add" | "remove") {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            console.error(`[${new Date().toISOString()}] Guild ${guildId} not found!`);
            return;
        }

        const botMember = guild.members.cache.get(client.user?.id || '');
        if (!botMember?.permissions.has('ManageRoles')) {
            console.error(`[${new Date().toISOString()}] Bot missing 'Manage Roles' permission in guild ${guild.name} (${guildId})`);
            return;
        }

        try {
            if (!guild.members.cache.has(userId)) {
                try {
                    await guild.members.fetch(userId);
                } catch (error) {
                    return;
                }
            }

            const member = guild.members.cache.get(userId);
            if (!member) {
                console.error(`[${new Date().toISOString()}] Member ${userId} not found in guild ${guild.name}!`);
                return;
            }

            const role = guild.roles.cache.get(roleId);
            if (!role) {
                console.error(`[${new Date().toISOString()}] Role ${roleId} not found in guild ${guild.name}!`);
                return;
            }

            if (role.position >= (botMember.roles.highest?.position || 0)) {
                return;
            }

            if (action === "add") {
                if (member.roles.cache.has(roleId)) {
                    return;
                }

                try {
                    Api.setIgnoreRoleChange(3000);
                    await member.roles.add(roleId);
                    console.log(`[${new Date().toISOString()}] User ${member.user.tag} (${member.id}) linked their account and received the ${role.name} role`);
                } catch (error) {
                    if (error && typeof error === 'object' && 'code' in error && error.code === 50013) {
                        console.error(`[${new Date().toISOString()}] Missing permissions to add role ${role.name} in guild ${guild.name}. Please ensure the bot has 'Manage Roles' permission and the role is below the bot's highest role.`);
                    } else {
                        console.error(`[${new Date().toISOString()}] Error adding role ${role.name} to ${member.user.tag}:`, error);
                    }
                }
            } else if (action === "remove") {
                if (!member.roles.cache.has(roleId)) {
                    return;
                }

                try {
                    Api.setIgnoreRoleChange(3000);
                    await member.roles.remove(roleId);
                    console.log(`[${new Date().toISOString()}] User ${member.user.tag} (${member.id}) unlinked their account and lost the ${role.name} role`);
                } catch (error) {
                    if (error && typeof error === 'object' && 'code' in error && error.code === 50013) {
                        console.error(`[${new Date().toISOString()}] Missing permissions to remove role ${role.name} in guild ${guild.name}. Please ensure the bot has 'Manage Roles' permission and the role is below the bot's highest role.`);
                    } else {
                        console.error(`[${new Date().toISOString()}] Error removing role ${role.name} from ${member.user.tag}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in handleInstantRoleUpdate:`, error);
        }
    }

    static async fetchAndPostMaps(client: Client, lastFetch: string) {
        const url = new URL(config.API_ENDPOINT + CONSTANTS.FETCH_MAP_VOTES);
        url.searchParams.set('startDate', lastFetch);
        const request: RequestInfo = new Request(url, {
            method: 'GET',
            headers: new Headers({ 'x-api-key': config.API_KEY }),
        });
        const res = await fetch(request);
        if (!res.ok) {
            return;
        }
        const votes: MapVotes[] = await res.json();
        const jsonChannels: { guild: string, channel: string }[] = config.MAP_VOTES_CHANNELS;
        const channels: GuildBasedChannel[] = [];
        
        for (const jsonChannel of jsonChannels) {
            try {
                const guild = client.guilds.cache.get(jsonChannel.guild);
                if (!guild) {
                    continue;
                }
                const channel = await guild.channels.fetch(jsonChannel.channel).catch(() => null);
                if (!channel) {
                    continue;
                }
                channels.push(channel);
            } catch (error) {
                continue;
            }
        }

        for (const vote of votes) {
            if (!vote || typeof vote !== 'object') {
                continue;
            }

            if (!vote.map_options || !Array.isArray(vote.map_options) || vote.map_options.length === 0) {
                continue;
            }

            for (const mapOption of vote.map_options) {
                if (!mapOption || !mapOption.url || !mapOption.imageUrl) {
                    continue;
                }

                const title = `Map Vote for ${vote.server?.server_name || 'Server'} - Option ${mapOption.order + 1}`;
                const description = `Vote ends: ${new Date(vote.vote_end).toLocaleString()}\nMap size: ${mapOption.size}\nSeed: ${mapOption.seed}`;

                for (const channel of channels) {
                    if (channel.isSendable()) {
                        const embed = new EmbedBuilder()
                            .setTitle(title)
                            .setDescription(description)
                            .setColor(0x0099FF)
                            .setImage(mapOption.imageUrl);

                        const mapButton = new ButtonBuilder()
                            .setLabel("View on RustMaps.com")
                            .setStyle(ButtonStyle.Link)
                            .setURL(mapOption.url);

                        const siteButton = new ButtonBuilder()
                            .setLabel("View votes on site")
                            .setStyle(ButtonStyle.Link)
                            .setURL(`${config.API_ENDPOINT.replace("/api", "")}/maps/${vote.id}`);

                        const row = new ActionRowBuilder<MessageActionRowComponentBuilder>()
                            .addComponents([mapButton, siteButton]);

                        try {
                            const messages = await channel.messages.fetch({ limit: 100 });
                            const existingMessage = messages.find(msg => 
                                msg.embeds[0]?.title === title && 
                                msg.author.id === client.user?.id
                            );

                            if (existingMessage) {
                                await existingMessage.edit({ embeds: [embed], components: [row] });
                            } else {
                                await channel.send({ embeds: [embed], components: [row] });
                            }
                        } catch (error) {
                            continue;
                        }
                    }
                }
            }
        }
        // Only log when there are actual map votes to process
        if (votes.length > 0) {
            console.log(`[${new Date().toISOString()}] Processed ${votes.length} map vote(s) from API`);
        }
    }

    static async fetchAndUpdateGuilds(client: Client) {
        console.log(`[${new Date().toISOString()}] Guild sync disabled - website manages guild settings`);
    }

    static async fetchLinkedUsers(): Promise<string[]> {
        const url = new URL(config.API_ENDPOINT + CONSTANTS.FETCH_LINKED_USERS);
        const request: RequestInfo = new Request(url, {
            method: 'GET',
            headers: new Headers({ 'x-api-key': config.API_KEY }),
        });

        try {
            const res = await fetch(request);
            if (!res.ok) {
                console.error(`[${new Date().toISOString()}] Error Fetching linked users:`, res.status, res.statusText);
                const errorBody = await res.text();
                console.error(`[${new Date().toISOString()}] Error body:`, errorBody);
                return [];
            }
            const json = await res.json();
            
            let users: any[] = [];
            if (Array.isArray(json)) {
                users = json;
            } else if (json && json.users && Array.isArray(json.users)) {
                users = json.users;
            } else {
                console.error(`[${new Date().toISOString()}] Invalid response format from API:`, json);
                return [];
            }

            const userIds: string[] = [];
            for (const user of users) {
                try {
                    const userId = typeof user === 'string' ? user : user.id;
                    if (!userId) continue;

                    const userRequest = new Request(config.API_ENDPOINT + CONSTANTS.FETCH_USER + userId, {
                        method: 'GET',
                        headers: new Headers({ 'x-api-key': config.API_KEY }),
                    });

                    const userRes = await fetch(userRequest);
                    if (!userRes.ok) {
                        console.error(`[${new Date().toISOString()}] Error fetching user details for ${userId}:`, userRes.status, userRes.statusText);
                        continue;
                    }

                    const userJson = await userRes.json();
                    if (userJson && userJson.users && userJson.users.length > 0) {
                        const userData = userJson.users[0];
                        if (userData && userData.discordId) {
                            userIds.push(userData.discordId);
                        }
                    }
                } catch (error) {
                    console.error(`[${new Date().toISOString()}] Error processing user ${user}:`, error);
                }
            }

            return userIds;
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in fetchLinkedUsers:`, error);
            return [];
        }
    }

    static async fetchLinkedCount(): Promise<number> {
        const url = new URL(config.API_ENDPOINT + CONSTANTS.FETCH_LINKED_COUNT);
        const request: RequestInfo = new Request(url, {
            method: 'GET',
            headers: new Headers({ 'x-api-key': config.API_KEY }),
        });
        const res = await fetch(request);
        if (!res.ok) {
            console.error("Error Fetching linked user count");
            return 0;
        }
        const json: { count: number } = await res.json();
        return json.count;
    }

    static async batchFetchRoles(guildIds: string[]): Promise<Map<string, string[]>> {
        const rolesMap = new Map<string, string[]>();
        const uncachedGuilds: string[] = [];

        // Only log if we need to fetch from API
        if (guildIds.length > 0) {
            const cacheKey = `roles_${guildIds[0]}`;
            const cachedRoles = Cache.get(cacheKey);
            if (cachedRoles) {
                // All guilds are cached, return early
                for (const guildId of guildIds) {
                    const guildCacheKey = `roles_${guildId}`;
                    const guildCachedRoles = Cache.get(guildCacheKey);
                    if (guildCachedRoles) {
                        rolesMap.set(guildId, guildCachedRoles);
                    }
                }
                return rolesMap;
            }
        }

        for (const guildId of guildIds) {
            const cacheKey = `roles_${guildId}`;
            const cachedRoles = Cache.get(cacheKey);
            if (cachedRoles) {
                rolesMap.set(guildId, cachedRoles);
            } else {
                uncachedGuilds.push(guildId);
            }
        }

        try {
            const url = new URL(config.API_ENDPOINT + CONSTANTS.FETCH_ROLES);
            url.searchParams.set('guildIds', uncachedGuilds.join(','));
            
            // Only log when actually fetching from API
            if (uncachedGuilds.length > 0) {
                console.log(`[${new Date().toISOString()}] Fetching roles from API for ${uncachedGuilds.length} guild(s)`);
            }
            
            const request = new Request(url, {
                method: 'GET',
                headers: new Headers({ 'x-api-key': config.API_KEY }),
            });

            const res = await fetch(request);
            if (!res.ok) {
                console.error(`[${new Date().toISOString()}] Error batch fetching roles:`, res.status, res.statusText);
                return rolesMap;
            }

            const json = await res.json();
            
            if (Array.isArray(json)) {
                for (const role of json) {
                    if (role && role.discordRoleIds && role.discordGuildIds) {
                        for (let i = 0; i < role.discordRoleIds.length; i++) {
                            const roleId = role.discordRoleIds[i];
                            const guildId = role.discordGuildIds[i];
                            
                            if (roleId && guildId) {
                                const guildRoles = rolesMap.get(guildId) || [];
                                guildRoles.push(roleId);
                                rolesMap.set(guildId, guildRoles);
                            }
                        }
                    } else if (role && role.discordRoleId && role.guildId) {
                        const guildRoles = rolesMap.get(role.guildId) || [];
                        guildRoles.push(role.discordRoleId);
                        rolesMap.set(role.guildId, guildRoles);
                    }
                }
                
                for (const [guildId, roles] of rolesMap) {
                    Cache.set(`roles_${guildId}`, roles);
                }
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in batchFetchRoles:`, error);
        }

        return rolesMap;
    }

    static async batchFetchUsersRoles(userIds: string[], guildId: string, client?: Client): Promise<Map<string, string[]>> {
        const rolesMap = new Map<string, string[]>();
        const uncachedUsers: string[] = [];
        const BATCH_SIZE = 50;

        for (const userId of userIds) {
            const cacheKey = `user_roles_${userId}_${guildId}`;
            const cachedRoles = Cache.get(cacheKey);
            if (cachedRoles) {
                rolesMap.set(userId, cachedRoles);
            } else {
                uncachedUsers.push(userId);
            }
        }

        if (uncachedUsers.length === 0) {
            return rolesMap;
        }

        for (let i = 0; i < uncachedUsers.length; i += BATCH_SIZE) {
            const batch = uncachedUsers.slice(i, i + BATCH_SIZE);
            try {
                const url = new URL(config.API_ENDPOINT + CONSTANTS.FETCH_USERS_ROLES);
                const body = { ids: batch, guildId };
                // Only log when actually fetching from API, not for every batch
                if (i === 0) {
                    console.log(`[${new Date().toISOString()}] Fetching user roles for ${uncachedUsers.length} users in guild ${guildId}`);
                }

                const request = new Request(url, {
                    method: 'POST',
                    headers: new Headers({
                        'x-api-key': config.API_KEY,
                        'Content-Type': 'application/json'
                    }),
                    body: JSON.stringify(body)
                });

                const res = await fetch(request);
                if (!res.ok) {
                    console.error(`[${new Date().toISOString()}] Error batch fetching user roles:`, {
                        status: res.status,
                        statusText: res.statusText,
                        url: res.url
                    });
                    
                    try {
                        const errorBody = await res.text();
                        console.error(`[${new Date().toISOString()}] Error response body:`, errorBody);
                    } catch (e) {
                        console.error(`[${new Date().toISOString()}] Could not read error response body:`, e);
                    }
                    
                    continue;
                }

                const json = await res.json();

                if (Array.isArray(json) && json.length === 0) {
                    console.warn(
                        `Received empty roles array for batch (guild ${guildId}).`
                    );
                }

                if (Array.isArray(json)) {
                    for (const userRole of json) {
                        if (userRole && userRole.userId && userRole.roles) {
                            rolesMap.set(userRole.userId, userRole.roles);
                            Cache.set(
                                `user_roles_${userRole.userId}_${guildId}`,
                                userRole.roles
                            );
                        }
                    }
                }
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Error in batchFetchUsersRoles:`, error);
                if (error instanceof Error) {
                    console.error(`[${new Date().toISOString()}] Error details:`, {
                        name: error.name,
                        message: error.message,
                        stack: error.stack
                    });
                }
            }
        }
        if (client) {
            const guild = client.guilds.cache.get(guildId);
            if (guild) {
                for (const [userId, roleIds] of rolesMap) {
                    try {
                        const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
                        if (!member) continue;

                        const toAdd = roleIds.filter(rid => !member.roles.cache.has(rid));
                        if (toAdd.length > 0) {
                            Api.setIgnoreRoleChange(3000);
                            await member.roles.add(toAdd).catch(() => null);
                            // Only log when actually assigning roles, not for every user
                            if (toAdd.length > 0) {
                                console.log(`[${new Date().toISOString()}] Assigned ${toAdd.length} role(s) to ${member.user.tag} in ${guild.name}`);
                            }
                        }
                    } catch (error) {
                        console.error(`[${new Date().toISOString()}] Failed to sync roles for user ${userId}:`, error);
                    }
                }
            }
        }

        return rolesMap;
    }

    static async fetchAndAssignUserRoles(client: Client): Promise<void> {
        try {
            // Start user role assignment process
            const linkedUsers = await Api.fetchLinkedUsers();
            console.log(`[${new Date().toISOString()}] Processing ${linkedUsers.length} linked users for role assignment`);

            const usersWithRoles: UserData[] = [];
            
            for (const discordId of linkedUsers) {
                try {
                    const userData = await this.fetchUserWithRoles(discordId);
                    if (userData) {
                        usersWithRoles.push(userData);
                    }
                } catch (error) {
                    console.error(`[${new Date().toISOString()}] Error fetching user ${discordId}:`, error);
                }
            }

            const allGuildIds = new Set<string>();
            
            for (const guildId of config.GUILD_IDS) {
                allGuildIds.add(guildId);
            }
            
            for (const user of usersWithRoles) {
                for (const role of user.roles) {
                    if (role.discordGuildIds) {
                        for (const guildIds of role.discordGuildIds) {
                            for (const guildId of guildIds) {
                                if (guildId) allGuildIds.add(guildId);
                            }
                        }
                    }
                }
            }

            const trackedRolesMap = await Api.batchFetchRoles(Array.from(allGuildIds));
            const linkedUserIds = new Set(usersWithRoles.map(user => user.discordId));

            for (const guildId of allGuildIds) {
                try {
                    const guild = client.guilds.cache.get(guildId);
                    if (!guild) continue;

                    const trackedRoles = trackedRolesMap.get(guildId) || [];
                    const members = await guild.members.fetch();
                    
                    for (const [memberId, member] of members) {
                        if (!linkedUserIds.has(memberId)) {
                            for (const roleId of trackedRoles) {
                                if (member.roles.cache.has(roleId)) {
                                    await this.removeRoleFromUser(client, { discordId: memberId } as UserData, roleId, guildId);
                                    console.log(`[${new Date().toISOString()}] Removed role ${roleId} from unlinked user ${member.user.tag} in ${guild.name}`);
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error(`[${new Date().toISOString()}] Error handling unlinked users for guild ${guildId}:`, error);
                }
            }

            for (const user of usersWithRoles) {
                try {
                    await this.assignUserRoles(client, user);
                } catch (error) {
                    console.error(`[${new Date().toISOString()}] Error assigning roles for user ${user.id}:`, error);
                }
            }

            console.log(`[${new Date().toISOString()}] Completed user role assignment`);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in fetchAndAssignUserRoles:`, error);
        }
    }

    static async fetchUserWithRoles(discordId: string): Promise<UserData | null> {
        try {
            const request = new Request(config.API_ENDPOINT + CONSTANTS.FETCH_USER + discordId, {
                method: 'GET',
                headers: new Headers({ 'x-api-key': config.API_KEY }),
            });

            const res = await fetch(request);
            if (!res.ok) {
                console.error(`[${new Date().toISOString()}] Error fetching user ${discordId}:`, res.status, res.statusText);
                return null;
            }

            const json = await res.json();
            
            let userData: any;
            if (json.users && Array.isArray(json.users) && json.users.length > 0) {
                userData = json.users[0];
            } else if (json && typeof json === 'object') {
                userData = json;
            } else {
                console.error(`[${new Date().toISOString()}] Invalid response format for user ${discordId}:`, json);
                return null;
            }

            if (!userData.discordId) {
                console.warn(`[${new Date().toISOString()}] No discordId found for user ${userData.id}`);
                return null;
            }

            const transformedUser: UserData = {
                id: userData.id,
                name: userData.name || 'Unknown',
                email: userData.email || '',
                emailVerified: userData.emailVerified || null,
                storeId: userData.storeId || userData.discordId,
                discordId: userData.discordId,
                image: userData.image || '',
                createdAt: userData.createdAt || '',
                updatedAt: userData.updatedAt || '',
                joinedSteamGroup: userData.joinedSteamGroup || false,
                isBanned: userData.isBanned || false,
                banReason: userData.banReason || null,
                isBoosting: userData.isBoosting || false,
                steamId: userData.steamId || '',
                isLinked: userData.isLinked || true,
                roles: userData.roles || [],
                accounts: userData.accounts || []
            };

            return transformedUser;
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in fetchUserWithRoles for ${discordId}:`, error);
            return null;
        }
    }

    static async assignUserRoles(client: Client, user: UserData): Promise<void> {
        if (!user.roles || !Array.isArray(user.roles)) {
            return;
        }

        const rolesToAssign = new Map<string, Set<string>>(); 

        for (const role of user.roles) {
            try {
                await this.processRoleAssignment(client, user, role, rolesToAssign);
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Error processing role ${role.name} for user ${user.id}:`, error);
            }
        }

        await this.handleRoleRemoval(client, user, rolesToAssign);
    }

    static async processRoleAssignment(client: Client, user: UserData, role: UserRole, rolesToAssign?: Map<string, Set<string>>): Promise<void> {
        if (role.assignOnBoost && !user.isBoosting) {
            return;
        }

        if (role.discordRoleIds && role.discordGuildIds) {
            for (let i = 0; i < role.discordRoleIds.length; i++) {
                const roleIds = role.discordRoleIds[i];
                const guildIds = role.discordGuildIds[i];

                if (roleIds && guildIds) {
                    for (let j = 0; j < roleIds.length; j++) {
                        const roleId = roleIds[j];
                        const guildId = guildIds[j];

                        if (roleId && guildId) {
                            await this.assignRoleToUser(client, user, roleId, guildId);
                            
                            if (rolesToAssign) {
                                if (!rolesToAssign.has(guildId)) {
                                    rolesToAssign.set(guildId, new Set());
                                }
                                rolesToAssign.get(guildId)!.add(roleId);
                            }
                        }
                    }
                }
            }
        }
    }

    static async assignRoleToUser(client: Client, user: UserData, roleId: string, guildId: string): Promise<void> {
        try {
            const userId = user.discordId || user.storeId;
            if (!userId) {
                console.warn(`[${new Date().toISOString()}] No Discord ID found for user ${user.id}`);
                return;
            }

            const guild = client.guilds.cache.get(guildId);
            if (!guild) {
                console.warn(`[${new Date().toISOString()}] Guild ${guildId} not found for user ${userId}`);
                return;
            }

            const botMember = guild.members.cache.get(client.user?.id || '');
            if (!botMember?.permissions.has('ManageRoles')) {
                console.error(`[${new Date().toISOString()}] Bot missing 'Manage Roles' permission in guild ${guild.name} (${guildId})`);
                return;
            }

            const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                console.warn(`[${new Date().toISOString()}] Member ${userId} not found in guild ${guildId}`);
                return;
            }

            const role = guild.roles.cache.get(roleId);
            if (!role) {
                console.warn(`[${new Date().toISOString()}] Role ${roleId} not found in guild ${guildId}`);
                return;
            }

            if (role.position >= (botMember.roles.highest?.position || 0)) {
                return;
            }

            if (member.roles.cache.has(roleId)) {
                return;
            }

            Api.setIgnoreRoleChange(3000);
            
            await member.roles.add(roleId);
            console.log(`[${new Date().toISOString()}] Assigned role ${role.name} to ${member.user.tag} in ${guild.name}`);

        } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 50013) {
                console.error(`[${new Date().toISOString()}] Missing permissions to assign role ${roleId} in guild ${guildId}. Please ensure the bot has 'Manage Roles' permission and the role is below the bot's highest role.`);
            } else {
                console.error(`[${new Date().toISOString()}] Error assigning role ${roleId} to user ${user.id} in guild ${guildId}:`, error);
            }
        }
    }

    static async handleRoleRemoval(client: Client, user: UserData, rolesToAssign: Map<string, Set<string>>): Promise<void> {
        const userId = user.discordId || user.storeId;
        if (!userId) {
            console.warn(`[${new Date().toISOString()}] No Discord ID found for user ${user.id}`);
            return;
        }
        
        console.log(`[${new Date().toISOString()}] Starting role removal check for user ${userId}`);
        
        const trackedRolesMap = await Api.batchFetchRoles(Array.from(rolesToAssign.keys()));
        
        for (const [guildId, assignedRoles] of rolesToAssign) {
            try {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) {
                    console.warn(`[${new Date().toISOString()}] Guild ${guildId} not found in bot cache`);
                    continue;
                }

                const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
                if (!member) {
                    console.warn(`[${new Date().toISOString()}] Member ${userId} not found in guild ${guildId}`);
                    continue;
                }

                const trackedRoles = trackedRolesMap.get(guildId) || [];
                
                // Only log essential role checking info
                console.log(`[${new Date().toISOString()}] Checking roles for ${member.user.tag} in ${guild.name}`);
                
                for (const roleId of trackedRoles) {
                    if (member.roles.cache.has(roleId)) {
                        if (!assignedRoles.has(roleId)) {
                            // Only log when about to remove a role
                            console.log(`[${new Date().toISOString()}] About to remove role ${roleId} from ${member.user.tag}`);
                            await this.removeRoleFromUser(client, user, roleId, guildId);
                            const role = guild.roles.cache.get(roleId);
                            console.log(`[${new Date().toISOString()}] Removed role ${role?.name || roleId} from ${member.user.tag} in ${guild.name} - not in website roles`);
                        } else {
                            // User correctly has the role - no need to log this
                        }
                    } else {
                        // User doesn't have tracked role - no need to log this
                    }
                }
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Error handling role removal for user ${user.id} in guild ${guildId}:`, error);
            }
        }
    }

    static async removeRoleFromUser(client: Client, user: UserData | { discordId: string }, roleId: string, guildId: string): Promise<void> {
        try {
            const userId = 'id' in user ? (user.discordId || user.storeId) : user.discordId;
            
            if (!userId) {
                console.warn(`[${new Date().toISOString()}] No Discord ID found for user removal`);
                return;
            }

            const guild = client.guilds.cache.get(guildId);
            if (!guild) {
                console.warn(`[${new Date().toISOString()}] Guild ${guildId} not found for user ${userId}`);
                return;
            }

            const botMember = guild.members.cache.get(client.user?.id || '');
            if (!botMember?.permissions.has('ManageRoles')) {
                console.error(`[${new Date().toISOString()}] Bot missing 'Manage Roles' permission in guild ${guild.name} (${guildId})`);
                return;
            }

            const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                console.warn(`[${new Date().toISOString()}] Member ${userId} not found in guild ${guildId}`);
                return;
            }

            const role = guild.roles.cache.get(roleId);
            if (!role) {
                console.warn(`[${new Date().toISOString()}] Role ${roleId} not found in guild ${guildId}`);
                return;
            }

            if (role.position >= (botMember.roles.highest?.position || 0)) {
                return;
            }

            if (!member.roles.cache.has(roleId)) {
                return;
            }

            Api.setIgnoreRoleChange(3000);
            
            await member.roles.remove(roleId);
            console.log(`[${new Date().toISOString()}] Removed role ${role.name} from ${member.user.tag} in ${guild.name}`);

        } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 50013) {
                console.error(`[${new Date().toISOString()}] Missing permissions to remove role ${roleId} in guild ${guildId}. Please ensure the bot has 'Manage Roles' permission and the role is below the bot's highest role.`);
            } else {
                console.error(`[${new Date().toISOString()}] Error removing role ${roleId} from user in guild ${guildId}:`, error);
            }
        }
    }
}

export class Transaction {
    userId: string;
    discordGuildId: string;
    role: string;
    action: string;

    constructor(userId: string, roleId: string, guildId: string, added: boolean) {
        this.userId = userId;
        this.role = roleId;
        this.discordGuildId = guildId;
        this.action = added ? "added" : "revoked";
    }
}

interface Log {
    action: string;
    timestamp: string;
    targetId: string;
    steamId: string;
    discordId: string;
    id: string;
    name: string;
    discordRoleId: string;
    discordGuildId: string;
    oxideGroupName: string;
    serverId: string;
}

interface MapVotes {
    id: string;
    enabled: boolean;
    server_id: string;
    vote_start: string;
    vote_end: string;
    map_start: string;
    created_at: string;
    updated_at: string;
    map_options: {
        id: string;
        order: number;
        size: number;
        seed: number;
        isStaging: boolean;
        url: string;
        rawImageUrl: string;
        imageUrl: string;
        imageIconUrl: string;
        thumbnailUrl: string;
        mapVoteId: string;
    }[];
    server: {
        server_name: string;
    };
}

interface UserRole {
    name: string;
    discordRoleIds: string[][];
    discordGuildIds: string[][];
    serverIds: string[][];
    oxideGroupNames: string[][];
    assignOnBoost: boolean;
}

interface UserData {
    id: string;
    name: string;
    email: string;
    emailVerified: string | null;
    storeId: string;
    discordId: string;
    image: string;
    createdAt: string;
    updatedAt: string;
    joinedSteamGroup: boolean;
    isBanned: boolean;
    banReason: string | null;
    isBoosting: boolean;
    steamId: string;
    isLinked: boolean;
    roles: UserRole[];
    accounts: {
        id: string;
        userId: string;
        type: string;
        provider: string;
        providerAccountId: string;
        refresh_token: string;
        access_token: string;
        expires_at: number;
        token_type: string;
        scope: string;
        id_token: string | null;
        session_state: string | null;
        refresh_token_expires_in: string | null;
        createdAt: string;
        updatedAt: string;
    }[];
}

interface UsersResponse {
    users: UserData[];
}