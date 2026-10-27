/**
 * @local/dsh-deepseek-meter — host half.
 *
 * One route:
 *
 *   GET /api/deepseek/meter[?refresh=1]
 *        → `{ ok, price, account, api, fetchedAt }`
 *
 * Three facts, three sources:
 *
 * - **price** — computed locally, no network. DeepSeek bills half price outside
 *   peak hours; peak is Beijing time (UTC+8) Monday–Friday 09:00–12:00 and
 *   14:00–18:00, and everything else (weekends, nights) is off-peak. Chinese
 *   public holidays are also off-peak but are not tracked here, so a holiday
 *   Monday reads as peak.
 * - **api** — `GET https://api.deepseek.com/user/balance` with the key behind
 *   `DEEPSEEK_API_KEY` (resolved through `ctx.credentials`, the environment, or
 *   `$DSH_HOME/.credentials.yaml`), cached for a minute.
 * - **account** — whether the DeepSeek *account* (device login) route is signed
 *   in, read from the credential records (`deepseek-account-platform/*`). That
 *   route is a subscription, so it has no balance to report.
 *
 * Nothing is written: the plugin only reads credentials and asks DeepSeek for the
 * balance of the key it finds.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Cordis plugin name. */
const name = "deepseek-meter";

/** The web server owns the route table; `credentials` is fetched lazily. */
const inject = ["webServer"];

/** Route prefix owned by this plugin. */
const ROUTE_PREFIX = "/api/deepseek/meter";

/** Official balance endpoint. */
const DEFAULT_API_BASE = "https://api.deepseek.com";

/** Balance reuse window; the client polls once a minute. */
const CACHE_MS = 60000;

/** Upstream timeout. */
const TIMEOUT_MS = 8000;

/** Credential reference the balance resolves. */
const API_KEY_REF = "DEEPSEEK_API_KEY";

/** Credential record holding the account (device login) grant. */
const ACCOUNT_RECORD = "deepseek-account-platform/default";

/** Platform origin that serves the account summary. */
const DEFAULT_PLATFORM_ORIGIN = "https://platform.deepseek.com";

/** Beijing is UTC+8 all year (no daylight saving). */
const BEIJING_OFFSET_MS = 8 * 3600_000;

/** Peak windows in Beijing minutes-of-day: 09:00–12:00 and 14:00–18:00. */
const PEAK_WINDOWS = [
	[9 * 60, 12 * 60],
	[14 * 60, 18 * 60]
];

/**
 * Published rates per 1M tokens. CNY is the source of truth (the official
 * Chinese pricing page); USD is the same sheet in dollars. Off-peak is half of
 * peak, which the numbers below already reflect.
 */
const RATES = {
	CNY: {
		flash: { cached: [0.02, 0.04], input: [1, 2], output: [4, 8] },
		pro: { cached: [0.15, 0.3], input: [4.5, 9], output: [13.5, 27] }
	},
	USD: {
		flash: { cached: [0.003, 0.006], input: [0.15, 0.3], output: [0.6, 1.2] },
		pro: { cached: [0.022, 0.044], input: [0.66, 1.32], output: [1.98, 3.96] }
	}
};

/** Cache cell for the last good balance reading. */
let cache = null;

/** Replaceable fetch seam for tests. */
let fetchImpl = (...args) => fetch(...args);

/** DSH home, where the credential document lives. */
function dshHome() {
	return typeof process.env.DSH_HOME === "string" && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), ".dsh");
}

/** Path of the credential document. */
function credentialsFile() {
	return join(dshHome(), ".credentials.yaml");
}

/** Strip a pasted "Bearer " prefix. */
function cleanKey(raw) {
	return typeof raw === "string" ? raw.trim().replace(/^Bearer\s+/i, "") : "";
}

/**
 * One credential reference, resolved the way DSH resolves it: the credential
 * service first, then the live environment, then the document's `refs` block.
 * @param {any} credentials - ctx.credentials, when reachable.
 * @param {string} ref - reference name.
 * @returns {Promise<{key:string,source:string}|null>} the secret.
 */
