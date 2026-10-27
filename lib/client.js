window.__ModuleLoader__.load({
	id: "@local/dsh-deepseek-meter",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		//#region lib/types/client/css.js
		const css = [
			".ldm_wrap{display:inline-flex;align-items:center;position:relative}",
			".ldm_chip{color:var(--dsw-alias-label-secondary);cursor:pointer;background:var(--dsw-alias-fill-l2);border:none;border-radius:999px;align-items:center;gap:6px;padding:3px 9px;font-family:var(--dsw-font-mono,monospace);font-size:11.5px;line-height:16px;display:inline-flex}",
			".ldm_chip:hover,.ldm_chip:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			".ldm_chip[data-active]{background:var(--dsw-alias-interactive-bg-hover)}",
			".ldm_dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#1a7f37)}",
			".ldm_dot[data-peak=true]{background:var(--dsw-alias-state-error-primary,#d1242f)}",
			".ldm_dot[data-unknown=true]{background:var(--dsw-alias-label-tertiary)}",
			".ldm_balance{color:inherit}",
			".ldm_dim{opacity:.7}",
			".ldm_pop{position:fixed;z-index:70;box-sizing:border-box;width:352px;max-width:min(384px,100vw - 24px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);border-radius:12px;display:flex;flex-direction:column;overflow:hidden}",
			".ldm_head{flex:none;display:flex;align-items:center;gap:8px;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l2)}",
			".ldm_title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px}",
			".ldm_body{display:flex;flex-direction:column}",
			".ldm_row{padding:9px 12px;display:flex;flex-direction:column;gap:3px}",
			".ldm_row+.ldm_row{border-top:1px solid var(--dsw-alias-border-l2)}",
			".ldm_rowTop{display:flex;align-items:center;gap:8px}",
			".ldm_label{color:var(--dsw-alias-label-primary);font-size:12.5px}",
			".ldm_value{margin-left:auto;color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-mono,monospace);font-size:12px}",
			".ldm_note{color:var(--dsw-alias-label-caption);font-size:11px;line-height:15px}",
			".ldm_rates{display:grid;grid-template-columns:74px 1fr 1fr 1fr;gap:2px 8px;font-family:var(--dsw-font-mono,monospace);font-size:11px;color:var(--dsw-alias-label-secondary)}",
			".ldm_ratesHead{color:var(--dsw-alias-label-caption)}",
			".ldm_foot{flex:none;display:flex;align-items:center;gap:8px;justify-content:space-between;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-caption);font-size:11px}",
			".ldm_btn{min-height:22px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 9px;font:inherit;font-size:11px;line-height:15px}",
			".ldm_btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}"
		].join("");
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"@local/dsh-deepseek-meter\"]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@local/dsh-deepseek-meter";
			tag.dataset.pluginCss = "@local/dsh-deepseek-meter/client.css";
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion

		//#region lib/types/client/logic.js
		/** Refresh cadence while a DeepSeek route is selected. */
		const POLL_MS = 60000;
		/** Surface identity for the popover's owner check. */
		const SURFACE_ID = "deepseek-meter";
		/** A model directory state used before the session's directory resolves. */
		const EMPTY_DIRECTORY = { current: null };

		/** Meter store, shared by the chip and the popover. */
		const store = {
			snapshot: { rev: 0 },
			data: null,
			status: "idle",
			error: null,
			open: false,
			seq: 0,
			listeners: new Set(),
			timer: null,
			inFlight: false,
			/** Whether a DeepSeek route is currently selected. */
			active: false
		};

		/** Subscribe for useSyncExternalStore. */
		function subscribe(listener) {
			store.listeners.add(listener);
			return () => {
				store.listeners.delete(listener);
			};
		}
		/** Version-only snapshot: components read the mutable store fields. */
		function getSnapshot() {
			return store.snapshot;
		}
		/** Publish one revision. */
		function commit() {
			store.snapshot = { rev: store.snapshot.rev + 1 };
			for (const listener of store.listeners) listener();
		}
		/** Fetch the meter; `force` bypasses the host cache. */
		async function load(force) {
			if (store.inFlight) return;
			store.inFlight = true;
			if (store.data === null) {
				store.status = "loading";
				commit();
			}
			try {
				const query = force === true ? "?refresh=1" : "";
				const response = await fetch(`/api/deepseek/meter${query}`, { headers: { accept: "application/json" } });
				const payload = await response.json().catch(() => null);
				if (payload === null || payload.ok !== true) throw new Error(payload?.error ?? `HTTP ${response.status}`);
				store.data = payload;
				store.error = null;
				store.status = "ready";
			} catch (error) {
				store.status = "error";
				store.error = String(error?.message ?? error);
			} finally {
				store.inFlight = false;
				commit();
			}
		}
		/** Start or stop polling with the DeepSeek activity. */
		function setActive(active) {
			if (store.active === active) return;
			store.active = active;
			if (active) {
				load(false);
				if (store.timer === null) {
					store.timer = setInterval(() => {
						if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
						load(false);
					}, POLL_MS);
				}
			} else {
				if (store.timer !== null) {
					clearInterval(store.timer);
					store.timer = null;
				}
				store.open = false;
				commit();
			}
		}
		/** Open/close helpers keyed by surface. */
		function togglePopover() {
			store.open = !store.open;
			store.seq += 1;
			commit();
			if (store.open) load(false);
		}
		/** Close the popover. */
		function closePopover() {
			store.open = false;
			commit();
		}
		/** The balance row worth showing: the first currency the API reported. */
		function primaryBalance() {
			const balances = store.data?.api?.balances;
			return Array.isArray(balances) && balances.length > 0 ? balances[0] : null;
		}
		/** Currency symbol for a balance entry. */
		function symbolOf(currency) {
			return currency === "CNY" ? "¥" : currency === "USD" ? "$" : `${currency ?? ""} `;
		}
		/** Two decimals, thousands separated. */
		function money(amount) {
			const value = Number(amount);
			if (!Number.isFinite(value)) return "—";
			return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		}
		/** Compact countdown to the next price switch. */
		function switchText(ms) {
			if (!Number.isFinite(ms) || ms <= 0) return "switching now";
			const minutes = Math.floor(ms / 60000);
			const days = Math.floor(minutes / 1440);
			const hours = Math.floor((minutes % 1440) / 60);
			const rest = minutes % 60;
			if (days > 0) return `in ${days}d ${hours}h`;
			if (hours > 0) return `in ${hours}h ${rest}m`;
			return `in ${Math.max(1, rest)}m`;
		}
		/** The first Platform wallet of the account route (topped-up balance). */
		function accountWallet() {
			const wallets = store.data?.account?.balance?.wallets;
			return Array.isArray(wallets) && wallets.length > 0 ? wallets[0] : null;
		}
		/** The first granted (bonus) wallet of the account route. */
		function bonusWallet() {
			const wallets = store.data?.account?.balance?.bonus;
			return Array.isArray(wallets) && wallets.length > 0 ? wallets[0] : null;
		}
		/** The chip's balance label: API key balance, else the account's wallet. */
		function balanceLabel() {
			const data = store.data;
			if (data === null || data === undefined) return "…";
			const api = data.api ?? null;
			if (api !== null && api.configured === true) {
				const balance = primaryBalance();
				if (balance !== null) return `${symbolOf(balance.currency)}${money(balance.total)}`;
				return api.error === null ? "—" : "!";
			}
			const wallet = accountWallet();
			if (wallet !== null) return `${symbolOf(wallet.currency)}${money(wallet.balance)}`;
			if (data.account?.signedIn === true) return data.account?.balance?.error ? "!" : "login";
			return "no key";
		}
		//#endregion

		//#region lib/types/client/MeterChip.js
		/**
		* Contextual chip: visible only while the session's selected provider is a
		* DeepSeek route. The dot is the price window (green off-peak, red peak); the
		* text is the API balance, or `login` for the account route without a key.
		*/
		function MeterChip({ sessionId, directory }) {
			react.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
			// The model seat hands over the directory's SnapshotStore; read through it.
			const directoryStore = directory?.store ?? null;
			const subscribeDirectory = react.useCallback(
				(listener) => (directoryStore === null ? () => {} : directoryStore.subscribe(listener)),
				[directoryStore]
			);
			const directorySnapshot = react.useCallback(
				() => directoryStore?.getSnapshot?.() ?? EMPTY_DIRECTORY,
				[directoryStore]
			);
			const selection = react.useSyncExternalStore(subscribeDirectory, directorySnapshot, directorySnapshot);
			const provider = selection?.current?.provider ?? null;
			const isDeepSeek = typeof provider === "string" && /deepseek/i.test(provider);
			react.useEffect(() => {
				if (directory !== null && typeof directory.load === "function") {
					Promise.resolve(directory.load()).catch(() => {});
				}
			}, [directory]);
			react.useEffect(() => {
				setActive(isDeepSeek);
				return () => {
					setActive(false);
				};
			}, [isDeepSeek]);
			const containerRef = react.useRef(null);
			const buttonRef = react.useRef(null);
			if (!isDeepSeek) return null;
			const price = store.data?.price ?? null;
			const peak = price === null ? null : price.peak === true;
			const label = balanceLabel();
			const tooltip = price === null
				? "DeepSeek"
				: [
					peak ? "Peak price" : "Off-peak — half price",
					price.nextSwitchInMs === null ? "" : `Next switch ${switchText(price.nextSwitchInMs)} (to ${price.nextState === "peak" ? "peak" : "off-peak"})`,
					`Balance: ${label}`
				].filter((line) => line.length > 0).join("\n");
			return react.createElement("span", { ref: containerRef, className: "ldm_wrap" },
				react.createElement(primitives.Tooltip, { label: tooltip, side: "top", delayMs: 400 },
					react.createElement("button", {
						type: "button",
						className: "ldm_chip",
						ref: buttonRef,
						"data-active": store.open || undefined,
						"aria-expanded": store.open,
						"aria-label": "DeepSeek balance and price window",
						onClick: togglePopover
					},
						react.createElement("span", { className: "ldm_dot", "data-peak": peak === true ? "true" : undefined, "data-unknown": peak === null ? "true" : undefined }),
						react.createElement("span", { className: "ldm_balance" }, label),
						react.createElement("span", { className: "ldm_dim" }, peak === null ? "" : peak ? "peak" : "off-peak")
					)
				),
				store.open ? react.createElement(MeterPopover, { containerRef, buttonRef, provider }) : null
			);
		}

		/** The popover body: price window, rates, balance, account. */
		function MeterPopover({ containerRef, buttonRef, provider }) {
			react.useEffect(() => {
				const onKey = (event) => {
					if (event.key === "Escape") closePopover();
				};
				window.addEventListener("keydown", onKey);
				return () => {
					window.removeEventListener("keydown", onKey);
				};
			}, []);
			primitives.useDismissOnOutsidePointer(containerRef, true, closePopover);
			const rect = buttonRef.current?.getBoundingClientRect?.() ?? containerRef.current?.getBoundingClientRect?.() ?? null;
			const style = {};
			if (rect !== null && rect !== undefined && Number.isFinite(rect.left)) {
				style.left = `${Math.max(8, Math.min(rect.left, (window.innerWidth ?? 1280) - 360))}px`;
				const below = (window.innerHeight ?? 800) - rect.bottom;
				if (below > 330) style.top = `${rect.bottom + 8}px`;
				else style.bottom = `${Math.max(8, (window.innerHeight ?? 800) - rect.top + 8)}px`;
			} else {
				style.top = "56px";
				style.right = "12px";
			}
			const data = store.data;
			const price = data?.price ?? null;
			const peak = price?.peak === true;
			const rates = data?.rates ?? null;
			const currency = store.data?.api?.balances?.[0]?.currency ?? "CNY";
			const table = rates?.[currency] ?? rates?.CNY ?? null;
			const column = peak ? 1 : 0;
			const refreshed = Number.isFinite(data?.fetchedAt) ? new Date(data.fetchedAt).toLocaleTimeString() : null;
			const balance = primaryBalance();
			const api = data?.api ?? null;
			const accountBalance = accountWallet();
			const bonus = bonusWallet();
			const accountError = data?.account?.balance?.error ?? null;
			const accountStale = data?.account?.balance?.stale === true;
			return react.createElement("div", { className: "ldm_pop", role: "dialog", "aria-label": "DeepSeek meter", style },
				react.createElement("div", { className: "ldm_head" },
					react.createElement("span", { className: "ldm_title" },
						react.createElement("span", { className: "ldm_dot", "data-peak": peak ? "true" : undefined }),
						"DeepSeek"
					),
					react.createElement("span", { className: "ldm_note", title: provider ?? "" }, provider ?? "—")
				),
				react.createElement("div", { className: "ldm_body" },
					react.createElement("div", { className: "ldm_row" },
						react.createElement("div", { className: "ldm_rowTop" },
							react.createElement("span", { className: "ldm_label" }, peak ? "Peak price" : "Off-peak — half price"),
							react.createElement("span", { className: "ldm_value" }, price?.nextSwitchInMs === null || price === null ? "" : `switch ${switchText(price.nextSwitchInMs)}`)
						),
						react.createElement("span", { className: "ldm_note" }, price?.schedule ?? "price window unavailable")
					),
					table === null ? null : react.createElement("div", { className: "ldm_row" },
						react.createElement("div", { className: "ldm_rates" },
							...[`1M ${currency}`, "cached", "input", "output"].map((text) =>
								react.createElement("span", { className: "ldm_ratesHead", key: `h-${text}` }, text)
							),
							...["Flash", "Pro"].flatMap((model) => {
								const row = model === "Flash" ? table.flash : table.pro;
								return [
									react.createElement("span", { key: `${model}-name` }, model),
									react.createElement("span", { key: `${model}-cached` }, row.cached[column]),
									react.createElement("span", { key: `${model}-input` }, row.input[column]),
									react.createElement("span", { key: `${model}-output` }, row.output[column])
								];
							})
						)
					),
					react.createElement("div", { className: "ldm_row" },
						react.createElement("div", { className: "ldm_rowTop" },
							react.createElement("span", { className: "ldm_label" }, accountBalance !== null ? "Topped-up balance" : "Balance"),
							react.createElement("span", { className: "ldm_value" },
								accountBalance !== null
									? `${symbolOf(accountBalance.currency)}${money(accountBalance.balance)}`
									: balance === null
										? (api?.configured === false ? "no API key" : api?.error ?? "—")
										: `${symbolOf(balance.currency)}${money(balance.total)}`
							)
						),
						accountBalance !== null
							? react.createElement("span", { className: "ldm_note" },
								[
									bonus === null ? null : `granted ${symbolOf(bonus.currency)}${money(bonus.balance)}`,
									"account route (Platform wallets)",
									accountError === null ? null : accountError,
									accountStale ? "stale" : null
								].filter((part) => part !== null).join(" · ")
							)
							: balance === null
								? react.createElement("span", { className: "ldm_note" },
									api?.configured === false
										? "Add DEEPSEEK_API_KEY (Settings → Models → DeepSeek) to meter the API route; the account route reads the Platform wallets above when it is signed in."
										: accountError ?? "balance unavailable"
								)
								: react.createElement("span", { className: "ldm_note" },
									`granted ${symbolOf(balance.currency)}${money(balance.granted)} · topped up ${symbolOf(balance.currency)}${money(balance.toppedUp)}${api?.stale === true ? " · stale" : ""}`
								)
					),
					react.createElement("div", { className: "ldm_row" },
						react.createElement("div", { className: "ldm_rowTop" },
							react.createElement("span", { className: "ldm_label" }, "Account"),
							react.createElement("span", { className: "ldm_value" }, data?.account?.signedIn === true ? "signed in" : "not signed in")
						),
						react.createElement("span", { className: "ldm_note" }, "Device login (subscription). It has no credits; the balance above belongs to the API key.")
					)
				),
				react.createElement("div", { className: "ldm_foot" },
					react.createElement("span", null, refreshed === null ? "no reading yet" : `updated ${refreshed}`),
					react.createElement("button", { type: "button", className: "ldm_btn", onClick: () => load(true) }, "Refresh")
				)
			);
		}
		//#endregion

		//#region lib/types/client/index.js
		/**
		* Service faces this plugin reads on ctx — every ctx.* access must be declared
		* here. `modelDirectories` is the per-session model-selection service: without
		* declaring it the plugin may activate before the service exists, `ctx.get`
		* returns undefined and the chip can never learn which provider is selected.
		*/
		/**
		 * Required services: the slot registry, the model-selection service, and — the
		 * non-obvious one — `remote.session`. Resolving a session's model directory
		 * reaches the session scope's wire face, so a plugin that calls
		 * `directoryFor()` needs that nested service injected by its dotted name;
		 * without it every call throws "cannot get property remote.session without
		 * inject" and the chip can never learn which provider is selected.
		 */
		const inject = ["slots", "modelDirectories", "remote.session"];
		/**
		* Client plugin body: one contextual chip in the composer tool row. It is
		* rendered only while the selected provider is a DeepSeek route, so the row
		* carries either the OpenCode quota or this meter, never both at once.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.inject(["slots", "modelDirectories"], (scope) => {
				const models = scope.modelDirectories;
				/**
				* The session's shared model directory, or null when it cannot be resolved.
				* Called inside the injected scope on purpose: on the bare root ctx
				* `directoryFor()` fails with "cannot get property remote.session without
				* inject", because resolving a directory reaches the session scope's wire
				* face. The model seat resolves it the same way.
				* @param {string} sessionId - session owning the composer.
				* @returns {any} the directory both selection entries share.
				*/
				function directoryFor(sessionId) {
					try {
						return models.directoryFor(sessionId) ?? null;
					} catch {
						return null;
					}
				}
				scope.slots.inject("conversation.input.right", () => scope.slots.register({
					name: "conversation.input.right",
					id: SURFACE_ID,
					order: 11,
					// The slot hands `inject` the session id itself (a string), not a props
					// object: the same shape the attach button uses.
					inject: (sessionId) => ({ sessionId, directory: directoryFor(sessionId) })
				}, MeterChip));
			});
		}
		exports.apply = apply;
		exports.inject = inject;
		/** Test/debug seams. */
		exports.__store = store;
		exports.__load = load;
		exports.__setActive = setActive;
		exports.__format = { money, switchText, balanceLabel, symbolOf };
		return module.exports;
	}
});
