using HarmonyLib;
using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;
using Oxide.Core;
using Oxide.Core.Libraries;
using Oxide.Core.Plugins;
using Rust;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

//MagicCore created with PluginMerge v(1.0.8.0) by MJSU @ https://github.com/dassjosh/Plugin.Merge
namespace Oxide.Plugins
{
    [Info("MagicCore", "Magic Services / Shady14u && Vinni P.", "1.3.0")]
    [Description("Core Logic for the Leader Board and Linking System")]
    public partial class MagicCore : RustPlugin
    {
        #region 0.MagicCore.cs
        private readonly List<Timer> _timers = new();
        
        private readonly Dictionary<ulong, BanInfo> _banCache = new Dictionary<ulong, BanInfo>();
        private readonly Queue<ulong> _pendingBanChecks = new Queue<ulong>();
        private readonly object _banCacheLock = new object();
        
        private Dictionary<string, string> GetHeaders()
        {
            if (_config == null)
            {
                LogIt("GetHeaders: _config is null");
                return new Dictionary<string, string>();
            }
            
            var apiKey = _config.MagicApiKey ?? string.Empty;
            return new Dictionary<string, string> {{"x-api-key", apiKey}};
        }
        
        private PlayerStat GetPlayerStats(ulong playerId)
        {
            if(_playerStats.TryGetValue(playerId,out var playerStat))
            {
                return playerStat;
            }
            playerStat = new PlayerStat { SteamId = playerId, ServerId = _config.ServerId, LoginTime = DateTime.Now };
            _playerStats[playerId] = playerStat;
            return playerStat;
        }
        
        private void LogIt(string message)
        {
            if(_config != null && _config.Debug)
            PrintWarning($"{DateTime.Now}: {message}");
        }
        
        #region Ban System Methods
        
        private bool IsBanCacheValid(BanInfo banInfo)
        {
            return DateTime.UtcNow.Subtract(banInfo.CachedAt).TotalMinutes < _config.BanCheckCacheMinutes;
        }
        
        private void AddPlayerToBanCheckQueue(ulong playerId)
        {
            if (!_config.BanSystemEnabled) return;
            
            lock (_banCacheLock)
            {
                if (!_pendingBanChecks.Contains(playerId))
                {
                    _pendingBanChecks.Enqueue(playerId);
                }
            }
        }
        
        private void ProcessPendingBanChecks()
        {
            if (!_config.BanSystemEnabled) return;
            
            var playersToCheck = new List<BasePlayer>();
            
            lock (_banCacheLock)
            {
                while (_pendingBanChecks.Count > 0 && playersToCheck.Count < _config.BanBatchSize)
                {
                    var userId = _pendingBanChecks.Dequeue();
                    var player = BasePlayer.FindByID(userId);
                    if (player != null)
                    {
                        playersToCheck.Add(player);
                    }
                }
            }
            
            if (playersToCheck.Count > 0)
            {
                ServerMgr.Instance.StartCoroutine(CheckPlayersBanBatch(playersToCheck));
            }
        }
        
