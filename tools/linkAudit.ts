import type { Client } from "discordx";
import type { Guild } from "discord.js";
import config from "../config.json";
import { CONSTANTS } from "./constants.ts";

type Presence = "present" | "absent" | "unknown";

interface AuditResponse {
    unlinkedLeft?: string[];
    unlinkedRevoked?: string[];
    skippedMembership?: number;
    skippedAuthorization?: number;
    misconfigured?: boolean;
}

const ABSENT_BATCH = 25;
const AUTHORIZE_BATCH = 15;
const LEAVE_DEBOUNCE_MS = 30_000;

let auditInProgress = false;
let loggedAuditEndpointProblem = false;
const recentLeaveReports = new Map<string, number>();

function stamp(): string {
    return new Date().toISOString();
}

export function linkedMemberCheckIntervalMs(): number | null {
    const raw = (config as { "LINKED_MEMBER_CHECK_FREQUENCY (MINUTES)"?: number | string })["LINKED_MEMBER_CHECK_FREQUENCY (MINUTES)"];
    const minutes = raw === undefined || raw === null || raw === "" ? 15 : Number(raw);
    if (!Number.isFinite(minutes) || minutes <= 0) {
        return null;
    }
    return minutes * 60_000;
}

function configuredGuildIds(): string[] {
    return (config.GUILD_IDS ?? [])
        .map((id) => String(id).trim())
        .filter((id) => id.length > 0);
}

function discordErrorCode(error: unknown): number | null {
    if (!error || typeof error !== "object") {
        return null;
    }
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number") {
        return code;
    }
    const raw = (error as { rawError?: { code?: unknown } }).rawError?.code;
    return typeof raw === "number" ? raw : null;
}

function chunk<T>(items: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        batches.push(items.slice(index, index + size));
    }
    return batches;
}

function listIsComplete(fetched: number, expected: number): boolean {
    if (expected <= 0) {
        return false;
    }
    const missing = expected - fetched;
    return missing <= Math.max(2, Math.floor(expected * 0.02));
}

function claimLeaveReport(discordId: string): boolean {
    const now = Date.now();
    const previous = recentLeaveReports.get(discordId);
    if (previous && now - previous < LEAVE_DEBOUNCE_MS) {
        return false;
    }
    recentLeaveReports.set(discordId, now);
    if (recentLeaveReports.size > 5000) {
        for (const [id, time] of recentLeaveReports) {
            if (now - time > LEAVE_DEBOUNCE_MS) {
                recentLeaveReports.delete(id);
            }
        }
    }
    return true;
}

async function presenceInGuild(guild: Guild, discordId: string): Promise<Presence> {
    if (guild.members.cache.has(discordId)) {
        return "present";
    }

    try {
        await guild.members.fetch(discordId);
        return "present";
    } catch (error) {
        const code = discordErrorCode(error);
        const status = error && typeof error === "object" && "status" in error ? (error as { status?: unknown }).status : undefined;
        if (code === 10007 || code === 10013 || status === 404) {
            return "absent";
        }
        console.warn(`[${stamp()}] Could not check ${discordId} in ${guild.name}:`, error);
        return "unknown";
    }
}

async function fetchLinkedDiscordIds(): Promise<string[] | null> {
    try {
        const response = await fetch(config.API_ENDPOINT + CONSTANTS.FETCH_LINKED_USERS, {
            method: "GET",
            headers: new Headers({ "x-api-key": config.API_KEY }),
        });
        if (!response.ok) {
            console.error(`[${stamp()}] Could not load linked users: ${response.status} ${response.statusText}`);
            return null;
        }

        const json = await response.json();
        const users = Array.isArray(json) ? json : Array.isArray(json?.users) ? json.users : null;
        if (!users) {
            console.error(`[${stamp()}] Linked users response was not a list`);
            return null;
        }

        const ids = new Set<string>();
        for (const user of users) {
            if (typeof user?.discordId === "string" && /^\d{15,22}$/.test(user.discordId)) {
                ids.add(user.discordId);
            }
            if (!Array.isArray(user?.accounts)) {
                continue;
            }
            for (const account of user.accounts) {
                if (account?.provider === "discord" && typeof account.providerAccountId === "string" && /^\d{15,22}$/.test(account.providerAccountId)) {
                    ids.add(account.providerAccountId);
                }
            }
        }
        if (ids.size === 0 && users.length > 0) {
            console.error(`[${stamp()}] Linked users response had ${users.length} record(s) but no Discord ids`);
            return null;
        }
        return [...ids];
    } catch (error) {
        console.error(`[${stamp()}] Could not load linked users:`, error);
        return null;
    }
}

