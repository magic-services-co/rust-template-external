import {dirname, importx} from "@discordx/importer";
import {Client} from "discordx";
import {ActivityType, IntentsBitField, Partials} from "discord.js";
import config from './config.json';
import {Api} from "./tools/Api.ts";
import Conf from 'conf';

const schema = {
    lastFetch: {
        type: 'string'
    }
};

const storage = new Conf({projectName: 'Linking-bot', schema});

const RATE_LIMIT = {
    maxRequests: 50,
    timeWindow: 60000, 
    requests: new Map<string, number[]>()
};

function isRateLimited(endpoint: string): boolean {
    const now = Date.now();
    const requests = RATE_LIMIT.requests.get(endpoint) || [];
    
    const recentRequests = requests.filter(time => now - time < RATE_LIMIT.timeWindow);
    RATE_LIMIT.requests.set(endpoint, recentRequests);
    
    if (recentRequests.length >= RATE_LIMIT.maxRequests) {
        return true;
    }
    
    recentRequests.push(now);
    return false;
}

async function start() {
    const client = new Client({
        botId: config.CLIENT_ID,
        intents: [
            IntentsBitField.Flags.Guilds,
            IntentsBitField.Flags.GuildModeration,
            IntentsBitField.Flags.GuildMembers,
        ],
        botGuilds: config.GUILD_IDS,
        partials: [Partials.GuildMember]
    });

    client.once("ready", async () => {
        console.log(">> Bot started");
        await Api.fetchAndUpdateGuilds(client);
        
        // Initial role assignment based on user data structure
        await Api.fetchAndAssignUserRoles(client);
        
        setInterval(async () => {
            try {
                if (isRateLimited('sync')) {
                    console.log(`[${new Date().toISOString()}] Rate limit reached, skipping sync cycle`);
                    return;
                }

                const linkedMembers = await Api.fetchLinkedUsers();
                
                for (const guildId of config.GUILD_IDS) {
                    const guild = client.guilds.cache.get(guildId);
                    if (!guild) continue;

                    try {
                        const rolesMap = await Api.batchFetchRoles([guildId]);
                        const rolesToTrack = rolesMap.get(guildId) || [];
                        
                        const members = await guild.members.fetch();
                        const memberIds = Array.from(members.keys());
                        
                        const memberRolesMap = await Api.batchFetchUsersRoles(memberIds, guildId, client);
                        
                        for (const [memberId, member] of members) {
                            try {
                                if (!member.roles || !member.roles.cache) continue;

                                const membersRoles = memberRolesMap.get(memberId) || [];
                                const isLinked = linkedMembers.includes(memberId);
                                
                                if (!isLinked) {
                                    for (const roleId of rolesToTrack) {
                                        if (!roleId || typeof roleId !== 'string') continue;
                                        const role = guild.roles.cache.get(roleId);
                                        if (!role) continue;
                                        if (member.roles.cache.has(roleId)) {
                                            console.log(`[${new Date().toISOString()}] Removing role ${role.name} from unlinked user ${member.user.tag}`);
                                            await Api.handleInstantRoleUpdate(client, member.id, roleId, guildId, "remove");
                                        }
                                    }
                                } else {
                                    for (const roleId of membersRoles) {
                                        if (!member.roles.cache.has(roleId)) {
                                            const role = guild.roles.cache.get(roleId);
                                            if (role) {
                                                console.log(`[${new Date().toISOString()}] Adding missing role ${role.name} to linked user ${member.user.tag}`);
                                                await Api.handleInstantRoleUpdate(client, member.id, roleId, guildId, "add");
                                            }
                                        }
                                    }
                                }
                            } catch (error) {
                                console.error(`[${new Date().toISOString()}] Error processing member ${memberId}:`, error);
                            }
                        }
                    } catch (error) {
                        console.error(`[${new Date().toISOString()}] Error processing guild ${guildId}:`, error);
                    }
                }
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Error in periodic role sync:`, error);
            }
        }, 30000);

        setInterval(async () => {
            try {
                if (isRateLimited('user_roles')) {
                    console.log(`[${new Date().toISOString()}] Rate limit reached, skipping user role assignment cycle`);
                    return;
                }
                await Api.fetchAndAssignUserRoles(client);
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Error in periodic user role assignment:`, error);
            }
        }, 60000); // Run every minute

        setInterval(async () => {
            const lastFetch = storage.get<string, string>("lastFetch", new Date().toISOString());
            await Api.fetchAndApplyUpdates(client, lastFetch);
            await Api.fetchAndPostMaps(client, lastFetch);
            storage.set("lastFetch", new Date().toISOString());
            let activityType = ActivityType.Custom;
            switch (config.ACTIVITY_TYPE) {
                case "Competing":
                    activityType = ActivityType.Competing;
                    break;
                case "Custom":
                    activityType = ActivityType.Custom;
                    break;
                case "Playing":
                    activityType = ActivityType.Playing;
                    break;
                case "Listening":
                    activityType = ActivityType.Listening;
                    break;
                case "Watching":
                    activityType = ActivityType.Watching;
                    break;
                case "Streaming":
                    activityType = ActivityType.Streaming;
                    break;
            }
            client.user?.setPresence({
                status: 'online',
                activities: [{type: activityType, name: config.STATUS_TEXT.replace('{USERS_AMOUNT}', `${await Api.fetchLinkedCount()}`)}]
            });
        }, config["UPDATE_CHECK_FREQUENCY (MINUTES)"] * 60_000);
        await client.initApplicationCommands();
    });

    client.on("interactionCreate", (interaction: any) => {
        client.executeInteraction(interaction);
    });

    await importx(`${dirname(import.meta.url)}/commands/**/*.{js,ts}`);
    await importx(`${dirname(import.meta.url)}/events/**/*.{js,ts}`);
    await importx(`${dirname(import.meta.url)}/ADDONS/**/*.{js,ts}`);

    if (!config.BOT_TOKEN) {
        throw Error("Could not find BOT_TOKEN in config.json");
    }

    await client.login(config.BOT_TOKEN);
}

start();