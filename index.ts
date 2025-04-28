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
    // Import addons
    await importx(`${dirname(import.meta.url)}/ADDONS/**/*.{js,ts}`);

    // let's start the bot
    if (!config.BOT_TOKEN) {
        throw Error("Could not find BOT_TOKEN in config.json");
    }

    await client.login(config.BOT_TOKEN);
}

start();