async function postLinkAudit(body: { absentDiscordIds: string[]; authorizeDiscordIds: string[] }): Promise<AuditResponse | null> {
    try {
        const response = await fetch(config.API_ENDPOINT + CONSTANTS.AUDIT_LINKS, {
            method: "POST",
            headers: new Headers({
                "x-api-key": config.API_KEY,
                "Content-Type": "application/json",
            }),
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(90_000),
        });

        if (response.status === 404 || response.status === 401 || response.status === 403) {
            if (!loggedAuditEndpointProblem) {
                loggedAuditEndpointProblem = true;
                if (response.status === 404) {
                    console.error(`[${stamp()}] Link audit endpoint was not found. Deploy the website update that adds /api/discord/audit-links.`);
                } else {
                    console.error(`[${stamp()}] Link audit was denied (${response.status}). The API key needs Discord Sync Roles or Users manage.`);
                }
            }
            return null;
        }
        if (!response.ok) {
            const text = await response.text();
            console.error(`[${stamp()}] Link audit failed: ${response.status} ${text.slice(0, 300)}`);
            return null;
        }
        return await response.json() as AuditResponse;
    } catch (error) {
        console.error(`[${stamp()}] Link audit request failed:`, error);
        return null;
    }
}

async function collectMemberIds(client: Client, guildIds: string[]): Promise<Set<string> | null> {
    const ids = new Set<string>();
    for (const guildId of guildIds) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            console.error(`[${stamp()}] Guild ${guildId} is not available, so this leave check was skipped`);
            return null;
        }

        try {
            const fetched = await guild.members.fetch();
            if (!fetched || typeof (fetched as { size?: unknown }).size !== "number") {
                console.error(`[${stamp()}] Could not list members of ${guild.name}`);
                return null;
            }
            const fetchedMembers = fetched as { size: number; keys(): Iterable<string> };
            if (!listIsComplete(fetchedMembers.size, guild.memberCount)) {
                console.error(`[${stamp()}] Member list for ${guild.name} is incomplete (${fetchedMembers.size} of ${guild.memberCount}). Enable the Server Members intent. This leave check was skipped.`);
                return null;
            }
            for (const memberId of fetchedMembers.keys()) {
                ids.add(memberId);
            }
        } catch (error) {
            console.error(`[${stamp()}] Could not list members of ${guild.name}:`, error);
            return null;
        }
    }
    return ids;
}

async function confirmedAbsent(client: Client, guildIds: string[], discordId: string): Promise<boolean | null> {
    for (const guildId of guildIds) {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            return null;
        }
        const presence = await presenceInGuild(guild, discordId);
        if (presence === "present") {
            return false;
        }
        if (presence === "unknown") {
            return null;
        }
    }
    return true;
}