async function resolveReference(credentials, ref) {
	if (credentials !== undefined && credentials !== null && typeof credentials.resolve === "function") {
		try {
			const hit = await credentials.resolve(ref);
			const key = cleanKey(hit?.value);
			if (key.length > 0) return { key, source: `credentials:${hit?.source ?? ref}` };
		} catch {
			/* fall through */
		}
	}
	const fromEnv = cleanKey(process.env[ref]);
	if (fromEnv.length > 0) return { key: fromEnv, source: `env:${ref}` };
	let text;
	try {
		text = readFileSync(credentialsFile(), "utf8");
	} catch {
		return null;
	}
	let inRefs = false;
	for (const line of text.split("\n")) {
		if (/^refs:\s*$/.test(line)) {
			inRefs = true;
			continue;
		}
		if (inRefs && /^[A-Za-z]/.test(line)) inRefs = false;
		if (!inRefs) continue;
		const match = line.match(/^  ([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
		if (match === null || match[1] !== ref) continue;
		let value = match[2].trim();
		if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
		const key = cleanKey(value);
		return key.length > 0 ? { key, source: `${credentialsFile()}#${ref}` } : null;
	}
	return null;
}

/**
 * The account (device login) grant: the token the Platform accepts in
 * `x-dsh-auth-token`, plus the issuer it belongs to. The token stays in the host
 * process and is never part of the response.
 * @param {any} credentials - ctx.credentials, when reachable.
 * @returns {Promise<{signedIn:boolean,token:string|null,issuer:string|null,source:string|null}>} the grant.
 */
async function accountGrant(credentials) {
	const record = { signedIn: false, token: null, issuer: null, source: null };
	let text;
	try {
		text = readFileSync(credentialsFile(), "utf8");
	} catch {
		return record;
	}
	let inRecords = false;
	let current = null;
	let inPayload = false;
	for (const line of text.split("\n")) {
		if (/^records:\s*$/.test(line)) {
			inRecords = true;
			continue;
		}
		if (inRecords && /^[A-Za-z]/.test(line)) inRecords = false;
		if (!inRecords) continue;
		const key = line.match(/^  ([^\s:][^:]*):\s*$/);
		if (key !== null) {
			current = key[1];
			inPayload = false;
			if (current === ACCOUNT_RECORD) record.signedIn = true;
			continue;
		}
		if (current !== ACCOUNT_RECORD) continue;
		if (/^\s+payload:\s*$/.test(line)) {
			inPayload = true;
			continue;
		}
		if (!inPayload) continue;
		const token = line.match(/^\s+token:\s*(.+)$/);
		if (token !== null) record.token = token[1].trim().replace(/^["']|["']$/g, "");
		const issuer = line.match(/^\s+issuer:\s*(.+)$/);
		if (issuer !== null) record.issuer = issuer[1].trim().replace(/^["']|["']$/g, "");
	}
	if (record.signedIn) record.source = `${credentialsFile()}#${ACCOUNT_RECORD}`;
	// The service can also list records; consulting it keeps this working if the
	// document ever moves, but the token itself only exists in the document.
	if (!record.signedIn && credentials !== undefined && credentials !== null && typeof credentials.listRecords === "function") {
		try {
			const records = await credentials.listRecords();
			const keys = (Array.isArray(records) ? records : []).map((entry) => String(entry?.key ?? entry));
			if (keys.some((key) => key.startsWith("deepseek-account-platform/"))) {
				record.signedIn = true;
				record.source = "credentials:listRecords";
			}
		} catch {
			/* the document miss stands */
		}
	}
	return record;
}

/** Cache cell for the last good account balance. */
let accountCache = null;

/**
 * The account route's topped-up and granted wallets, read from the Platform
 * summary with the stored grant. The grant issuer must match the configured
 * platform origin, so the token only ever travels to the issuer it was minted for.
 * @param {{signedIn:boolean,token:string|null,issuer:string|null,source:string|null}} account - the grant.
 * @param {string} platformOrigin - configured Platform origin.
 * @param {boolean} force - bypass the cache.
 * @returns {Promise<object>} the `account.balance` section.
 */
async function accountBalanceState(account, platformOrigin, force) {
	if (!account.signedIn) return { configured: false, wallets: [], bonus: [], error: null, stale: false };
	if (account.token === null) return { configured: false, wallets: [], bonus: [], error: "no stored grant token", stale: false };
	if (account.issuer !== null && account.issuer !== platformOrigin) {
		return { configured: true, wallets: [], bonus: [], error: `grant issuer ${account.issuer} does not match ${platformOrigin}`, stale: false };
	}
	if (!force && accountCache !== null && accountCache.token === account.token && Date.now() - accountCache.at < CACHE_MS) {
		return { ...accountCache.value, cached: true };
	}
	const failed = (message) =>
		accountCache !== null && accountCache.token === account.token
			? { ...accountCache.value, error: message, stale: true, cached: true }
			: { configured: true, wallets: [], bonus: [], error: message, stale: false };
	let response;
	try {
		response = await fetchImpl(`${platformOrigin}/api/v0/users/get_user_summary`, {
			method: "GET",
			headers: { "x-dsh-auth-token": account.token, accept: "application/json" },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (error) {
		return failed(`request failed: ${String(error?.message ?? error)}`);
	}
	if (!response.ok) return failed(`upstream HTTP ${response.status}`);
	const body = await response.json().catch(() => null);
	const biz = body?.data?.biz_data;
	if (biz === undefined || biz === null) {
		return { configured: true, wallets: [], bonus: [], error: `unexpected response (code ${body?.code ?? "?"})`, stale: false };
	}
	const wallets = (Array.isArray(biz.normal_wallets) ? biz.normal_wallets : [])
		.map((wallet) => ({ currency: String(wallet?.currency ?? ""), balance: Number(wallet?.balance) }))
		.filter((wallet) => wallet.currency.length > 0 && Number.isFinite(wallet.balance));
	const bonus = (Array.isArray(biz.bonus_wallets) ? biz.bonus_wallets : [])
		.map((wallet) => ({ currency: String(wallet?.currency ?? ""), balance: Number(wallet?.balance) }))
		.filter((wallet) => wallet.currency.length > 0 && Number.isFinite(wallet.balance));
	const value = { configured: true, wallets, bonus, error: null, stale: false, cached: false, fetchedAt: Date.now() };
	accountCache = { token: account.token, at: Date.now(), value };
	return value;
}

/** Peak-window test for one instant, in Beijing local time. */
function isPeakAt(at) {
	const local = new Date(at + BEIJING_OFFSET_MS);
	const day = local.getUTCDay();
	if (day === 0 || day === 6) return false;
	const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
	return PEAK_WINDOWS.some(([from, to]) => minutes >= from && minutes < to);
}

/**
 * Current price window plus the next switch.
 * @param {number} [at] - instant to evaluate (default: now).
 * @returns {{offPeak:boolean, peak:boolean, nextSwitchAt:string|null, nextSwitchInMs:number|null, nextState:"peak"|"offPeak"|null, schedule:string}} the window.
 */
function priceState(at = Date.now()) {
	const start = Math.floor(at / 60000) * 60000;
	const current = isPeakAt(start);
	let next = null;
	for (let minute = 1; minute <= 8 * 24 * 60; minute += 1) {
		const candidate = start + minute * 60000;
		if (isPeakAt(candidate) !== current) {
			next = candidate;
			break;
		}
	}
	return {
		offPeak: !current,
		peak: current,
		nextSwitchAt: next === null ? null : new Date(next).toISOString(),
		nextSwitchInMs: next === null ? null : next - at,
		nextState: next === null ? null : isPeakAt(next) ? "peak" : "offPeak",
		schedule: "Mon–Fri 09:00–12:00 and 14:00–18:00 Asia/Shanghai; weekends and nights are off-peak (public holidays are not tracked)"
	};
}

/** Turn the API's string balances into numbers. */
function normalizeBalance(body) {
	const infos = Array.isArray(body?.balance_infos) ? body.balance_infos : [];
	const balances = infos
		.map((info) => ({
			currency: typeof info?.currency === "string" ? info.currency : null,
			total: Number(info?.total_balance),
			granted: Number(info?.granted_balance),
			toppedUp: Number(info?.topped_up_balance)
		}))
		.filter((entry) => entry.currency !== null && Number.isFinite(entry.total));
	return { available: body?.is_available === true, balances };
}

/**
 * The balance for one key, cached briefly; a failed refresh keeps the last good
 * reading marked stale.
 * @param {{key:string,source:string}|null} credential - resolved key.
 * @param {string} apiBase - API base URL.
 * @param {boolean} force - bypass the cache.
 * @returns {Promise<object>} the `api` section.
 */
async function balanceState(credential, apiBase, force) {
	if (credential === null) {
		return { configured: false, available: null, balances: [], error: null, stale: false, source: null };
	}
	if (!force && cache !== null && cache.key === credential.key && Date.now() - cache.at < CACHE_MS) {
		return { ...cache.value, cached: true };
	}
	let response;
	try {
		response = await fetchImpl(`${apiBase}/user/balance`, {
			method: "GET",
			headers: { authorization: `Bearer ${credential.key}`, accept: "application/json" },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (error) {
		const message = `request failed: ${String(error?.message ?? error)}`;
		return cache !== null && cache.key === credential.key
			? { ...cache.value, error: message, stale: true, cached: true }
			: { configured: true, available: null, balances: [], error: message, stale: false, source: credential.source };
	}
	if (!response.ok) {
		const message = `upstream HTTP ${response.status}`;
		return cache !== null && cache.key === credential.key
			? { ...cache.value, error: message, stale: true, cached: true }
			: { configured: true, available: null, balances: [], error: message, stale: false, source: credential.source };
	}
	const body = await response.json().catch(() => null);
	const normalized = normalizeBalance(body);
	const value = {
		configured: true,
		available: normalized.available,
		balances: normalized.balances,
		error: null,
		stale: false,
		cached: false,
		source: credential.source,
		fetchedAt: Date.now()
	};
	cache = { key: credential.key, at: Date.now(), value };
	return value;
}

/** Send JSON. */
function respondJson(res, status, payload) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(payload));
}

/**
 * Handle `GET /api/deepseek/meter`.
 * @param {any} ctx - plugin context.
 * @param {{apiBase:string, credentials:any}} settings - resolved config.
 * @param {import("node:http").IncomingMessage} req - request.
 * @param {import("node:http").ServerResponse} res - response.
 */
async function handle(ctx, settings, req, res) {
	const url = new URL(req.url ?? "/", "http://localhost");
	if (req.method !== "GET" && req.method !== "HEAD") {
		respondJson(res, 405, { ok: false, error: "method-not-allowed" });
		return;
	}
	if (url.pathname !== ROUTE_PREFIX && !url.pathname.startsWith(`${ROUTE_PREFIX}/`)) {
		respondJson(res, 404, { ok: false, error: "unknown deepseek route" });
		return;
	}
	const credentials = ctx.get?.("credentials");
	const [credential, grant] = await Promise.all([resolveReference(credentials, API_KEY_REF), accountGrant(credentials)]);
	const force = url.searchParams.get("refresh") === "1";
	const [api, accountBalance] = await Promise.all([
		balanceState(credential, settings.apiBase, force),
		accountBalanceState(grant, settings.platformOrigin, force)
	]);
	respondJson(res, 200, {
		ok: true,
		fetchedAt: Date.now(),
		price: priceState(),
		// The grant's token never leaves this process.
		account: { signedIn: grant.signedIn, source: grant.source, balance: accountBalance },
		api,
		rates: RATES
	});
}

/**
 * Register the `/api/deepseek/meter` prefix route for this fiber's lifetime.
 * @param {any} ctx - registrant context.
 * @param {{apiBase?:string}} [config] - row config.
 */
function apply(ctx, config) {
	const settings = {
		apiBase: typeof config?.apiBase === "string" && config.apiBase.length > 0 ? config.apiBase : DEFAULT_API_BASE,
		platformOrigin:
			typeof config?.platformOrigin === "string" && config.platformOrigin.length > 0 ? config.platformOrigin : DEFAULT_PLATFORM_ORIGIN
	};
	const dispose = ctx.webServer.register({
		kind: "prefix",
		path: ROUTE_PREFIX,
		handler: (req, res) => {
			handle(ctx, settings, req, res).catch((error) => {
				try {
					respondJson(res, 500, { ok: false, error: String(error?.message ?? error) });
				} catch {
					/* response already sent */
				}
			});
		}
	});
	ctx.effect(() => dispose, "deepseek-meter: /api/deepseek/meter route");
}

export { apply, inject, name };
/** Test seams. */
export const __internals = {
	API_KEY_REF,
	RATES,
	isPeakAt,
	priceState,
	normalizeBalance,
	resolveReference,
	accountGrant,
	accountBalanceState,
	balanceState,
	handle,
	resetCache: () => {
		cache = null;
		accountCache = null;
	},
	setFetch: (impl) => {
		fetchImpl = impl ?? ((...args) => fetch(...args));
	}
};
