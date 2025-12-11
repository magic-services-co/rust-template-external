# Linking Bot - the discord bot
- The bot you will need for the Website Template linking, role sync and name sync features.

## 1. Hosting the Bot
- You will need to use the [Bun EGG](https://github.com/Zastinian/eseggs/blob/master/bun/egg-bun.json) for Pterodactyl - you can ask your hosting provider if they will support this.
- For hosting outside of pterodactyl see [Bun.sh](https://bun.sh/) for more.

## 2. API Key
- Navigate to your website, and go to the admin panel, then the API Keys tab on the nav on the left -> [see image](https://cdn.mrddd.xyz/img/2025/brave_xVa8oJjCdX)
- Press `Create New API Key`, name it "Linking Bot" and choose the following permissions: `Voting` (all), `Discord Sync Roles`, `Users` (all), `User Management` (GET), `Map Voting` (POST and GET), `Discord Integration` (all), `Role & Permissions Management` (all).
- It should look like this -> [see image](https://cdn.mrddd.xyz/img/2025/brave_RJYVviJo0R) -> [see image 2](https://cdn.mrddd.xyz/img/2025/brave_hHeUNle4hQ) -> [see image 3](https://cdn.mrddd.xyz/img/2025/brave_HIaq1OFM1w)
- Now press `Create API Key` and you'll see the Key here, copy it -> [see image](https://cdn.mrddd.xyz/img/2025/brave_IwcBwB416l)

## 3. Bot Configuration
#### Keys and IDs
- Navigate to the `config.json` file and paste the key into the `API_KEY` section within the config -> [see image](https://cdn.mrddd.xyz/img/2025/notepad%2B%2B_y6ZMmQcHp4)
- You can get the `BOT_TOKEN` from your `.env` file under `STEP DISC.1.` make sure you paste it properly -> [see image](https://cdn.mrddd.xyz/img/2025/notepad%2B%2B_eKSWZcXrAD)
- You can get the `CLIENT_ID` from your `.env` file under `STEP DISC.2.`.
- You can get the `GUILD_IDS` by right clicking your discord server and pressing `Copy Server ID` -> [see image](https://cdn.mrddd.xyz/img/2025/Discord_GrhujnOz8m)
- If you do not have the option to copy server id, go to your discord settings, advanced and enable developer mode -> [see image](https://cdn.mrddd.xyz/img/2025/Discord_o2thqvNQbE)
- `VIEW_MEMBERS_ROLES` is a Role ID of any role that you'd like to be able to use the /view-member command. You can get a Role ID by going into your server settings, roles and right clicking one of them, `Copy Role ID`.
- You can include multiple roles -> [see image](https://cdn.mrddd.xyz/img/2025/notepad%2B%2B_Bsl3W6LUte)
- You should leave `SYNC_USER_PERMS` alone, you can change this to a specific role permission, like `View Messages` - but this should be kept as an **admin only command.**

#### If you want map votes to be announced in a channel (after completion)
- If you do not want this, you can leave it blank. **Do not remove the variables.**
- You will see `MAP_VOTES_CHANNELS` use the same `GUILD_IDS` in the `guild` option provided - [see image](https://cdn.mrddd.xyz/img/2025/notepad%2B%2B_bIfHBeLJvu)
- Within your server, choose or make a channel for these votes, and right click it to copy the channel id.

#### Other Settings
- `Update Check Frequency` - is how often the bot will ask the website for role changes (like how long it takes for someone to get a role after linking their discord account to the site).
- `Set Discord name to Steam Name` - will change all linked discord members' usernames on your server to their rust username - to enable this change it to `true`.
- `EMBED_HEX` - is the Hex Color code of the embeds this bot will make, you can get hex color codes from -> [this website](https://htmlcolorcodes.com/) - don't include the **#**.
- `ACTIVITY_TYPE` - is for the bot status, you can choose between `PLAYING`, `STREAMING`, `LISTENING`, `WATCHING`, `COMPETING`, and `CUSTOM`.
- `{USERS_AMOUNT}` is the only variable you can use in the status, you can optionally remove it too - it displays the total amount of linked users on the website, for example `96 users linked!`.
- `API_ENDPOINT` - this should be set to your domain in the config `magicservices.co` is set by default - make sure you keep `https://` and `/api`.

### Bot is done.

# Magic Core - the rust plugin
- The plugin you will need for the Website Template linking, role sync, leaderboard, name sync and banning features.

## 1. A Compatible Rust Server
- You will need a rust server running oxide / uMod or Carbon for this plugin to go on.
- Place the plugin file found in the `WEBSITE_PLUGIN` folder into your rust servers plugin folder.
- Then open the config file on your rust server.

## 2. API Key
- Navigate to your website, and go to the admin panel, then the API Keys tab on the nav on the left -> [see image](https://cdn.mrddd.xyz/img/2025/brave_xVa8oJjCdX)
- Press `Create New API Key`, name it in relation to the server it's going on, you should create a new API Key for each Rust Server. (*but you don't have to*)
- Choose the following permissions: `Users` (all), `Bans` (all), `User Management` (all), `Leaderboard Management` (all), `Role & Permissions Management` (all), `Server Management` (First POST, PUT).
- It should look like this -> [see image](https://cdn.mrddd.xyz/img/2025/brave_Nh9vEnChGG) -> [see image 2](https://cdn.mrddd.xyz/img/2025/brave_Ci1CL2SAHw) -> [see image 3](https://cdn.mrddd.xyz/img/2025/brave_gAs8bGa8Iv)
- Now press `Create API Key` and you'll see the Key here, copy it and paste it into your config file into `API_KEY` -> [see image](https://cdn.mrddd.xyz/img/2025/brave_nAfsgSvbG2)

## 3. Plugin Configuration
#### General Settings
- `API_END_POINT` - is the same one you used on your bot, including the `https://` and `/api`.
- `SERVER_ID` - is the Battlemetrics ID of your rust server **this will be different on every rust server you have!** - you can copy it easily again from your websites admin panel, in the servers page on the left nav -> [see image](https://cdn.mrddd.xyz/img/2025/brave_i9ZcbAZj2D)
- `Update Check Frequency` - is how often the plugin will ask the website for role changes (like how long it takes for someone to get a group after linking their steam account to the site).
- `DEBUG` - this can be ignored, we will only ask you to turn it on if you're experiencing bugs.
- `BAN_SYSTEM_ENABLED` - if you plan on using the websites in built ban system, the rest of the ban system configuration options can safely be left default.

#### Role Common Names
- When a player runs the `/link` command in game it will automatically refresh their role status to the roles they have on the website - it's a faster way then waiting for the automatic addition.
- This command will let them know which groups they have been added to, if you want to put common names inplace of your group names you can do that here.
- For example: Your `vip2` oxide group is your `VIP Silver`, you can set that here -> [see image](https://cdn.mrddd.xyz/img/2025/brave_fJ8mMIKnxE)
- Make sure you validate your config file after updating it, you can do this -> [on this website](https://jsonlint.com/)
- If it returns `JSON is valid!` you're perfect! -> [see image](https://cdn.mrddd.xyz/img/2025/brave_zVS9HaHqbe)

### Plugin is done.