export async function reportMemberLeft(client: Client, discordId: string, leftGuildId: string): Promise<void> {
    const guildIds = configuredGuildIds();
    if (!guildIds.includes(leftGuildId)) {
        return;
    }
    if (client.user?.id === discordId) {
        return;
    }

    for (const guildId of guildIds) {
        if (guildId === leftGuildId) {
            continue;
        }
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            console.warn(`[${stamp()}] Left ${discordId} linked for now; guild ${guildId} is not available`);
            return;
        }
        const presence = await presenceInGuild(guild, discordId);
        if (presence !== "absent") {
            return;
        }
    }

    if (!claimLeaveReport(discordId)) {
        return;
    }

    const result = await postLinkAudit({ absentDiscordIds: [discordId], authorizeDiscordIds: [] });
    if (!result) {
        return;
    }
    if (result.unlinkedLeft?.includes(discordId)) {
        console.log(`[${stamp()}] Unlinked ${discordId} after they left Discord`);
    } else if ((result.skippedMembership ?? 0) > 0) {
        console.warn(`[${stamp()}] Could not confirm ${discordId} left. Check DISCORD_BOT_TOKEN and the Discord guild id in the site settings.`);
    }
}

export async function auditLinkedMembers(client: Client): Promise<void> {
    if (auditInProgress) {
        console.log(`[${stamp()}] Linked member check skipped because the previous run is still going`);
        return;
    }

    auditInProgress = true;
    try {
        const guildIds = configuredGuildIds();
        if (guildIds.length === 0) {
            console.warn(`[${stamp()}] No GUILD_IDS configured, so the linked member check was skipped`);
            return;
        }

        const linkedIds = await fetchLinkedDiscordIds();
        if (!linkedIds) {
            return;
        }
        if (linkedIds.length === 0) {
            console.log(`[${stamp()}] Linked member check found no linked Discord users`);
            return;
        }

        console.log(`[${stamp()}] Checking ${linkedIds.length} linked Discord user(s)`);
        const memberIds = await collectMemberIds(client, guildIds);
        const absent: string[] = [];
        const authorize: string[] = [];

        for (const discordId of linkedIds) {
            if (!memberIds || memberIds.has(discordId)) {
                authorize.push(discordId);
                continue;
            }

            const left = await confirmedAbsent(client, guildIds, discordId);
            if (left === true) {
                absent.push(discordId);
            } else {
                authorize.push(discordId);
            }
        }

        let leftCount = 0;
        let revokedCount = 0;
        let skippedMembership = 0;
        let skippedAuthorization = 0;

        for (const batch of chunk(absent, ABSENT_BATCH)) {
            const result = await postLinkAudit({ absentDiscordIds: batch, authorizeDiscordIds: [] });
            if (!result) {
                return;
            }
            leftCount += result.unlinkedLeft?.length ?? 0;
            skippedMembership += result.skippedMembership ?? 0;
            for (const discordId of result.unlinkedLeft ?? []) {
                console.log(`[${stamp()}] Unlinked ${discordId} because they are not in the Discord server`);
            }
        }

        for (const batch of chunk(authorize, AUTHORIZE_BATCH)) {
            const result = await postLinkAudit({ absentDiscordIds: [], authorizeDiscordIds: batch });
            if (!result) {
                return;
            }
            if (result.misconfigured) {
                console.error(`[${stamp()}] Discord authorization check stopped because the website rejected its Discord client credentials. Nobody was unlinked for revoked access on this run.`);
                break;
            }
            revokedCount += result.unlinkedRevoked?.length ?? 0;
            skippedAuthorization += result.skippedAuthorization ?? 0;
            for (const discordId of result.unlinkedRevoked ?? []) {
                console.log(`[${stamp()}] Unlinked ${discordId} because they revoked Discord access`);
            }
        }

        if (skippedMembership > 0) {
            console.warn(`[${stamp()}] ${skippedMembership} user(s) stayed linked because the website could not confirm they left. Check DISCORD_BOT_TOKEN and the Discord guild id in the site settings.`);
        }

        console.log(`[${stamp()}] Linked member check finished: ${leftCount} left the server, ${revokedCount} revoked Discord access, ${skippedMembership} membership skips, ${skippedAuthorization} authorization skips`);
    } catch (error) {
        console.error(`[${stamp()}] Linked member check failed:`, error);
    } finally {
        auditInProgress = false;
    }
}
