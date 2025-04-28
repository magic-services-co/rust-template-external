import { CONSTANTS } from "./constants.ts";
import config from '../config.json';
import type { Client } from "discordx";
import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, type Guild, type GuildBasedChannel, type MessageActionRowComponentBuilder } from "discord.js";

export class Api {
    static ignoreRoleChange: boolean;

    static sendRoleUpdate(transaction: Transaction): void {

        const headers: Headers = new Headers()
        headers.set('Content-Type', 'application/json');
        headers.set('Accept', 'application/json');
        headers.set('Authorization', `Bearer ${config.API_KEY}`);

        const request: RequestInfo = new Request(config.API_ENDPOINT +
            CONSTANTS.UPDATE_USER_ROLES, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ "roles": [transaction] })
        })

        fetch(request)
            .then(res => {
                if (!res.ok) {
                    console.error(`[${new Date().toISOString()}] Error sending role update to website:`, res);
                    res.json().then(json => console.error(`[${new Date().toISOString()}] Response body:`, json));
                } else {
                    console.log(`[${new Date().toISOString()}] Successfully sent role update to website`);
                }
            })
            .catch(error => {
                console.error(`[${new Date().toISOString()}] Error in sendRoleUpdate: ${error}`);
            });
    }

    static sendGuildUpdate(id: string, name: string, added: boolean) {
        const headers: Headers = new Headers();
        headers.set('Authorization', `Bearer ${config.API_KEY}`);
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
        const request: RequestInfo = new Request(config.API_ENDPOINT + CONSTANTS.FETCH_ROLES + guildId, {
            method: 'GET',
            headers: new Headers({ 'Authorization': `Bearer ${config.API_KEY}` }),
        });
        const res = await fetch(request);
        if (!res.ok) {
            console.error("Error Fetching roles for guild: ", guildId);
            console.error("body: ", res.body);
            return [];
        }
        const json = await res.json();
        return json.roles;
    }

    static async fetchUser(userId: string): Promise<{
        id: string, name: string, image: string, isBoosting: boolean,
        steamId: string, discordId: string, isLinked: boolean, storeId: string,
        joinedSteamGroup: boolean, roles: []
    } | null> {
        const request: RequestInfo = new Request(config.API_ENDPOINT + CONSTANTS.FETCH_USER + userId, {
            method: 'GET',
            headers: new Headers({ 'Authorization': `Bearer ${config.API_KEY}` }),
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
        const request: RequestInfo = new Request(config.API_ENDPOINT + CONSTANTS.FETCH_USERS_ROLES + `&discordId=${userId}&guildId=${guildId}`, {
            method: 'GET',
            headers: new Headers({ 'Authorization': `Bearer ${config.API_KEY}` }),
        });
        const res = await fetch(request);
        if (!res.ok) {
            console.error("Error Fetching roles for user: ", userId, ", guildId: ", guildId);
            console.error("body: ", res.body);
            return [];
        }
        const json = await res.json();

        return json.roles;
    }

    static async fetchAndApplyUpdates(client: Client, lastFetch: string) {
        const url = new URL(config.API_ENDPOINT + CONSTANTS.FETCH_STATS);
        url.searchParams.set('minimize', 'true');
        url.searchParams.set('startDate', lastFetch);
        const request: RequestInfo = new Request(url, {
            method: 'GET',
            headers: new Headers({ 'Authorization': `Bearer ${config.API_KEY}` }),
        });
        const res = await fetch(request);
        if (!res.ok) {
            console.error("Error Fetching logs from API");
            console.error("body: ", res.body);
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
            console.log(`Fetched and applied ${logs.length} update(s) successfully`);
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
                    Api.ignoreRoleChange = true;
                    setTimeout(() => Api.ignoreRoleChange = false, 2000);
                    await member.roles.add(log.discordRoleId);
                    console.log(`Role: "${log.discordRoleId}" added to: ${member.displayName} due to API`);
                } catch (error) {
                    console.error(`Error adding role to member ${member.displayName} (${log.discordId}), role: ${log.discordRoleId}, error: ${error}`);
                }
            } else if (log.action == "ROLE_REVOKED") {
                try {
                    Api.ignoreRoleChange = true;
                    setTimeout(() => Api.ignoreRoleChange = false, 2000);
                    await member.roles.remove(log.discordRoleId);
                    console.log(`Role: "${log.discordRoleId}" revoked from: ${member.displayName} due to API`);
                } catch (error) {
                    console.error(`Error revoking role from member ${member.displayName} (${log.discordId}), role: ${log.discordRoleId}, error: ${error}`);
                }
            } else if (log.action == "USER_UPDATED" && config.SET_DISCORD_NAME_TO_STEAM_NAME) {
                try {
                    console.log(`Changing name of "${member.nickname}" to "${log.name}"`);
                    await member.setNickname(log.name);
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
                return;
            }

            const role = guild.roles.cache.get(roleId);
            if (!role) {
                return;
            }

            if (action === "add") {
                if (member.roles.cache.has(roleId)) {
                    return;
                }
                try {
                    Api.ignoreRoleChange = true;
                    setTimeout(() => Api.ignoreRoleChange = false, 2000);
                    await member.roles.add(role);
                } catch (error) {
                    console.error(`[${new Date().toISOString()}] Error adding role to member ${member.displayName}: ${error}`);
                }
            } else {
                if (!member.roles.cache.has(roleId)) {
                    return;
                }
                try {
                    Api.ignoreRoleChange = true;
                    setTimeout(() => Api.ignoreRoleChange = false, 2000);
                    await member.roles.remove(role);
                } catch (error) {
                    console.error(`[${new Date().toISOString()}] Error removing role from member ${member.displayName}: ${error}`);
                }
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in handleInstantRoleUpdate: ${error}`);
        }
    }

    static async fetchAndPostMaps(client: Client, lastFetch: string) {
        const url = new URL(config.API_ENDPOINT + CONSTANTS.FETCH_MAP_VOTES);
        url.searchParams.set('startDate', lastFetch);
        const request: RequestInfo = new Request(url, {
            method: 'GET',
            headers: new Headers({ 'Authorization': `Bearer ${config.API_KEY}` }),
        });
        const res = await fetch(request);
        if (!res.ok) {
            console.error("Error Fetching map votes from API");
            console.error("body: ", res.body);
            return;
        }
        const votes: MapVotes[] = await res.json();
        const jsonChannels: { guild: string, channel: string }[] = config.MAP_VOTES_CHANNELS;
        const channels: GuildBasedChannel[] = [];
        
        for (const jsonChannel of jsonChannels) {
            try {
                const guild = client.guilds.cache.get(jsonChannel.guild);
                if (!guild) {
                    console.error(`Guild ${jsonChannel.guild} not found!`);
                    continue;
                }
                const channel = await guild.channels.fetch(jsonChannel.channel).catch(error => {
                    console.error(`Error fetching channel ${jsonChannel.channel} on guild ${jsonChannel.guild}: ${error}`);
                    return null;
                });
                if (!channel) {
                    console.error(`Channel ${jsonChannel.channel} not found on guild ${jsonChannel.guild}!`);
                    continue;
                }
                channels.push(channel);
            } catch (error) {
                console.error(`Error processing channel ${jsonChannel.channel} on guild ${jsonChannel.guild}: ${error}`);
            }
        }
        for (const vote of votes) {
            const hexString = "0x" + vote.color.replace("0x", "").replace("#", "").toUpperCase();
            const hexColour = Number(hexString);
            for (const channel of channels) {
                if (channel.isSendable()) {
                    const embed = new EmbedBuilder()
                        .setTitle(vote.title)
                        .setDescription(vote.description)
                        .setImage(vote.image)
                        .setColor(hexColour)
                        .addFields(vote.fields);

                    const mapButton = new ButtonBuilder()
                        .setLabel("View on RustMaps.com")
                        .setStyle(ButtonStyle.Link)
                        .setURL(vote.url);

                    const siteButton = new ButtonBuilder()
                        .setLabel("View votes on site")
                        .setStyle(ButtonStyle.Link)
                        .setURL(`${config.API_ENDPOINT.replace("/api", "")}/maps/%7B${vote.mapId}%7D`);

                    const row = new ActionRowBuilder<MessageActionRowComponentBuilder>()
                        .addComponents([mapButton, siteButton]);

                    channel.send({ embeds: [embed], components: [row] });
                }
            }
        }
        if (votes.length > 0) {
            console.log(`Fetched and posted ${votes.length} map vote(s) successfully`);
        }
    }

    static async fetchAndUpdateGuilds(client: Client) {
        const url = new URL(config.API_ENDPOINT + CONSTANTS.GUILDS);
        const request: RequestInfo = new Request(url, {
            method: 'GET',
            headers: new Headers({ 'Authorization': `Bearer ${config.API_KEY}` }),
        });
        const res = await fetch(request);
        if (!res.ok) {
            console.error("Failed to fetch guilds:\n", res);
            res.json().then(json => console.error("body: ", json)).catch(err => console.log(err));
            return;
        }
        const json: { id: string, name: string; }[] = await res.json();
        const added = client.guilds.cache.filter(guild => !json.includes({ id: guild.id, name: guild.name }));
        const removed = json.filter((guild) => !client.guilds.cache.has(guild.id));
        added.forEach((guild: Guild) => this.sendGuildUpdate(guild.id, guild.name, true));
        removed.forEach((guild) => this.sendGuildUpdate(guild.id, guild.name, false));
    }

    static async fetchLinkedUsers(): Promise<string[]> {
        const url = new URL(config.API_ENDPOINT + CONSTANTS.FETCH_LINKED_USERS);
        const request: RequestInfo = new Request(url, {
            method: 'GET',
            headers: new Headers({ 'Authorization': `Bearer ${config.API_KEY}` }),
        });

        const res = await fetch(request);
        if (!res.ok) {
            console.error("Error Fetching linked users");
            console.error("body: ", res.body);
            return [];
        }
        const json: { users: string[] } = await res.json();
        return json.users;
    }

    static async fetchLinkedCount(): Promise<number> {
        const url = new URL(config.API_ENDPOINT + CONSTANTS.FETCH_LINKED_COUNT);
        const request: RequestInfo = new Request(url, {
            method: 'GET',
            headers: new Headers({ 'Authorization': `Bearer ${config.API_KEY}` }),
        });
        const res = await fetch(request);
        if (!res.ok) {
            console.error("Error Fetching linked user count");
            console.error("body: ", res.body);
            return 0;
        }
        const json: { count: number } = await res.json();
        return json.count;
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
    title: string;
    description: string;
    mapId: string;
    image: string;
    url: string;
    color: string;
    fields: { name: string, value: string };
}