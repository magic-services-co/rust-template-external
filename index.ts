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

        const lastFetch = storage.get('lastFetch') as string | undefined;
        
        if (!lastFetch) {
            console.log(`[${new Date().toISOString()}] No lastFetch found - performing initial sync`);
        } else {
            const lastFetchTime = new Date(lastFetch).getTime();
            const hoursOffline = (Date.now() - lastFetchTime) / (1000 * 60 * 60);
            const minutesOffline = (Date.now() - lastFetchTime) / (1000 * 60);
            console.log(`[${new Date().toISOString()}] Bot was offline for ${minutesOffline.toFixed(1)} minutes (${hoursOffline.toFixed(2)} hours) - performing full sync`);
        }

        if (config.ROLE_SYNC_ENABLED) {
            try {
                await Api.fetchAndAssignUserRoles(client);
                console.log(`[${new Date().toISOString()}] Full sync after startup completed`);
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Error during full sync after startup:`, error);
            }
        } else {
            console.log(`[${new Date().toISOString()}] Role sync is disabled - skipping startup sync`);
        }

        storage.set('lastFetch', new Date().toISOString());

        setInterval(async () => {
            await Api.fetchAndPostMaps(client, new Date(Date.now() - 60000).toISOString());
            
            if (config.ROLE_SYNC_ENABLED) {
                const currentLastFetch = storage.get('lastFetch') as string || new Date(Date.now() - 60000).toISOString();
                await Api.fetchAndApplyUpdates(client, currentLastFetch);
                storage.set('lastFetch', new Date().toISOString());
            }
            
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