        private IEnumerator CheckPlayersBanBatch(List<BasePlayer> players)
        {
            if (!_config.BanSystemEnabled) yield break;
            
            try
            {
                var steamIds = new List<string>();
                var playerMap = new Dictionary<string, BasePlayer>();
                
                foreach (var player in players)
                {
                    var steamId = player.UserIDString;
                    steamIds.Add(steamId);
                    playerMap[steamId] = player;
                }
                
                var url = $"{_config.ApiEndpoint}/bans/check-batch-fast?steamIds={string.Join(",", steamIds)}";
                LogIt($"Checking ban batch for {steamIds.Count} players using {_config.ApiEndpoint}");
                
                webrequest.Enqueue(url, null,
                (code, response) =>
                {
                    if (code == 200 && !string.IsNullOrEmpty(response))
                    {
                        try
                        {
                            var result = JsonConvert.DeserializeObject<BanBatchResponse>(response);
                            
                            foreach (var steamId in steamIds)
                            {
                                if (result.Results.TryGetValue(steamId, out var banData))
                                {
                                    var player = playerMap[steamId];
                                    var banInfo = new BanInfo
                                    {
                                        Banned = banData.Banned,
                                        Type = banData.Type,
                                        Reason = banData.Reason,
                                        Expires = !string.IsNullOrEmpty(banData.Expires) ? DateTime.Parse(banData.Expires) : null,
                                        CachedAt = DateTime.UtcNow,
                                        SteamId = steamId
                                    };
                                    
                                    lock (_banCacheLock)
                                    {
                                        _banCache[player.userID] = banInfo;
                                    }
                                    
                                    if (banInfo.Banned)
                                    {
                                        KickPlayer(player, banInfo.Reason);
                                    }
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            LogIt($"Error deserializing batch ban response: {ex.Message}");
                        }
                    }
                    else
                    {
                        LogIt($"Ban check batch API error: {code} - {response}");
                    }
                }, this, RequestMethod.GET, GetHeaders());
            }
            catch (Exception ex)
            {
                LogIt($"Error checking batch bans: {ex.Message}");
            }
            
            yield break;
        }
        
        private IEnumerator CheckPlayerBan(BasePlayer player)
        {
            if (!_config.BanSystemEnabled || player == null) yield break;
            
            try
            {
                var steamId = player.UserIDString;
                
                lock (_banCacheLock)
                {
                    if (_banCache.TryGetValue(player.userID, out var cached))
                    {
                        if (IsBanCacheValid(cached))
                        {
                            if (cached.Banned)
                            {
                                KickPlayer(player, cached.Reason);
                            }
                            yield break;
                        }
                    }
                }
                
                var url = $"{_config.ApiEndpoint}/bans/check-fast?steamId={steamId}";
                
                webrequest.Enqueue(url, null,
                (code, response) =>
                {
                    if (code == 200 && !string.IsNullOrEmpty(response))
                    {
                        try
                        {
                            var banData = JsonConvert.DeserializeObject<BanResponse>(response);
                            
                            var banInfo = new BanInfo
                            {
                                Banned = banData.Banned,
                                Type = banData.Type,
                                Reason = banData.Reason,
                                Expires = !string.IsNullOrEmpty(banData.Expires) ? DateTime.Parse(banData.Expires) : null,
                                CachedAt = DateTime.UtcNow,
                                SteamId = steamId
                            };
                            
                            lock (_banCacheLock)
                            {
                                _banCache[player.userID] = banInfo;
                            }
                            
                            if (banInfo.Banned)
                            {
                                KickPlayer(player, banInfo.Reason);
                            }
                        }
                        catch (Exception ex)
                        {
                            LogIt($"Error deserializing ban response for {player.displayName}: {ex.Message}");
                        }
                    }
                    else
                    {
                        LogIt($"Ban check API error for {player.displayName}: {code} - {response}");
                    }
                }, this, RequestMethod.GET, GetHeaders());
            }
            catch (Exception ex)
            {
                LogIt($"Error checking ban for {player.displayName}: {ex.Message}");
            }
            
            yield break;
        }
        
        private void KickPlayer(BasePlayer player, string reason)
        {
            if (player == null) return;
            
            var message = $"You are banned from this server.\nReason: {reason}";
            player.Kick(message);
            LogIt($"Kicked banned player: {player.displayName} ({player.UserIDString}) - {reason}");
        }
        
        private void CheckAllConnectedPlayersBans()
        {
            if (!_config.BanSystemEnabled) return;
            
            var connectedPlayers = BasePlayer.activePlayerList.ToList();
            LogIt($"Performing periodic ban check for {connectedPlayers.Count} connected players");
            
            foreach (var player in connectedPlayers)
            {
                AddPlayerToBanCheckQueue(player.userID);
            }
            
            CleanupBanCache();
        }
        
        private void SyncAllConnectedPlayersRoles()
        {
            var connectedPlayers = BasePlayer.activePlayerList.ToList();
            LogIt($"Performing periodic role sync for {connectedPlayers.Count} connected players");
            
            foreach (var player in connectedPlayers)
            {
                ServerMgr.Instance.StartCoroutine(SyncRoles(player));
            }
        }
        
        private void CleanupBanCache()
        {
            lock (_banCacheLock)
            {
                var expiredKeys = new List<ulong>();
                var cutoffTime = DateTime.UtcNow.AddMinutes(-_config.BanCheckCacheMinutes * 2);
                
                foreach (var kvp in _banCache)
                {
                    if (kvp.Value.CachedAt < cutoffTime)
                    {
                        expiredKeys.Add(kvp.Key);
                    }
                }
                
                foreach (var key in expiredKeys)
                {
                    _banCache.Remove(key);
                }
                
                if (expiredKeys.Count > 0)
                {
                    LogIt($"Cleaned up {expiredKeys.Count} expired ban cache entries");
                }
            }
        }
        
        #endregion
        #endregion

        #region 1.MagicCore.Config.cs
        private static Configuration _config;
        
        public class Configuration
        {
            [JsonProperty(PropertyName = "API_END_POINT")]
            public string ApiEndpoint { get; set; } = string.Empty;
            
            [JsonProperty(PropertyName = "SERVER_ID")]
            public string ServerId { get; set; } = string.Empty;
            
            [JsonProperty(PropertyName = "API_KEY")]
            public string MagicApiKey { get; set; } = string.Empty;
            
            [JsonProperty(PropertyName = "UPDATE_CHECK_FREQUENCY (MINUTES)")]
            public int UpdateCheckFrequency { get; set; } = 5;
            
            [JsonProperty(PropertyName = "DEBUG")]
            public bool Debug { get; set; } = false;
            
            [JsonProperty(PropertyName = "BAN_SYSTEM_ENABLED")]
            public bool BanSystemEnabled { get; set; } = true;
            
            [JsonProperty(PropertyName = "BAN_CHECK_CACHE_MINUTES")]
            public int BanCheckCacheMinutes { get; set; } = 5;
            
            [JsonProperty(PropertyName = "BAN_PERIODIC_CHECK_MINUTES")]
            public int BanPeriodicCheckMinutes { get; set; } = 10;
            
            [JsonProperty(PropertyName = "BAN_BATCH_SIZE")]
            public int BanBatchSize { get; set; } = 10;
            
            public Dictionary<string, string> RoleCommonNames { get; set; }
            
            public static Configuration DefaultConfig()
            {
                return new Configuration
                {
                    RoleCommonNames = new Dictionary<string, string>
                    {
                        {"admin", "Admin"},
                        {"linked", "Linked"}
                    }
                };
            }
        }
        
        
        #region BoilerPlate
        protected override void LoadConfig()
        {
            base.LoadConfig();
            try
            {
                _config = Config.ReadObject<Configuration>();
                if (_config == null) LoadDefaultConfig();
                SaveConfig();
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                LogIt("Creating new config file.");
                LoadDefaultConfig();
            }
        }
        protected override void LoadDefaultConfig() => _config = Configuration.DefaultConfig();
        protected override void SaveConfig() => Config.WriteObject(_config);
        #endregion
        #endregion

        #region 2.MagicCore.Localization.cs
        private static class PluginMessages
        {
            public const string RolesAdded = "RolesAdded";
            public const string RolesRemoved = "RolesRemoved";
            public const string NoChanges = "NoChanges";
        }
        
        protected override void LoadDefaultMessages()
        {
            lang.RegisterMessages(new Dictionary<string, string>
            {
                [PluginMessages.RolesAdded] = "You have been added to the following roles [{0}]",
                [PluginMessages.RolesRemoved] = "You have been removed from the following roles [{0}]",
                [PluginMessages.NoChanges] = "No changes found."
            }, this);
        }
        
        private string GetMsg(string key, object userId = null)
        {
            return lang.GetMessage(key, this, userId?.ToString());
        }
        #endregion

        #region 3.MagicCore.Permissions.cs
        private void LoadPermissions()
        {
            permission.RegisterPermission("MagicCore.use", this);
        }
        #endregion

        #region 4.MagicCore.Data.cs
        private StoredData _storedData;
        
        public class StoredData
        {
            public DateTime LastLogTime { get; set; } = DateTime.Now.AddDays(-1).ToUniversalTime();
        }
        
        #region BoilerPlate
        private void LoadData()
        {
            try
            {
                _storedData = Interface.GetMod().DataFileSystem.ReadObject<StoredData>("MagicCore");
            }
            catch (Exception e)
            {
                Puts(e.Message);
                Puts(e.StackTrace);
                _storedData = new StoredData();
            }
        }
        
        private void SaveData()
        {
            Interface.GetMod().DataFileSystem.WriteObject("MagicCore", _storedData);
        }
        #endregion
        #endregion

        #region 5.MagicCore.Hooks.cs
        void CanHackCrate(BasePlayer player, HackableLockedCrate crate)
        {
            GetPlayerStats(player.userID.Get()).HackedCratesLooted++;
        }
        
        private void Init()
        {
            LoadPermissions();
            LoadData();
        }
        
        void OnCollectiblePickup(CollectibleEntity collectible, BasePlayer player)
        {
            var collectibleName = collectible.ShortPrefabName.Split('-')[0];
            
            switch (collectibleName)
            {
                case "wood":
                GetPlayerStats(player.userID.Get()).WoodFarmed += (int) collectible.itemList[0].amount;
                break;
                case "metal":
                GetPlayerStats(player.userID.Get()).MetalFarmed += (int) collectible.itemList[0].amount;
                break;
                case "stone":
                GetPlayerStats(player.userID.Get()).StoneFarmed += (int) collectible.itemList[0].amount;
                break;
                case "hemp":
                GetPlayerStats(player.userID.Get()).ClothCollected += (int) collectible.itemList[0].amount;
                break;
                case "mushroom":
                GetPlayerStats(player.userID.Get()).MushroomsHarvested += (int) collectible.itemList[0].amount;
                break;
                case "berry":
                GetPlayerStats(player.userID.Get()).BerriesHarvested += (int) collectible.itemList[0].amount;
                break;
                case "pumpkin":
                GetPlayerStats(player.userID.Get()).PumpkinsHarvested += (int) collectible.itemList[0].amount;
                break;
                case "corn":
                GetPlayerStats(player.userID.Get()).CornHarvested += (int) collectible.itemList[0].amount;
                break;
                case "potato":
                GetPlayerStats(player.userID.Get()).PotatoesHarvested += (int) collectible.itemList[0].amount;
                break;
            }
        }
        
        void OnDispenserBonus(ResourceDispenser dispenser, BasePlayer player, Item item)
        {
            OnDispenserGathered(dispenser, player, item);
        }
        
        void OnDispenserGathered(ResourceDispenser dispenser, BaseEntity entity, Item item)
        {
            var player = entity?.ToPlayer();
            if (player == null) return;
            
            switch (item.info.shortname)
            {
                case "leather":
                GetPlayerStats(player.userID.Get()).LeatherCollected += item.amount;
                break;
                case "cloth":
                GetPlayerStats(player.userID.Get()).ClothCollected += item.amount;
                break;
                case "wood":
                GetPlayerStats(player.userID.Get()).WoodFarmed += item.amount;
                break;
                case "sulfur.ore":
                GetPlayerStats(player.userID.Get()).SulfurFarmed += item.amount;
                break;
                case "stones":
                GetPlayerStats(player.userID.Get()).StoneFarmed += item.amount;
                break;
                case "metal.ore":
                GetPlayerStats(player.userID.Get()).MetalFarmed += item.amount;
                break;
                case "hq.metal.ore":
                GetPlayerStats(player.userID.Get()).HqmFarmed += item.amount;
                break;
            }
        }
        
        void OnEntityDeath(BaseCombatEntity entity, HitInfo info)
        {
            if (entity == null || info == null) return;
            
            var attackerPlayer = info.Initiator as BasePlayer;
            if (attackerPlayer == null) return;
            var attacker = attackerPlayer.userID.Get();
            var victim = entity.ToPlayer();
            
            switch (entity)
            {
                case BaseAnimalNPC:
                GetPlayerStats(attacker).AnimalKills++;
                return;
                case BasePlayer:
                {
                    if (entity.IsNpc)
                    {
                        GetPlayerStats(attacker).NpcKills++;
                        return;
                    }
                    
                    if (victim != null)
                    {
                        var victimStats = GetPlayerStats(victim.userID.Get());
                        if (victim.lastDamage == DamageType.Suicide)
                        {
                            victimStats.Suicides++;
                        }
                        
                        victimStats.Deaths++;
                        if (attackerPlayer.IsNpc || entity.lastDamage == DamageType.Suicide) return;
                        GetPlayerStats(attacker).Kills++;
                    }
                    
                    break;
                }
            }
        }
        
        void OnEntityDestroy(BaseCombatEntity entity)
        {
            switch (entity)
            {
                case BradleyAPC bradley:
                GetPlayerStats(bradley.lastAttacker.ToPlayer().userID.Get()).BradleyKills++;
                break;
            }
        }
        
        void OnEntityTakeDamage(BaseCombatEntity entity, HitInfo info)
        {
            if (entity is not BasePlayer || info.Initiator is not BasePlayer attacker) return;
            if (info.isHeadshot)
            GetPlayerStats(attacker.userID.Get()).HeadShots++;
        }
        
        void OnExplosiveThrown(BasePlayer player, BaseEntity entity, ThrownWeapon item)
        {
            var explosive = item.name.ToLower();
            if (explosive.Contains("timed"))
            {
                GetPlayerStats(player.userID.Get()).TimedExplosivesThrown++;
                return;
            }
            
            if (explosive.Contains("supplysignal"))
            {
                GetPlayerStats(player.userID.Get()).SupplySignalThrown++;
                return;
            }
            
            if (explosive.Contains("satchelcharge"))
            {
                GetPlayerStats(player.userID.Get()).SatchelChargesThrown++;
            }
        }
        
        void OnItemAction(Item item, string action, BasePlayer player)
        {
            if (action == "Gut" && item.info.shortname.Contains("fish"))
            {
                GetPlayerStats(player.userID.Get()).FishGutted++;
            }
        }
        
        void OnMissionStarted(BaseMission mission, BaseMission.MissionInstance instance, BasePlayer player)
        {
            GetPlayerStats(player.userID.Get()).MissionsStarted++;
        }
        
        void OnMissionSucceeded(BaseMission mission, BaseMission.MissionInstance instance, BasePlayer player)
        {
            GetPlayerStats(player.userID.Get()).MissionsCompleted++;
        }
        
        void OnPatrolHelicopterKill(PatrolHelicopter heli, HitInfo info)
        {
            if (heli == null || heli.lastAttacker == null || !heli.myAI.isDead) return;
            GetPlayerStats(heli.lastAttacker.ToPlayer().userID.Get()).HeliKills++;
        }
        
        void OnPlayerConnected(BasePlayer player)
        {
            GetPlayerStats(player.userID.Get());
            ServerMgr.Instance.StartCoroutine(SendPlayerInfo(player));
            ServerMgr.Instance.StartCoroutine(SyncRoles(player));
            
            AddPlayerToBanCheckQueue(player.userID);
        }
        
        void OnPlayerDisconnected(BasePlayer player)
        {
            var stats = GetPlayerStats(player.userID.Get());
            stats.LogoffTime = DateTime.Now;
            SendSinglePlayerStats(new[] {stats}.ToList());
            ServerMgr.Instance.StartCoroutine(SendPlayerInfo(player));
            _playerStats.Remove(player.userID.Get());
            
            lock (_banCacheLock)
            {
                _banCache.Remove(player.userID);
            }
        }
        
        void OnRocketLaunched(BasePlayer player, BaseEntity entity)
        {
            switch (entity.ShortPrefabName)
            {
                case "rocket_hv":
                GetPlayerStats(player.userID.Get()).HvRocketsFired++;
                break;
                case "rocket_fire":
                GetPlayerStats(player.userID.Get()).IncendiaryRocketsFired++;
                break;
                case "rocket_smoke":
                GetPlayerStats(player.userID.Get()).SmokeRocketsFired++;
                break;
                case "40mm_grenade_he":
                GetPlayerStats(player.userID.Get()).HeGrenadeFired++;
                break;
                default:
                GetPlayerStats(player.userID.Get()).RocketsFired++;
                break;
            }
        }
        
        void OnServerInitialized(bool initial)
        {
            ResetPlayerStats(DateTime.Now);
            foreach (var player in BasePlayer.activePlayerList)
            {
                OnPlayerConnected(player);
            }
                        
            GetTrackedRoles();
            _timers.Add(timer.Every(_config.UpdateCheckFrequency * 120, GetTrackedRoles));
            _timers.Add(timer.Every(_config.UpdateCheckFrequency * 60, SavePlayerStats));
            _timers.Add(timer.Every(_config.UpdateCheckFrequency * 60, GetTransactionLog));
            _timers.Add(timer.Every(_config.UpdateCheckFrequency * 60, SyncAllConnectedPlayersRoles));
            
            if (_config.BanSystemEnabled)
            {
                _timers.Add(timer.Every(2f, ProcessPendingBanChecks));
                _timers.Add(timer.Every(_config.BanPeriodicCheckMinutes * 60, CheckAllConnectedPlayersBans));
            }
        }
        
        private void TestApiConnection()
        {
            LogIt($"Testing API connection to: {_config.ApiEndpoint}");
            
            webrequest.Enqueue($"{_config.ApiEndpoint}/health", null,
            (code, response) =>
            {
                LogIt($"API connection test - Code: {code}, Response: {response}");
                if (code == 200)
                {
                    LogIt("API connection successful");
                }
                else
                {
                    LogIt($"API connection failed - HTTP {code}");
                }
            }, this, RequestMethod.GET, GetHeaders());
        }
        
        private void TriggerWipe(string wipeName = null)
        {
            if (_config == null)
            {
                LogIt("TriggerWipe: _config is null, cannot trigger wipe");
                return;
            }
            
            if (string.IsNullOrWhiteSpace(_config.ApiEndpoint))
            {
                LogIt("TriggerWipe: ApiEndpoint is null or empty, cannot trigger wipe");
                return;
            }
            
            if (string.IsNullOrWhiteSpace(_config.ServerId))
            {
                LogIt("TriggerWipe: ServerId is null or empty, cannot trigger wipe");
                return;
            }
            
            var defaultWipeName = $"Wipe {DateTime.Now:MM/dd/yyyy}";
            var wipeRequest = new WipeRequest
            {
                ServerId = _config.ServerId,
                Name = wipeName ?? defaultWipeName
            };
            
            try
            {
                var jsonBody = JsonConvert.SerializeObject(wipeRequest, Formatting.None,
                    new JsonSerializerSettings { DefaultValueHandling = DefaultValueHandling.Ignore });
                
                LogIt($"Triggering wipe: {jsonBody}");
                
                webrequest.Enqueue($"{_config.ApiEndpoint}/api/wipes", jsonBody,
                (code, response) =>
                {
                    if (code == 200 && !string.IsNullOrEmpty(response))
                    {
                        try
                        {
                            var wipeResponse = JsonConvert.DeserializeObject<WipeResponse>(response);
                            if (wipeResponse != null && wipeResponse.Success)
                            {
                                LogIt($"Wipe triggered successfully: {wipeResponse.Message}");
                                if (wipeResponse.Wipe != null)
                                {
                                    LogIt($"New wipe ID: {wipeResponse.Wipe.Id}, Name: {wipeResponse.Wipe.Name}");
                                }
                            }
                            else
                            {
                                LogIt($"Wipe trigger failed: {response}");
                            }
                        }
                        catch (Exception ex)
                        {
                            LogIt($"Error deserializing wipe response: {ex.Message}");
                        }
                    }
                    else
                    {
                        LogIt($"Wipe trigger API error: {code} - {response}");
                    }
                }, this, RequestMethod.POST, GetHeaders());
            }
            catch (Exception ex)
            {
                LogIt($"Failed to trigger wipe: {ex.Message}");
            }
        }
        
        private void OnServerSave()
        {
            SavePlayerStats();
            SaveData();
        }
        
        void OnNewSave(string filename)
        {
            Puts("Wipe triggered!");
            TriggerWipe();
        }
        
        void OnUserGroupAdded(string id, string groupName)
        {
            if (_inTransactionLog) return;
            SendRoleUpdate(id, groupName, RoleAction.Added);
        }
        
        void OnUserGroupRemoved(string id, string groupName)
        {
            if (_inTransactionLog) return;
            SendRoleUpdate(id, groupName, RoleAction.Revoked);
        }
        
        void OnVehiclePurchased(string prefabToSpawn, BasePlayer newOwner)
        {
            if (string.IsNullOrEmpty(prefabToSpawn) || newOwner == null || !newOwner.UserIDString.IsSteamId()) return;
            if (prefabToSpawn.Contains("boat"))
            GetPlayerStats(newOwner.userID.Get()).BoatsPurchased++;
            else if (prefabToSpawn.Contains("submarine"))
            GetPlayerStats(newOwner.userID.Get()).SubPurchased++;
            else if (prefabToSpawn.Contains("copter"))
            GetPlayerStats(newOwner.userID.Get()).HelisPurchased++;
        }
        
        void OnWeaponFired(BaseProjectile projectile, BasePlayer player, ItemModProjectile mod,
        ProtoBuf.ProjectileShoot projectiles)
        {
            GetPlayerStats(player.userID.Get()).BulletsFired++;
        }
        
        private void Unload()
        {
            foreach (var runningTimer in _timers)
            {
                if (runningTimer.Destroyed) continue;
                runningTimer.Destroy();
            }
            
            SavePlayerStats();
            SaveData();
        }
        #endregion

        #region 6.MagicCore.Commands.cs
        [ChatCommand("link")]
        void CmdChatRefreshLinks(BasePlayer player, string command, string[] args)
        {
            ServerMgr.Instance.StartCoroutine(SyncRoles(player));
        }
        
        [ChatCommand("checkban")]
        void CmdCheckBan(BasePlayer player, string command, string[] args)
        {
            if (!player.IsAdmin)
            {
                player.ChatMessage("You don't have permission to use this command.");
                return;
            }
            
            if (args.Length == 0)
            {
                player.ChatMessage("Usage: /checkban <steamid>");
                return;
            }
            
            if (!args[0].IsSteamId())
            {
                player.ChatMessage("Invalid Steam ID format. Please provide a valid 17-digit Steam ID.");
                return;
            }
            
            ServerMgr.Instance.StartCoroutine(CheckSpecificPlayerBan(args[0], player));
        }
        
        [ChatCommand("bansystem")]
        void CmdBanSystem(BasePlayer player, string command, string[] args)
        {
            if (!player.IsAdmin)
            {
                player.ChatMessage("You don't have permission to use this command.");
                return;
            }
            
            if (args.Length == 0)
            {
                var status = _config.BanSystemEnabled ? "ENABLED" : "DISABLED";
                player.ChatMessage($"Ban system is currently {status}");
                player.ChatMessage("Usage: /bansystem <enable|disable|status>");
                return;
            }
            
            switch (args[0].ToLower())
            {
                case "enable":
                    _config.BanSystemEnabled = true;
                    SaveConfig();
                    player.ChatMessage("Ban system ENABLED");
                    LogIt("Ban system enabled by admin command");
                    break;
                case "disable":
                    _config.BanSystemEnabled = false;
                    SaveConfig();
                    player.ChatMessage("Ban system DISABLED");
                    LogIt("Ban system disabled by admin command");
                    break;
                case "status":
                    var currentStatus = _config.BanSystemEnabled ? "ENABLED" : "DISABLED";
                    player.ChatMessage($"Ban system is currently {currentStatus}");
                    player.ChatMessage($"Ban API: {_config.ApiEndpoint}");
                    player.ChatMessage($"Cache TTL: {_config.BanCheckCacheMinutes} minutes");
                    player.ChatMessage($"Periodic check: Every {_config.BanPeriodicCheckMinutes} minutes");
                    player.ChatMessage($"Batch size: {_config.BanBatchSize} players");
                    break;
                default:
                    player.ChatMessage("Usage: /bansystem <enable|disable|status>");
                    break;
            }
        }
        
        private IEnumerator CheckSpecificPlayerBan(string steamId, BasePlayer adminPlayer)
        {
            if (!_config.BanSystemEnabled)
            {
                adminPlayer.ChatMessage("Ban system is disabled.");
                yield break;
            }
            
            try
            {
                var url = $"{_config.ApiEndpoint}/bans/check-fast?steamId={steamId}";
                
                webrequest.Enqueue(url, null,
                (code, response) =>
                {
                    if (code == 200 && !string.IsNullOrEmpty(response))
                    {
                        try
                        {
                            var banData = JsonConvert.DeserializeObject<BanResponse>(response);
                            var banStatus = banData.Banned ? $"BANNED - {banData.Reason}" : "NOT BANNED";
                            adminPlayer.ChatMessage($"Ban check for {steamId}: {banStatus}");
                            LogIt($"Manual ban check for {steamId}: {banStatus}");
                        }
                        catch (Exception ex)
                        {
                            adminPlayer.ChatMessage($"Error parsing ban response: {ex.Message}");
                            LogIt($"Error parsing ban response for {steamId}: {ex.Message}");
                        }
                    }
                    else
                    {
                        adminPlayer.ChatMessage($"Ban check API error: {code}");
                        LogIt($"Manual ban check API error for {steamId}: {code} - {response}");
                    }
                }, this, RequestMethod.GET, GetHeaders());
            }
            catch (Exception ex)
            {
                adminPlayer.ChatMessage($"Error checking user: {ex.Message}");
                LogIt($"Error in manual user check for {steamId}: {ex.Message}");
            }
            
            yield break;
        }
        #endregion

        #region 7.MagicCore.Classes.cs
        public enum RoleAction
        {
            Added,
            Revoked,
            ROLE_ASSIGNED,
            ROLE_REVOKED
        }
        
        public class Log
        {
            public string Action { get; set; }
            public string DiscordGuildIds { get; set; }
            public string DiscordIds { get; set; }
            public string DiscordRoleIds { get; set; }
            public string OxideGroupNames { get; set; }
            public string ServerIds { get; set; }
            public string SteamId { get; set; }
            public DateTime Timestamp { get; set; }
        }
        
        public class LogData
        {
            public List<Log> Logs { get; set; }
        }
        
        public class SyncRolesResponse
        {
            public List<SyncRoleItem> Roles { get; set; }
        }
        
        public class SyncRoleItem
        {
            public List<string> OxideGroupNames { get; set; }
            public List<string> ServerIds { get; set; }
        }
        
        public class RoleChange
        {
            public string Action { get; set; }
            public string Role { get; set; }
            public string SteamId { get; set; }
        }
        
        public class RoleData
        {
            public List<string> Roles { get; set; }
        }
        
        public class TrackedRole
        {
            public string Id { get; set; }
            public string Name { get; set; }
            public List<string> DiscordRoleIds { get; set; }
            public List<string> DiscordGuildIds { get; set; }
            public List<string> ServerIds { get; set; }
            public List<string> OxideGroupNames { get; set; }
            public bool AssignOnVerification { get; set; }
        }
        
        public class RoleUpdate
        {
            public List<RoleChange> Roles { get; set; }
        }
        
        public class BanInfo
        {
            public bool Banned { get; set; }
            public string Type { get; set; }
            public string Reason { get; set; }
            public DateTime? Expires { get; set; }
            public DateTime CachedAt { get; set; }
            public string SteamId { get; set; }
            public bool Cached { get; set; }
        }
        
        public class BanResponse
        {
            public bool Banned { get; set; }
            public string Type { get; set; }
            public string Reason { get; set; }
            public string Expires { get; set; }
            public string BannedAt { get; set; }
            public string SteamId { get; set; }
            public bool Cached { get; set; }
        }
        
        public class BanBatchResponse
        {
            public Dictionary<string, BanResponse> Results { get; set; }
            public int Checked { get; set; }
            public string Timestamp { get; set; }
        }
        
        public class WipeRequest
        {
            [JsonProperty(PropertyName = "serverId")]
            public string ServerId { get; set; }
            
            [JsonProperty(PropertyName = "name")]
            public string Name { get; set; }
        }
        
        public class WipeResponse
        {
            [JsonProperty(PropertyName = "success")]
            public bool Success { get; set; }
            
            [JsonProperty(PropertyName = "wipe")]
            public WipeData Wipe { get; set; }
            
            [JsonProperty(PropertyName = "message")]
            public string Message { get; set; }
        }
        
        public class WipeData
        {
            [JsonProperty(PropertyName = "id")]
            public int Id { get; set; }
            
            [JsonProperty(PropertyName = "server_id")]
            public string ServerId { get; set; }
            
            [JsonProperty(PropertyName = "name")]
            public string Name { get; set; }
            
            [JsonProperty(PropertyName = "started_at")]
            public string StartedAt { get; set; }
            
            [JsonProperty(PropertyName = "is_active")]
            public bool IsActive { get; set; }
        }
        #endregion

        #region 9.MagicCore.Linking.cs
        private bool _inTransactionLog;
        private List<string> _trackedRoles = new();
        
        private void GetTrackedRoles()
        {
            var isGlobal = string.IsNullOrWhiteSpace(_config.ServerId) || _config.ServerId.Equals("global", StringComparison.OrdinalIgnoreCase);
            var url = isGlobal 
                ? $"{_config.ApiEndpoint}/admin/roles" 
                : $"{_config.ApiEndpoint}/admin/roles?serverId={_config.ServerId}";
            LogIt($"GetTrackedRoles requesting URL: {url}");
            
            webrequest.Enqueue(url, null,
            (code, response) =>
            {
                LogIt($"GetTrackedRoles received - Code: {code}, Response length: {response?.Length ?? 0}");
                
                if (code != 200 || response == null)
                {
                    LogIt($"Get Tracked Roles failed - Code: {code}, Response: {response}");
                    _trackedRoles = new List<string> { "default" };
                    return;
                }
                
                var responsePreview = response.Length > 200 ? response.Substring(0, 200) + "..." : response;
                LogIt($"GetTrackedRoles response preview: {responsePreview}");
                
                if (string.IsNullOrWhiteSpace(response))
                {
                    LogIt("GetTrackedRoles received empty response");
                    _trackedRoles = new List<string> { "default" };
                    return;
                }
                
                if (response.TrimStart().StartsWith("<") || response.Contains("<html") || response.Contains("<!DOCTYPE"))
                {
                    LogIt($"GetTrackedRoles received HTML response (likely error page): {responsePreview}");
                    _trackedRoles = new List<string> { "default" };
                    return;
                }
                
                try
                {
                    var roles = JsonConvert.DeserializeObject<List<TrackedRole>>(response);
                    _trackedRoles = new List<string>();
                    
                    if (roles != null)
                    {
                        foreach (var role in roles)
                        {
                            if (role.OxideGroupNames != null && role.OxideGroupNames.Count > 0)
                            {
                                foreach (var groupName in role.OxideGroupNames)
                                {
                                    if (!string.IsNullOrWhiteSpace(groupName) && !_trackedRoles.Contains(groupName))
                                    {
                                        _trackedRoles.Add(groupName);
                                    }
                                }
                            }
                            else if (!string.IsNullOrWhiteSpace(role.Name) && !_trackedRoles.Contains(role.Name))
                            {
                                _trackedRoles.Add(role.Name);
                            }
                        }
                    }
                }
                catch (JsonSerializationException ex1)
                {
                    try
                    {
                        var roleData = JsonConvert.DeserializeObject<RoleData>(response);
                        _trackedRoles = roleData?.Roles ?? new List<string>();
                    }
                    catch (JsonReaderException ex2)
                    {
                        try
                        {
                            _trackedRoles = JsonConvert.DeserializeObject<List<string>>(response) ?? new List<string>();
                        }
                        catch (Exception ex3)
                        {
                            LogIt($"Failed to deserialize roles response. Response preview: '{responsePreview}'. Error1: {ex1.Message}. Error2: {ex2.Message}. Error3: {ex3.Message}");
                            _trackedRoles = new List<string>();
                        }
                    }
                }
                catch (JsonReaderException ex)
                {
                    LogIt($"Failed to deserialize roles response. Response preview: '{responsePreview}'. Error: {ex.Message}");
                    _trackedRoles = new List<string>();
                }
                catch (Exception ex)
                {
                    LogIt($"Unexpected error deserializing roles response. Response preview: '{responsePreview}'. Error: {ex.Message}");
                    _trackedRoles = new List<string>();
                }
                
                _trackedRoles.Add("default");
                LogIt($"The following Roles will be synced [{string.Join(",",_trackedRoles)}]");
            }, this, RequestMethod.GET, GetHeaders());
        }
        
        private void GetTransactionLog()
        {
            _inTransactionLog = true;
            if (_storedData.LastLogTime == DateTime.MinValue)
            _storedData.LastLogTime = DateTime.Now.AddDays(-1).ToUniversalTime();
            
            _storedData.LastLogTime = _storedData.LastLogTime.AddSeconds(0.1);
            webrequest.Enqueue(
            $"{_config.ApiEndpoint}/admin/logs?minimize=true&startDate={_storedData.LastLogTime:yyyy-MM-ddTHH:mm:ss.fffZ}&serverId={_config.ServerId}",
            null,
            (code, response) =>
            {
                if (code != 200 || response == null)
                {
                    LogIt("Get Transaction Log Request failed");
                    return;
                }
                
                var logs = JsonConvert.DeserializeObject<LogData>(response).Logs;
                foreach (var log in logs.OrderBy(x => x.Timestamp))
                {
                    if (string.IsNullOrEmpty(log.SteamId) || BasePlayer.Find(log.SteamId) == null) continue;
                    
                    if (!string.IsNullOrEmpty(log.ServerIds) && !log.ServerIds.Contains(_config.ServerId))
                        continue;
                    
                    if (log.Action.ToUpper() == RoleAction.ROLE_ASSIGNED.ToString().ToUpper())
                    {
                        if (!string.IsNullOrEmpty(log.OxideGroupNames))
                        {
                            var groupNames = log.OxideGroupNames.Split(',', StringSplitOptions.RemoveEmptyEntries);
                            foreach (var groupName in groupNames)
                            {
                                var trimmedGroupName = groupName.Trim();
                                permission.AddUserGroup(log.SteamId, trimmedGroupName);
                                LogIt($"Added {log.SteamId} to {trimmedGroupName} (Discord: {log.DiscordRoleIds}, Guild: {log.DiscordGuildIds})");
                            }
                        }
                    }
                    
                    if (log.Action.ToUpper() == RoleAction.ROLE_REVOKED.ToString().ToUpper())
                    {
                        if (!string.IsNullOrEmpty(log.OxideGroupNames))
                        {
                            var groupNames = log.OxideGroupNames.Split(',', StringSplitOptions.RemoveEmptyEntries);
                            foreach (var groupName in groupNames)
                            {
                                var trimmedGroupName = groupName.Trim();
                                permission.RemoveUserGroup(log.SteamId, trimmedGroupName);
                                LogIt($"Removed {log.SteamId} from {trimmedGroupName} (Discord: {log.DiscordRoleIds}, Guild: {log.DiscordGuildIds})");
                            }
                        }
                    }
                    
                    _storedData.LastLogTime = log.Timestamp;
                }
                
                _inTransactionLog = false;
            }, this, RequestMethod.GET, GetHeaders());
        }
        
        private void SendRoleUpdate(string id, string groupName, RoleAction action)
        {
            if (_inTransactionLog) return;
            
            var isGlobal = string.IsNullOrWhiteSpace(_config.ServerId) || _config.ServerId.Equals("global", StringComparison.OrdinalIgnoreCase);
            var serverId = isGlobal ? string.Empty : _config.ServerId;
            var url = isGlobal 
                ? $"{_config.ApiEndpoint}/user?type=oxide" 
                : $"{_config.ApiEndpoint}/user?type=oxide&serverId={_config.ServerId}";
            
            var logEntry = new Log
            {
                Action = action.ToString().ToLower(),
                SteamId = id,
                OxideGroupNames = groupName,
                ServerIds = serverId,
                DiscordGuildIds = "",
                DiscordIds = "",
                DiscordRoleIds = "",
                Timestamp = DateTime.UtcNow
            };
            
            var logData = new LogData
            {
                Logs = new List<Log> { logEntry }
            };
            
            webrequest.Enqueue(url,
            JsonConvert.SerializeObject(logData, Formatting.None,
            new JsonSerializerSettings
            {
                DefaultValueHandling = DefaultValueHandling.Ignore,
                ContractResolver = new CamelCasePropertyNamesContractResolver()
            }),
            (code, response) =>
            {
                if (code != 200 || response == null)
                {
                    LogIt($"Send Role Update Request failed - {groupName} was {action} for [{id}]");
                    return;
                }
                
                LogIt($"Send Role Updated - {groupName} was {action} for [{id}] || {response}");
            }, this, RequestMethod.POST, GetHeaders());
        }
        
        private IEnumerator SyncRoles(BasePlayer player)
        {
            var encodedPlayerId = Uri.EscapeDataString(player.UserIDString);
            var isGlobal = string.IsNullOrWhiteSpace(_config.ServerId) || _config.ServerId.Equals("global", StringComparison.OrdinalIgnoreCase);
            var url = isGlobal 
                ? $"{_config.ApiEndpoint}/user?type=oxide&playerId={encodedPlayerId}" 
                : $"{_config.ApiEndpoint}/user?type=oxide&playerId={encodedPlayerId}&serverIds={_config.ServerId}";
            webrequest.Enqueue(url,
            null,
            (code, response) =>
            {
                if (code != 200 || response == null)
                {
                    LogIt($"Sync Roles Request failed - Code: {code}, Response: {response}");
                    return;
                }
                
                LogIt($"SyncRoles raw response: {response}");
                
                if (string.IsNullOrWhiteSpace(response))
                {
                    LogIt("SyncRoles received empty response");
                    var defaultRoles = new List<string> { "default" };
                    _inTransactionLog = true;
                    ServerMgr.Instance.StartCoroutine(ProcessRoles(player, defaultRoles));
                    return;
                }
                
                List<string> roles = new List<string>();
                var isGlobal = string.IsNullOrWhiteSpace(_config.ServerId) || _config.ServerId.Equals("global", StringComparison.OrdinalIgnoreCase);
                try
                {
                    var syncRolesResponse = JsonConvert.DeserializeObject<SyncRolesResponse>(response);
                    if (syncRolesResponse?.Roles != null)
                    {
                        foreach (var roleItem in syncRolesResponse.Roles)
                        {
                            var appliesToServer = isGlobal;
                            if (!appliesToServer && roleItem.ServerIds != null)
                            {
                                appliesToServer = roleItem.ServerIds.Contains(_config.ServerId) || 
                                                  roleItem.ServerIds.Contains("global", StringComparer.OrdinalIgnoreCase);
                            }
                            
                            if (appliesToServer && roleItem.OxideGroupNames != null)
                            {
                                foreach (var groupName in roleItem.OxideGroupNames)
                                {
                                    if (!string.IsNullOrWhiteSpace(groupName) && !roles.Contains(groupName))
                                    {
                                        roles.Add(groupName);
                                    }
                                }
                            }
                        }
                    }
                    else
                    {
                        var logData = JsonConvert.DeserializeObject<LogData>(response);
                        if (logData?.Logs != null)
                        {
                            foreach (var log in logData.Logs)
                            {
                                if (!string.IsNullOrEmpty(log.OxideGroupNames))
                                {
                                    var groupNames = log.OxideGroupNames.Split(',', StringSplitOptions.RemoveEmptyEntries);
                                    foreach (var groupName in groupNames)
                                    {
                                        var trimmedGroupName = groupName.Trim();
                                        if (!roles.Contains(trimmedGroupName))
                                            roles.Add(trimmedGroupName);
                                    }
                                }
                            }
                        }
                        else
                        {
                            var roleData = JsonConvert.DeserializeObject<RoleData>(response);
                            if (roleData?.Roles != null)
                                roles = roleData.Roles;
                        }
                    }
                }
                catch (JsonSerializationException ex1)
                {
                    try
                    {
                        roles = JsonConvert.DeserializeObject<List<string>>(response) ?? new List<string>();
                    }
                    catch (JsonReaderException ex2)
                    {
                        LogIt($"Failed to deserialize sync roles response. Response: '{response}'. Error1: {ex1.Message}. Error2: {ex2.Message}");
                        roles = new List<string>();
                    }
                }
                catch (JsonReaderException ex)
                {
                    LogIt($"Failed to deserialize sync roles response. Response: '{response}'. Error: {ex.Message}");
                    roles = new List<string>();
                }
                
                roles.Add("default");
                _inTransactionLog = true;
                ServerMgr.Instance.StartCoroutine(ProcessRoles(player, roles));
            }, this, RequestMethod.GET, GetHeaders());
            yield break;
        }
        
        private IEnumerator ProcessRoles(BasePlayer player, List<string> roles)
        {
            var rolesAdded = new List<string>();
            var rolesRemoved = new List<string>();
            
            foreach (var role in roles)
            {
                if (!permission.GroupExists(role))
                {
                    permission.CreateGroup(role, role, 0);
                }
                
                if (permission.UserHasGroup(player.UserIDString, role)) continue;
                
                permission.AddUserGroup(player.UserIDString, role);
                rolesAdded.Add(role);
                var safeDisplayName = player.displayName?.Replace("\"", "'").Replace("\\", "/") ?? "Unknown";
                LogIt($"Added {safeDisplayName} [{player.UserIDString}] to {role}");
                yield return null;
            }
            
            var currentGroups = permission.GetUserGroups(player.UserIDString);
            foreach (var permissionGroup in currentGroups)
            {
                if (roles.Contains(permissionGroup) || !_trackedRoles.Contains(permissionGroup)) continue;
                permission.RemoveUserGroup(player.UserIDString, permissionGroup);
                rolesRemoved.Add(permissionGroup);
                var safeDisplayName = player.displayName?.Replace("\"", "'").Replace("\\", "/") ?? "Unknown";
                LogIt($"Removed {safeDisplayName} [{player.UserIDString}] from {permissionGroup}");
                yield return null;
            }
            
            for (var i = 0; i < rolesAdded.Count; i++)
            {
                if(_config.RoleCommonNames.ContainsKey(rolesAdded[i]))
                {
                    rolesAdded[i] = _config.RoleCommonNames[rolesAdded[i]];
                }
            }
            for (var i = 0; i < rolesRemoved.Count; i++)
            {
                if (_config.RoleCommonNames.ContainsKey(rolesRemoved[i]))
                {
                    rolesRemoved[i] = _config.RoleCommonNames[rolesRemoved[i]];
                }
            }
            _inTransactionLog = false;
            
            if(rolesAdded.Count == 0 && rolesRemoved.Count == 0)
            {
                yield break;
            }
            
            var msg = "";
            if(rolesAdded.Count > 0)
            {
                foreach(var role in rolesAdded)
                {
                    if(!string.IsNullOrEmpty(msg)) msg += "\n";
                    msg += $"RoleAdded: {role}";
                }
            }
            if(rolesRemoved.Count > 0)
            {
                foreach(var role in rolesRemoved)
                {
                    if(!string.IsNullOrEmpty(msg)) msg += "\n";
                    msg += $"RoleRemoved: {role}";
                }
            }
            player.ChatMessage(msg);
        }
        
        private void SendRoleUpdateWithDiscordInfo(string id, string groupName, RoleAction action, string discordGuildIds = "", string discordIds = "", string discordRoleIds = "")
        {
            if (_inTransactionLog) return;
            
            var isGlobal = string.IsNullOrWhiteSpace(_config.ServerId) || _config.ServerId.Equals("global", StringComparison.OrdinalIgnoreCase);
            var serverId = isGlobal ? string.Empty : _config.ServerId;
            var url = isGlobal 
                ? $"{_config.ApiEndpoint}/user?type=oxide" 
                : $"{_config.ApiEndpoint}/user?type=oxide&serverId={_config.ServerId}";
            
            var logEntry = new Log
            {
                Action = action.ToString().ToLower(),
                SteamId = id,
                OxideGroupNames = groupName,
                ServerIds = serverId,
                DiscordGuildIds = discordGuildIds,
                DiscordIds = discordIds,
                DiscordRoleIds = discordRoleIds,
                Timestamp = DateTime.UtcNow
            };
            
            var logData = new LogData
            {
                Logs = new List<Log> { logEntry }
            };
            
            webrequest.Enqueue(url,
            JsonConvert.SerializeObject(logData, Formatting.None,
            new JsonSerializerSettings
            {
                DefaultValueHandling = DefaultValueHandling.Ignore,
                ContractResolver = new CamelCasePropertyNamesContractResolver()
            }),
            (code, response) =>
            {
                if (code != 200 || response == null)
                {
                    LogIt($"Send Role Update with Discord Info Request failed - {groupName} was {action} for [{id}]");
                    return;
                }
                
                LogIt($"Send Role Updated with Discord Info - {groupName} was {action} for [{id}] || {response}");
            }, this, RequestMethod.POST, GetHeaders());
        }
        #endregion

        #region 9.MagicCore.Stats.cs
        private readonly Dictionary<ulong, PlayerStat> _playerStats = new Dictionary<ulong, PlayerStat>();
        
        private void ResetPlayerStats(DateTime loginTime)
        {
            _playerStats.Clear();
            foreach (var player in BasePlayer.activePlayerList)
            {
                GetPlayerStats(player.userID.Get());
            }
        }
        
        private void SavePlayerStats()
        {
            SendPlayerStats(_playerStats.Values.ToList());
        }
        
        private IEnumerator SendPlayerInfo(BasePlayer player)
        {
            var sanitizedUsername = player.displayName ?? "";
            sanitizedUsername = sanitizedUsername.Replace("\"", "'")
                                               .Replace("\\", "/")
                                               .Replace("\n", " ")
                                               .Replace("\r", " ")
                                               .Replace("\t", " ");
            
            var info = new PlayerInfo
            {
                SteamId = player.userID.Get().ToString(),
                UserName = sanitizedUsername
            };
            
            try
            {
                var jsonBody = JsonConvert.SerializeObject(info, Formatting.None,
                new JsonSerializerSettings {DefaultValueHandling = DefaultValueHandling.Ignore});
                
                LogIt($"Sending player info: {jsonBody}");
                
                webrequest.Enqueue($"{_config.ApiEndpoint}/players", jsonBody,
                (code, response) =>
                {
                    if (code != 200 || response == null)
                    {
                        LogIt($"Player Info Request failed - Code: {code}, Response: {response}");
                        return;
                    }
                    LogIt("Player Info Sent");
                }, this, RequestMethod.POST, GetHeaders());
            }
            catch (Exception ex)
            {
                LogIt($"Failed to serialize player info for {player.displayName}: {ex.Message}");
            }
            
            yield break;
        }
        
        private void SendPlayerStats(List<PlayerStat> stats)
        {
            if (stats == null || stats.Count == 0)
            {
                LogIt("SendPlayerStats: No stats to send");
                return;
            }
            
            if (_config == null)
            {
                LogIt("SendPlayerStats: _config is null, cannot send stats");
                return;
            }
            
            if (string.IsNullOrWhiteSpace(_config.ApiEndpoint))
            {
                LogIt("SendPlayerStats: ApiEndpoint is null or empty, cannot send stats");
                return;
            }
            
            var loginTime = DateTime.Now;
            try
            {
                var body = JsonConvert.SerializeObject(stats, Formatting.None,
                new JsonSerializerSettings {DefaultValueHandling = DefaultValueHandling.Ignore});
                LogIt(body);
                webrequest.Enqueue($"{_config.ApiEndpoint}/stats", body,
                (code, response) =>
                {
                    if (code != 200 || response == null)
                    {
                        LogIt($"Request failed {code} || {response}");
                        return;
                    }
                    LogIt("Stats Sent");
                    ResetPlayerStats(loginTime);
                }, this, RequestMethod.POST, GetHeaders());
            }
            catch (Exception ex)
            {
                LogIt($"Failed to serialize or send player stats: {ex.Message}");
            }
        }
        
        private void SendSinglePlayerStats(List<PlayerStat> stats)
        {
            if (stats == null || stats.Count == 0)
            {
                LogIt("SendSinglePlayerStats: No stats to send");
                return;
            }
            
            if (_config == null)
            {
                LogIt("SendSinglePlayerStats: _config is null, cannot send stats");
                return;
            }
            
            if (string.IsNullOrWhiteSpace(_config.ApiEndpoint))
            {
                LogIt("SendSinglePlayerStats: ApiEndpoint is null or empty, cannot send stats");
                return;
            }
            
            try
            {
                var body = JsonConvert.SerializeObject(stats, Formatting.None,
                new JsonSerializerSettings { DefaultValueHandling = DefaultValueHandling.Ignore });
                LogIt(body);
                webrequest.Enqueue($"{_config.ApiEndpoint}/stats", body,
                (code, response) =>
                {
                    if (code != 200 || response == null)
                    {
                        LogIt($"Request failed {code} || {response}");
                        return;
                    }
                    LogIt("Single Player Stats Sent");
                }, this, RequestMethod.POST, GetHeaders());
            }
            catch (Exception ex)
            {
                LogIt($"Failed to serialize or send single player stats: {ex.Message}");
            }
        }
        
        public class PlayerInfo
        {
            [JsonProperty(PropertyName = "avatar")]
            public string Avatar { get; set; }
            
            [JsonProperty(PropertyName = "steamId")]
            public string SteamId { get; set; }
            
            [JsonProperty(PropertyName = "username")]
            public string UserName { get; set; }
        }
        
        public class PlayerStat
        {
            [JsonProperty(PropertyName = "f5")] public int AnimalKills { get; set; }
            
            [JsonProperty(PropertyName = "d5")] public int BerriesHarvested { get; set; }
            
            [JsonProperty(PropertyName = "f2")] public int BoatsPurchased { get; set; }
            
            [JsonProperty(PropertyName = "e3")] public int BradleyKills { get; set; }
            
            [JsonProperty(PropertyName = "a4")] public int BulletsFired { get; set; }
            
            [JsonProperty(PropertyName = "d7")] public int ClothCollected { get; set; }
            
            [JsonProperty(PropertyName = "d1")] public int CornHarvested { get; set; }
            
            [JsonProperty(PropertyName = "a2")] public int Deaths { get; set; }
            
            [JsonProperty(PropertyName = "d6")] public int FishGutted { get; set; }
            
            [JsonProperty(PropertyName = "e1")] public int HackedCratesLooted { get; set; }
            
            [JsonProperty(PropertyName = "a5")] public int HeadShots { get; set; }
            
            [JsonProperty(PropertyName = "b7")] public int HeGrenadeFired { get; set; }
            
            [JsonProperty(PropertyName = "e2")] public int HeliKills { get; set; }
            
            [JsonProperty(PropertyName = "f4")] public int HelisPurchased { get; set; }
            
            [JsonProperty(PropertyName = "c4")] public int HqmFarmed { get; set; }
            
            [JsonProperty(PropertyName = "b3")] public int HvRocketsFired { get; set; }
            
            [JsonProperty(PropertyName = "b4")] public int IncendiaryRocketsFired { get; set; }
            
            [JsonProperty(PropertyName = "a1")] public int Kills { get; set; }
            
            [JsonProperty(PropertyName = "d8")] public int LeatherCollected { get; set; }
            
            [JsonIgnore] public DateTime LoginTime { get; set; }
            
            [JsonIgnore] public DateTime? LogoffTime { get; set; }
            
            [JsonProperty(PropertyName = "c3")] public int MetalFarmed { get; set; }
            
            [JsonProperty(PropertyName = "e5")] public int MissionsCompleted { get; set; }
            
            [JsonProperty(PropertyName = "e4")] public int MissionsStarted { get; set; }
            
            [JsonProperty(PropertyName = "d4")] public int MushroomsHarvested { get; set; }
            
            [JsonProperty(PropertyName = "e6")] public int NpcKills { get; set; }
            
            [JsonProperty(PropertyName = "f1")]
            public int PlayTimeSeconds => (int) ((LogoffTime ?? DateTime.Now) - LoginTime).TotalSeconds + 1;
            
            [JsonProperty(PropertyName = "d2")] public int PotatoesHarvested { get; set; }
            
            [JsonProperty(PropertyName = "d3")] public int PumpkinsHarvested { get; set; }
            
            [JsonProperty(PropertyName = "b2")] public int RocketsFired { get; set; }
            
            [JsonProperty(PropertyName = "b6")] public int SatchelChargesThrown { get; set; }
            
            [JsonProperty(PropertyName = "serverId")]
            public string ServerId { get; set; }
            
            [JsonProperty(PropertyName = "b5")] public int SmokeRocketsFired { get; set; }
            
            [JsonIgnore] public ulong SteamId { get; set; }
            
            [JsonProperty(PropertyName = "steamId")]
            public string SteamIdString => SteamId.ToString();
            
            [JsonProperty(PropertyName = "c2")] public int StoneFarmed { get; set; }
            
            [JsonProperty(PropertyName = "f3")] public int SubPurchased { get; set; }
            
            [JsonProperty(PropertyName = "a3")] public int Suicides { get; set; }
            
            [JsonProperty(PropertyName = "c5")] public int SulfurFarmed { get; set; }
            
            [JsonProperty(PropertyName = "f6")] public int SupplySignalThrown { get; set; }
            
            [JsonProperty(PropertyName = "b1")] public int TimedExplosivesThrown { get; set; }
            
            [JsonProperty(PropertyName = "c1")] public int WoodFarmed { get; set; }
        }
        #endregion

        #region 9.MagicCore.Harmony.cs
        [AutoPatch]
        [HarmonyPatch(typeof(VehicleSpawner), "SpawnVehicle")]
        public static class VehicleSpawnerPatch
        {
            static bool Prefix(string prefabToSpawn, BasePlayer newOwner)
            {
                Interface.CallHook("OnVehiclePurchased", prefabToSpawn, newOwner);
                return true;
                
            }
        }
        #endregion

    }

}
